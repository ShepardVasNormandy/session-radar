import { describe, expect, test } from "bun:test";
import { parseRecord, splitLines, toolSummary } from "./transcript.ts";

describe("splitLines", () => {
  test("splits complete lines and carries the partial tail", () => {
    const r = splitLines('{"a":1}\n{"b":2}\n{"c":', "");
    expect(r.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(r.carry).toBe('{"c":');
  });

  test("prepends carry to the first line", () => {
    const r = splitLines('3}\n{"d":4}\n', '{"c":');
    expect(r.lines).toEqual(['{"c":3}', '{"d":4}']);
    expect(r.carry).toBe("");
  });

  test("chunk with no newline extends carry", () => {
    const r = splitLines("abc", "x");
    expect(r.lines).toEqual([]);
    expect(r.carry).toBe("xabc");
  });
});

const ASSISTANT_ROW = JSON.stringify({
  type: "assistant",
  uuid: "u1",
  sessionId: "s1",
  timestamp: "2026-08-04T09:06:26.019Z",
  cwd: "/home/dev/projects",
  gitBranch: "main",
  isSidechain: false,
  requestId: "req_1",
  message: {
    id: "msg_1",
    model: "claude-fable-5",
    stop_reason: "tool_use",
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 23253,
      cache_read_input_tokens: 21125,
      output_tokens: 593,
      cache_creation: { ephemeral_1h_input_tokens: 23253, ephemeral_5m_input_tokens: 0 },
    },
    content: [
      { type: "thinking", thinking: "..." },
      { type: "text", text: "Scaffolding now." },
      { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls", description: "List files" } },
    ],
  },
});

describe("parseRecord", () => {
  test("assistant row: usage buckets, model, text, tool uses", () => {
    const rec = parseRecord(ASSISTANT_ROW);
    expect(rec).toMatchObject({
      kind: "assistant",
      messageId: "msg_1",
      model: "claude-fable-5",
      cwd: "/home/dev/projects",
      gitBranch: "main",
      isSidechain: false,
      text: "Scaffolding now.",
      usage: { input: 2, output: 593, cacheRead: 21125, cache5m: 0, cache1h: 23253 },
    });
    if (rec?.kind !== "assistant") throw new Error("wrong kind");
    expect(rec.toolUses).toEqual([{ id: "toolu_1", name: "Bash", summary: "List files" }]);
    expect(rec.ts).toBe(Date.parse("2026-08-04T09:06:26.019Z"));
  });

  test("typed prompt row", () => {
    const rec = parseRecord(
      JSON.stringify({
        type: "user",
        promptId: "p1",
        promptSource: "typed",
        timestamp: "2026-08-04T09:06:13.864Z",
        cwd: "/x",
        isSidechain: false,
        message: { role: "user", content: "hello world" },
      }),
    );
    expect(rec).toMatchObject({ kind: "prompt", text: "hello world" });
  });

  test("tool result row with artifact publish", () => {
    const rec = parseRecord(
      JSON.stringify({
        type: "user",
        sourceToolAssistantUUID: "u9",
        timestamp: "2026-08-04T09:07:00.000Z",
        isSidechain: false,
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", is_error: null }] },
        toolUseResult: {
          url: "https://claude.ai/code/artifact/abc",
          path: "/tmp/x.html",
          title: "My Page",
          updated: false,
        },
      }),
    );
    expect(rec).toMatchObject({
      kind: "tool-result",
      toolUseId: "toolu_9",
      isError: false,
      artifact: { url: "https://claude.ai/code/artifact/abc", title: "My Page" },
    });
  });

  test("turn duration, titles, away summary", () => {
    expect(
      parseRecord(JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: 99775, timestamp: "2026-08-04T09:08:25.198Z" })),
    ).toMatchObject({ kind: "turn", durationMs: 99775 });
    expect(parseRecord(JSON.stringify({ type: "ai-title", aiTitle: "T", sessionId: "s" }))).toMatchObject({
      kind: "ai-title",
      title: "T",
    });
    expect(parseRecord(JSON.stringify({ type: "custom-title", customTitle: "C", sessionId: "s" }))).toMatchObject({
      kind: "custom-title",
      title: "C",
    });
    expect(
      parseRecord(JSON.stringify({ type: "system", subtype: "away_summary", content: "Did things.", timestamp: "2026-08-04T09:08:25.198Z" })),
    ).toMatchObject({ kind: "away-summary", text: "Did things." });
  });

  test("malformed line returns null, uninteresting rows return other", () => {
    expect(parseRecord('{"type":"assistant", CORRUPT')).toBeNull();
    expect(parseRecord("")).toBeNull();
    expect(parseRecord(JSON.stringify({ type: "file-history-snapshot" }))).toMatchObject({ kind: "other" });
  });

  test("sidechain rows are flagged", () => {
    const row = JSON.parse(ASSISTANT_ROW);
    row.isSidechain = true;
    const rec = parseRecord(JSON.stringify(row));
    expect(rec).toMatchObject({ kind: "assistant", isSidechain: true });
  });
});

describe("toolSummary", () => {
  test("per-tool one-liners", () => {
    expect(toolSummary("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    expect(toolSummary("Bash", { command: "ls -la" })).toBe("ls -la");
    expect(toolSummary("Bash", { command: "ls", description: "List" })).toBe("List");
    expect(toolSummary("Task", { description: "Explore code", prompt: "..." })).toBe("Explore code");
    expect(toolSummary("Artifact", { file_path: "/tmp/p.html", label: "v1" })).toBe("/tmp/p.html");
    expect(toolSummary("WebFetch", { url: "https://x.dev" })).toBe("https://x.dev");
    expect(toolSummary("Mystery", { alpha: 42, beta: "first string" })).toBe("first string");
    expect(toolSummary("Mystery", {})).toBe("");
  });

  test("truncates long summaries", () => {
    const s = toolSummary("Bash", { command: "x".repeat(300) });
    expect(s.length).toBeLessThanOrEqual(120);
  });
});
