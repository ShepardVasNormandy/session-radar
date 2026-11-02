import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, readRegistry } from "./registry.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const NOW = 1_800_000_000_000;

const ENTRY = {
  pid: 123,
  sessionId: "s1",
  cwd: "/home/dev/projects",
  startedAt: NOW - 60_000,
  kind: "interactive" as const,
  name: "demo-session",
  status: "busy",
  updatedAt: NOW - 2_000,
  waitingFor: undefined,
};

describe("readRegistry", () => {
  test("parses entries and skips garbage files", async () => {
    const dir = tempDir("radar-reg-");
    writeFileSync(join(dir, "123.json"), JSON.stringify(ENTRY));
    writeFileSync(join(dir, "999.json"), "not json at all");
    const entries = await readRegistry(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ pid: 123, sessionId: "s1", name: "demo-session" });
  });

  test("missing dir yields empty list", async () => {
    expect(await readRegistry("/nonexistent/sessions")).toEqual([]);
  });
});

describe("classify", () => {
  const opts = { heartbeatStaleMs: 60_000, activeNowMs: 15_000 };

  test("fresh heartbeat + alive pid → live busy activeNow", () => {
    const c = classify(ENTRY, NOW, { ...opts, pidAlive: () => true });
    expect(c).toEqual({ live: true, status: "busy", activeNow: true });
  });

  test("waiting status maps through", () => {
    const c = classify({ ...ENTRY, status: "waiting", updatedAt: NOW - 2_000 }, NOW, { ...opts, pidAlive: () => true });
    expect(c.status).toBe("waiting");
    expect(c.activeNow).toBe(false);
  });

  test("busy with no recent evidence → stale, not activeNow", () => {
    const c = classify({ ...ENTRY, updatedAt: NOW - 3_600_000 }, NOW, { ...opts, pidAlive: () => true });
    expect(c).toEqual({ live: true, status: "stale", activeNow: false });
  });

  test("busy with old updatedAt but fresh transcript activity stays busy", () => {
    const c = classify({ ...ENTRY, updatedAt: NOW - 3_600_000 }, NOW, { ...opts, pidAlive: () => true }, NOW - 5_000);
    expect(c).toEqual({ live: true, status: "busy", activeNow: true });
  });

  test("idle never goes stale", () => {
    const c = classify({ ...ENTRY, status: "idle", updatedAt: NOW - 86_400_000 }, NOW, { ...opts, pidAlive: () => true });
    expect(c.status).toBe("idle");
  });

  test("dead pid → ended", () => {
    const c = classify(ENTRY, NOW, { ...opts, pidAlive: () => false });
    expect(c).toEqual({ live: false, status: "ended", activeNow: false });
  });
});
