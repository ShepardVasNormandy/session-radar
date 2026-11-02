import { describe, expect, test } from "bun:test";
import { activitySeries, applyLine, newAgg, resolveTitle, summarizeCost, usageByModel } from "./aggregate.ts";

function assistantLine(messageId: string, opts: { output?: number; text?: string; tool?: { id: string; name: string }; sidechain?: boolean; model?: string } = {}): string {
  const content: unknown[] = [];
  if (opts.text) content.push({ type: "text", text: opts.text });
  if (opts.tool) content.push({ type: "tool_use", id: opts.tool.id, name: opts.tool.name, input: { file_path: "/f.ts" } });
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-04T10:00:00.000Z",
    isSidechain: opts.sidechain ?? false,
    cwd: "/home/dev/projects",
    gitBranch: "main",
    message: {
      id: messageId,
      model: opts.model ?? "claude-opus-5",
      usage: { input_tokens: 10, output_tokens: opts.output ?? 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content,
    },
  });
}

describe("usage dedupe", () => {
  test("rows sharing one message.id count once, last write wins", () => {
    const agg = newAgg();
    applyLine(agg, assistantLine("msg_A", { output: 100 }));
    applyLine(agg, assistantLine("msg_A", { output: 150 }));
    applyLine(agg, assistantLine("msg_B", { output: 30 }));
    const byModel = usageByModel(agg);
    expect(byModel).toHaveLength(1);
    expect(byModel[0]!.output).toBe(180);
    expect(byModel[0]!.input).toBe(20);
  });

  test("groups by model and prices known models", () => {
    const agg = newAgg();
    applyLine(agg, assistantLine("m1", { output: 1_000_000, model: "claude-opus-5" }));
    applyLine(agg, assistantLine("m2", { output: 1_000_000, model: "unknown-model-x" }));
    const byModel = usageByModel(agg);
    expect(byModel).toHaveLength(2);
    const opus = byModel.find((m) => m.model === "claude-opus-5")!;
    expect(opus.costUSD).toBeCloseTo(25.00005, 4);
    expect(byModel.find((m) => m.model === "unknown-model-x")!.costUSD).toBeNull();
    const { total, partial } = summarizeCost(byModel);
    expect(partial).toBe(true);
    expect(total).toBeCloseTo(25.00005, 4);
  });
});

describe("timeline", () => {
  test("ring buffer caps and counts evictions", () => {
    const agg = newAgg(3);
    for (let i = 0; i < 5; i++) {
      applyLine(agg, JSON.stringify({ type: "user", promptId: `p${i}`, promptSource: "typed", timestamp: "2026-08-04T10:00:00.000Z", message: { content: `prompt ${i}` } }));
    }
    expect(agg.timeline).toHaveLength(3);
    expect(agg.timelineTruncated).toBe(2);
    expect(agg.timeline[0]).toMatchObject({ kind: "prompt", text: "prompt 2" });
  });

  test("assistant text deduped per message.id, tool events kept, isError correlated", () => {
    const agg = newAgg();
    applyLine(agg, assistantLine("m1", { text: "working" }));
    applyLine(agg, assistantLine("m1", { text: "working" }));
    applyLine(agg, assistantLine("m1", { tool: { id: "toolu_9", name: "Read" } }));
    applyLine(
      agg,
      JSON.stringify({
        type: "user",
        sourceToolAssistantUUID: "u",
        timestamp: "2026-08-04T10:00:01.000Z",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: true }] },
      }),
    );
    const kinds = agg.timeline.map((e) => e.kind);
    expect(kinds).toEqual(["assistant", "tool"]);
    expect(agg.timeline[1]).toMatchObject({ kind: "tool", tool: "Read", isError: true });
  });

  test("sidechain rows are ignored entirely", () => {
    const agg = newAgg();
    applyLine(agg, assistantLine("m1", { text: "hi", sidechain: true }));
    expect(agg.timeline).toHaveLength(0);
    expect(usageByModel(agg)).toHaveLength(0);
  });
});

describe("artifacts + meta", () => {
  test("artifacts dedupe by url, later wins; meta tracked", () => {
    const agg = newAgg();
    const result = (title: string) =>
      JSON.stringify({
        type: "user",
        sourceToolAssistantUUID: "u",
        timestamp: "2026-08-04T10:00:02.000Z",
        message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: null }] },
        toolUseResult: { url: "https://claude.ai/code/artifact/abc", title },
      });
    applyLine(agg, result("v1"));
    applyLine(agg, result("v2"));
    applyLine(agg, assistantLine("m1", {}));
    expect(agg.artifacts).toHaveLength(1);
    expect(agg.artifacts[0]).toMatchObject({ title: "v2", source: "transcript" });
    expect(agg.cwd).toBe("/home/dev/projects");
    expect(agg.gitBranch).toBe("main");
    expect(agg.lastActivity).toBe(Date.parse("2026-08-04T10:00:02.000Z"));
  });

  test("malformed lines count as parse errors", () => {
    const agg = newAgg();
    applyLine(agg, "{{{nope");
    expect(agg.parseErrors).toBe(1);
  });

  test("turn count from turn_duration rows", () => {
    const agg = newAgg();
    applyLine(agg, JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 5, timestamp: "2026-08-04T10:00:00.000Z" }));
    applyLine(agg, JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 5, timestamp: "2026-08-04T10:00:01.000Z" }));
    expect(agg.turnCount).toBe(2);
  });
});

describe("activitySeries", () => {
  test("buckets event timestamps into a fixed window ending now", () => {
    const agg = newAgg();
    const base = Date.parse("2026-08-04T10:00:00.000Z");
    const mk = (offsetMin: number, id: string) =>
      JSON.stringify({
        type: "assistant",
        timestamp: new Date(base + offsetMin * 60_000).toISOString(),
        isSidechain: false,
        message: { id, model: "m", usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
      });
    applyLine(agg, mk(0, "a"));
    applyLine(agg, mk(1, "b"));
    applyLine(agg, mk(31, "c"));
    const now = base + 45 * 60_000;
    const series = activitySeries(agg, now, 15 * 60_000, 4);
    expect(series.counts).toHaveLength(4);
    expect(series.bucketMs).toBe(15 * 60_000);
    // last bucket = the in-progress one (30..45]; window [0..15) [15..30) [30..45) [45..60)
    expect(series.counts).toEqual([2, 0, 1, 0]);
    expect(series.start).toBe(base);
  });
});

describe("resolveTitle", () => {
  test("custom > ai > registry > first prompt > id prefix", () => {
    const agg = newAgg();
    expect(resolveTitle(agg, undefined, "abcdef12-3456")).toBe("abcdef12");
    applyLine(agg, JSON.stringify({ type: "user", promptId: "p", promptSource: "typed", timestamp: "2026-08-04T10:00:00.000Z", message: { content: "fix the login bug please" } }));
    expect(resolveTitle(agg, undefined, "abcdef12-3456")).toBe("fix the login bug please");
    expect(resolveTitle(agg, "demo-session", "abcdef12-3456")).toBe("demo-session");
    applyLine(agg, JSON.stringify({ type: "ai-title", aiTitle: "Fix login" }));
    expect(resolveTitle(agg, "demo-session", "abcdef12-3456")).toBe("Fix login");
    applyLine(agg, JSON.stringify({ type: "custom-title", customTitle: "My session" }));
    expect(resolveTitle(agg, "demo-session", "abcdef12-3456")).toBe("My session");
  });
});
