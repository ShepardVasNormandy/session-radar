import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTasks, taskCounts } from "./tasks.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("readTasks", () => {
  test("reads numeric json files, skips lock/highwatermark, sorts by numeric id", async () => {
    const root = tempDir("radar-tasks-");
    const dir = join(root, "sess-1");
    mkdirSync(dir);
    writeFileSync(join(dir, "2.json"), JSON.stringify({ id: "2", subject: "B", status: "in_progress", activeForm: "Doing B", blocks: [], blockedBy: ["1"] }));
    writeFileSync(join(dir, "10.json"), JSON.stringify({ id: "10", subject: "J", status: "pending", blocks: [], blockedBy: [] }));
    writeFileSync(join(dir, "1.json"), JSON.stringify({ id: "1", subject: "A", status: "completed", blocks: ["2"], blockedBy: [] }));
    writeFileSync(join(dir, ".lock"), "");
    writeFileSync(join(dir, ".highwatermark"), "10");
    writeFileSync(join(dir, "bad.json"), "{nope");

    const tasks = await readTasks(root, "sess-1");
    expect(tasks.map((t) => t.id)).toEqual(["1", "2", "10"]);
    expect(tasks[1]).toMatchObject({ subject: "B", status: "in_progress", blockedBy: ["1"] });
  });

  test("missing dir yields empty list", async () => {
    expect(await readTasks("/nonexistent", "s")).toEqual([]);
  });

  test("taskCounts groups statuses", () => {
    expect(
      taskCounts([
        { id: "1", subject: "", status: "completed", blocks: [], blockedBy: [] },
        { id: "2", subject: "", status: "in_progress", blocks: [], blockedBy: [] },
        { id: "3", subject: "", status: "pending", blocks: [], blockedBy: [] },
        { id: "4", subject: "", status: "pending", blocks: [], blockedBy: [] },
      ]),
    ).toEqual({ pending: 2, inProgress: 1, completed: 1 });
  });
});
