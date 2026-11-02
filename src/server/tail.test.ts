import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshTail, readNewLines, streamLines } from "./tail.ts";

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempFile(content: string): string {
  const dir = tempDir("radar-tail-");
  const path = join(dir, "t.jsonl");
  writeFileSync(path, content);
  return path;
}

describe("readNewLines", () => {
  test("reads complete lines, then only appended ones", async () => {
    const path = tempFile('{"a":1}\n{"b":2}\n');
    const r1 = await readNewLines(path, freshTail());
    expect(r1.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(r1.reset).toBe(false);

    const r2 = await readNewLines(path, r1.state);
    expect(r2.lines).toEqual([]);

    appendFileSync(path, '{"c":3}\n');
    const r3 = await readNewLines(path, r2.state);
    expect(r3.lines).toEqual(['{"c":3}']);
  });

  test("buffers a partial trailing line until completed", async () => {
    const path = tempFile('{"a":1}\n{"b":');
    const r1 = await readNewLines(path, freshTail());
    expect(r1.lines).toEqual(['{"a":1}']);

    appendFileSync(path, "2}\n");
    const r2 = await readNewLines(path, r1.state);
    expect(r2.lines).toEqual(['{"b":2}']);
  });

  test("file shrunk below offset signals reset and re-reads from start", async () => {
    const path = tempFile('{"a":1}\n{"b":2}\n');
    const r1 = await readNewLines(path, freshTail());
    writeFileSync(path, '{"z":9}\n');
    const r2 = await readNewLines(path, r1.state);
    expect(r2.reset).toBe(true);
    expect(r2.lines).toEqual(['{"z":9}']);
  });

  test("missing file yields no lines and keeps state", async () => {
    const r = await readNewLines("/nonexistent/nope.jsonl", freshTail());
    expect(r.lines).toEqual([]);
    expect(r.reset).toBe(false);
  });
});

describe("streamLines", () => {
  test("streams every line and returns the byte offset", async () => {
    const body = '{"a":1}\n{"b":2}\n{"c":3}\n';
    const path = tempFile(body);
    const seen: string[] = [];
    const offset = await streamLines(path, (l) => seen.push(l));
    expect(seen).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(offset).toBe(Buffer.byteLength(body));
  });
});
