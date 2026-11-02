import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJob } from "./jobs.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("readJob", () => {
  test("reads state.json and maps children to artifacts", async () => {
    const root = tempDir("radar-jobs-");
    mkdirSync(join(root, "job-0001"));
    writeFileSync(
      join(root, "job-0001", "state.json"),
      JSON.stringify({
        state: "blocked",
        detail: "steps 1-3 complete",
        tokens: 1_213_711,
        needs: "auth",
        output: { result: "Report published" },
        children: [
          { id: "42", href: "https://github.com/x/y/pull/42", kind: "pr" },
          { id: "a.html", href: "https://claude.ai/code/artifact/e7", kind: "frame", title: "Audit" },
        ],
      }),
    );
    const job = await readJob(root, "job-0001");
    expect(job?.info).toMatchObject({ jobId: "job-0001", state: "blocked", tokens: 1_213_711, needs: "auth", result: "Report published" });
    expect(job?.artifacts).toEqual([
      { title: "42", url: "https://github.com/x/y/pull/42", path: undefined, source: "job", kind: "pr" },
      { title: "Audit", url: "https://claude.ai/code/artifact/e7", path: undefined, source: "job", kind: "artifact" },
    ]);
  });

  test("missing job dir yields null", async () => {
    expect(await readJob("/nonexistent", "zzz")).toBeNull();
  });
});
