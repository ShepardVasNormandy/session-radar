import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSubagents } from "./subagents.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function agentRow(messageId: string, output: number): string {
  return (
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-04T10:00:00.000Z",
      isSidechain: true,
      agentId: "abc",
      message: { id: messageId, model: "claude-sonnet-5", usage: { input_tokens: 5, output_tokens: output }, content: [] },
    }) + "\n"
  );
}

describe("scanSubagents", () => {
  test("discovers agents, reads meta, accumulates deduped usage incrementally", async () => {
    const root = tempDir("radar-sub-");
    const dir = join(root, "subagents");
    mkdirSync(dir);
    writeFileSync(join(dir, "agent-a1.meta.json"), JSON.stringify({ agentType: "Explore", description: "Dig session data", toolUseId: "toolu_1", spawnDepth: 1 }));
    writeFileSync(join(dir, "agent-a1.jsonl"), agentRow("m1", 100) + agentRow("m1", 120));

    const agents = new Map();
    await scanSubagents(root, agents);
    expect(agents.size).toBe(1);
    const a = agents.get("a1")!;
    expect(a.agentType).toBe("Explore");
    expect(a.description).toBe("Dig session data");
    expect([...a.byMessageId.values()][0].usage.output).toBe(120);

    // append more rows — incremental tail picks up only the new one
    writeFileSync(join(dir, "agent-a1.jsonl"), agentRow("m1", 120) + agentRow("m2", 50));
    await scanSubagents(root, agents);
    expect(agents.get("a1")!.byMessageId.size).toBe(2);
  });

  test("no subagents dir is fine", async () => {
    const agents = new Map();
    await scanSubagents("/nonexistent/sessdir", agents);
    expect(agents.size).toBe(0);
  });
});
