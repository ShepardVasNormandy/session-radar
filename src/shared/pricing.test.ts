import { describe, expect, test } from "bun:test";
import { estimateCost, priceFor } from "./pricing.ts";

const MTOK = { input: 1_000_000, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 };

describe("priceFor", () => {
  test("matches exact current model ids", () => {
    expect(priceFor("claude-fable-5")?.inPerMTok).toBe(10);
    expect(priceFor("claude-opus-5")?.inPerMTok).toBe(5);
    expect(priceFor("claude-sonnet-5")?.inPerMTok).toBe(2);
    expect(priceFor("claude-haiku-4-5")?.inPerMTok).toBe(1);
  });

  test("longest-prefix match tolerates dated ids", () => {
    expect(priceFor("claude-opus-4-8")?.inPerMTok).toBe(5);
    expect(priceFor("claude-haiku-4-5-20251001")?.inPerMTok).toBe(1);
  });

  test("longest prefix wins over shorter generic prefix", () => {
    expect(priceFor("claude-opus-4-1")?.inPerMTok).toBe(15);
    expect(priceFor("claude-opus-4-6")?.inPerMTok).toBe(5);
  });

  test("Opus 4.0, dated 4.0 and 4.1 ids bill at 15/75 while 4.5+ stay 5/25", () => {
    for (const id of ["claude-opus-4-0", "claude-opus-4-20250514", "claude-opus-4-1", "claude-opus-4-1-20250805"]) {
      expect(priceFor(id)?.inPerMTok).toBe(15);
      expect(priceFor(id)?.outPerMTok).toBe(75);
      expect(priceFor(id)?.cacheReadPerMTok).toBe(1.5);
    }
    expect(priceFor("claude-opus-4-8")?.inPerMTok).toBe(5);
    expect(priceFor("claude-opus-4-8")?.outPerMTok).toBe(25);
  });

  test("x-5-1 and x-5-5 ids are not stolen by their x-5 prefix", () => {
    expect(priceFor("claude-fable-5-1")?.cacheReadPerMTok).toBe(0.25);
    expect(priceFor("claude-fable-5")?.cacheReadPerMTok).toBe(1);
    expect(priceFor("claude-mythos-5-1")?.cacheReadPerMTok).toBe(0.25);
    expect(priceFor("claude-mythos-5")?.cacheReadPerMTok).toBe(1);
    expect(priceFor("claude-opus-5-5")?.inPerMTok).toBe(4);
    expect(priceFor("claude-opus-5")?.inPerMTok).toBe(5);
    expect(priceFor("claude-sonnet-5-5")?.inPerMTok).toBe(2);
    expect(priceFor("claude-sonnet-5")?.inPerMTok).toBe(2);
    expect(priceFor("claude-haiku-5-5")?.inPerMTok).toBe(0.1);
  });

  test("unknown model returns null", () => {
    expect(priceFor("gpt-9-mega")).toBeNull();
    expect(priceFor("claude-unknown-9")).toBeNull();
    expect(priceFor("")).toBeNull();
  });
});

describe("estimateCost per model", () => {
  const cases: [model: string, input: number, output: number, cacheRead: number][] = [
    ["claude-fable-5-1", 10, 50, 0.25],
    ["claude-mythos-5-1", 10, 50, 0.25],
    ["claude-fable-5", 10, 50, 1],
    ["claude-mythos-5", 10, 50, 1],
    ["claude-opus-5-5", 4, 20, 0.2],
    ["claude-opus-5", 5, 25, 0.5],
    ["claude-opus-4-8", 5, 25, 0.5],
    ["claude-opus-4-7", 5, 25, 0.5],
    ["claude-opus-4-6", 5, 25, 0.5],
    ["claude-opus-4-5", 5, 25, 0.5],
    ["claude-opus-4-0", 15, 75, 1.5],
    ["claude-opus-4-1", 15, 75, 1.5],
    ["claude-opus-4-20250514", 15, 75, 1.5],
    ["claude-sonnet-5-5", 2, 10, 0.2],
    ["claude-sonnet-5", 2, 10, 0.2],
    ["claude-sonnet-4-6", 3, 15, 0.3],
    ["claude-haiku-5-5", 0.1, 0.5, 0.01],
    ["claude-haiku-4-5", 1, 5, 0.1],
    ["claude-3-5-haiku", 0.8, 4, 0.08],
  ];

  test.each(cases)("%s: $%p in / $%p out / $%p cache read per MTok", (model, input, output, cacheRead) => {
    const p = priceFor(model)!;
    expect(p).not.toBeNull();
    expect(estimateCost(MTOK, p)).toBeCloseTo(input, 6);
    expect(estimateCost({ ...MTOK, input: 0, output: 1_000_000 }, p)).toBeCloseTo(output, 6);
    expect(estimateCost({ ...MTOK, input: 0, cacheRead: 1_000_000 }, p)).toBeCloseTo(cacheRead, 6);
    expect(estimateCost({ ...MTOK, input: 0, cache5m: 1_000_000 }, p)).toBeCloseTo(input * 1.25, 6);
    expect(estimateCost({ ...MTOK, input: 0, cache1h: 1_000_000 }, p)).toBeCloseTo(input * 2, 6);
  });

  test("Sonnet 5 costs $2 in / $10 out", () => {
    const p = priceFor("claude-sonnet-5")!;
    expect(estimateCost({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cache5m: 0, cache1h: 0 }, p)).toBeCloseTo(12, 6);
  });
});

describe("estimateCost", () => {
  test("computes cost from all buckets", () => {
    const p = priceFor("claude-opus-5")!;
    const usage = {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cache5m: 1_000_000,
      cache1h: 1_000_000,
    };
    // 5 + 25 + 0.5 + 6.25 + 10
    expect(estimateCost(usage, p)).toBeCloseTo(46.75, 5);
  });

  test("zero usage costs zero", () => {
    const p = priceFor("claude-fable-5")!;
    expect(estimateCost({ input: 0, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 }, p)).toBe(0);
  });
});
