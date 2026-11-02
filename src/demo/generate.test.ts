import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../server/store.ts";
import { DEMO_ARTIFACT_URL, DEMO_LIVE_COUNT, DEMO_SESSION_COUNT, generateDemo } from "./generate.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-11-02T15:00:00.000Z");

function setup() {
  const dir = tempDir("radar-demo-");
  const pids = Array.from({ length: DEMO_LIVE_COUNT }, (_, i) => 1000 + i);
  const demo = generateDemo(dir, { now: NOW, pids });
  const store = new SessionStore({
    claudeDir: dir,
    historyDays: 7,
    maxSessionsPerProject: 20,
    timelineCap: 200,
    heartbeatStaleMs: 1_800_000,
    activeNowMs: 300_000,
    pidAlive: (pid) => pids.includes(pid),
    now: () => NOW,
  });
  return { demo, store };
}

describe("generateDemo", () => {
  test("store loads every demo session without parse errors", async () => {
    const { store } = setup();
    await store.init();
    const summaries = store.getSummaries();
    expect(summaries).toHaveLength(DEMO_SESSION_COUNT);
    expect(DEMO_SESSION_COUNT).toBe(6);
    expect(summaries.every((s) => s.parseErrors === 0)).toBe(true);

    const statuses = summaries.map((s) => s.status).sort();
    expect(statuses).toEqual(["busy", "busy", "ended", "ended", "idle", "waiting"]);
    expect(new Set(summaries.map((s) => s.project))).toEqual(new Set(["storefront", "docs-site", "infra-tools"]));
    expect(summaries.reduce((n, s) => n + s.subagentCount, 0)).toBe(2);
    expect(summaries.every((s) => s.totalCostUSD !== null && !s.costPartial)).toBe(true);
    expect(summaries.filter((s) => s.activeNow)).toHaveLength(2);

    const withJob = summaries.find((s) => s.jobId)!;
    const detail = store.getDetail(withJob.sessionId)!;
    expect(detail.job?.state).toBe("running");
    expect(detail.artifacts.some((a) => a.url === DEMO_ARTIFACT_URL)).toBe(true);
  });

  test("tick appends parseable activity to a busy session", async () => {
    const { demo, store } = setup();
    await store.init();
    const before = new Map(store.getSummaries().map((s) => [s.sessionId, s.lastActivity]));
    demo.tick(NOW + 60_000);
    for (const id of demo.sessionIds) await store.recompute(id, ["transcript"]);
    const moved = store.getSummaries().filter((s) => s.lastActivity > before.get(s.sessionId)!);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.status).toBe("busy");
    expect(moved[0]!.parseErrors).toBe(0);
  });
});
