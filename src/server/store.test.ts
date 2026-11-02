import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "./store.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-08-04T12:00:00.000Z");

function row(type: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ type, timestamp: "2026-08-04T11:59:00.000Z", isSidechain: false, ...extra }) + "\n";
}

function assistant(messageId: string, output: number): string {
  return row("assistant", {
    cwd: "/home/dev/projects/demo",
    gitBranch: "main",
    message: {
      id: messageId,
      model: "claude-opus-5",
      usage: { input_tokens: 10, output_tokens: output },
      content: [{ type: "text", text: `out-${messageId}` }],
    },
  });
}

function fixtureClaudeDir(): string {
  const dir = tempDir("radar-store-");
  const slug = join(dir, "projects", "-home-dev-projects-demo");
  mkdirSync(slug, { recursive: true });
  writeFileSync(
    join(slug, "sess-1.jsonl"),
    row("user", { promptId: "p1", promptSource: "typed", message: { content: "build the thing" } }) +
      assistant("m1", 500) +
      row("ai-title", { aiTitle: "Build the thing" }),
  );
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(
    join(dir, "sessions", "123.json"),
    JSON.stringify({ pid: 123, sessionId: "sess-1", cwd: "/home/dev/projects/demo", startedAt: NOW - 60_000, kind: "interactive", name: "demo-1", status: "busy", updatedAt: NOW - 1_000 }),
  );
  mkdirSync(join(dir, "tasks", "sess-1"), { recursive: true });
  writeFileSync(join(dir, "tasks", "sess-1", "1.json"), JSON.stringify({ id: "1", subject: "Step one", status: "in_progress", activeForm: "Doing step one", blocks: [], blockedBy: [] }));
  mkdirSync(join(dir, "jobs"), { recursive: true });
  return dir;
}

function makeStore(dir: string) {
  return new SessionStore({
    claudeDir: dir,
    historyDays: 7,
    maxSessionsPerProject: 20,
    timelineCap: 200,
    heartbeatStaleMs: 60_000,
    activeNowMs: 15_000,
    pidAlive: () => true,
    now: () => NOW,
  });
}

describe("SessionStore", () => {
  test("init builds summaries from transcripts + registry + tasks", async () => {
    const store = makeStore(fixtureClaudeDir());
    await store.init();
    const summaries = store.getSummaries();
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s).toMatchObject({
      sessionId: "sess-1",
      title: "Build the thing",
      project: "demo",
      live: true,
      status: "busy",
      activeNow: true,
      taskCounts: { pending: 0, inProgress: 1, completed: 0 },
    });
    expect(s.usageByModel[0]).toMatchObject({ model: "claude-opus-5", output: 500 });
    expect(s.totalCostUSD).toBeGreaterThan(0);
  });

  test("detail exposes tasks and timeline; incremental tail updates tokens", async () => {
    const dir = fixtureClaudeDir();
    const store = makeStore(dir);
    await store.init();

    const detail1 = store.getDetail("sess-1")!;
    expect(detail1.tasks[0]).toMatchObject({ subject: "Step one", status: "in_progress" });
    expect(detail1.timeline.map((e) => e.kind)).toEqual(["prompt", "assistant"]);

    appendFileSync(join(dir, "projects", "-home-dev-projects-demo", "sess-1.jsonl"), assistant("m2", 250));
    await store.recompute("sess-1", ["transcript"]);
    const detail2 = store.getDetail("sess-1")!;
    expect(detail2.usageByModel[0]!.output).toBe(750);
  });

  test("dead pid flips session to ended on registry refresh", async () => {
    const dir = fixtureClaudeDir();
    let alive = true;
    const store = new SessionStore({
      claudeDir: dir,
      historyDays: 7,
      maxSessionsPerProject: 20,
      timelineCap: 200,
      heartbeatStaleMs: 60_000,
      activeNowMs: 15_000,
      pidAlive: () => alive,
      now: () => NOW,
    });
    await store.init();
    expect(store.getSummaries()[0]!.live).toBe(true);
    alive = false;
    await store.refreshRegistry();
    expect(store.getSummaries()[0]!).toMatchObject({ live: false, status: "ended" });
  });

  test("old transcripts outside history window are skipped unless live", async () => {
    const dir = fixtureClaudeDir();
    const slug = join(dir, "projects", "-home-dev-projects-old");
    mkdirSync(slug, { recursive: true });
    const oldPath = join(slug, "sess-old.jsonl");
    writeFileSync(oldPath, assistant("mo", 10));
    const past = (NOW - 30 * 24 * 3600 * 1000) / 1000;
    const { utimesSync } = await import("node:fs");
    utimesSync(oldPath, past, past);

    const store = makeStore(dir);
    await store.init();
    expect(store.getSummaries().map((s) => s.sessionId)).toEqual(["sess-1"]);
  });

  test("discover picks up a brand-new transcript", async () => {
    const dir = fixtureClaudeDir();
    const store = makeStore(dir);
    await store.init();
    const slug = join(dir, "projects", "-home-dev-projects-demo");
    writeFileSync(join(slug, "sess-2.jsonl"), assistant("mx", 42));
    await store.discover();
    expect(store.getSummaries().map((s) => s.sessionId).sort()).toEqual(["sess-1", "sess-2"]);
  });
});
