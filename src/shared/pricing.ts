import type { Usage } from "./types.ts";

export interface ModelPricing {
  inPerMTok: number;
  outPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
}

function derive(inPerMTok: number, outPerMTok: number, cacheReadPerMTok = inPerMTok * 0.1): ModelPricing {
  // Cache read defaults to 0.1x input; writes are 1.25x (5m TTL) / 2x (1h TTL) input.
  return {
    inPerMTok,
    outPerMTok,
    cacheReadPerMTok,
    cacheWrite5mPerMTok: inPerMTok * 1.25,
    cacheWrite1hPerMTok: inPerMTok * 2,
  };
}

// First-party API rates as of 2026-11-02. Matched by longest prefix, so
// "claude-opus-5-5" wins over "claude-opus-5".
// Haiku 5.5 bills prompts over 100K input tokens at 0.50 / 2.50; costs here are
// computed on per-model totals, so the base rate is applied throughout.
const PRICES: Record<string, ModelPricing> = {
  "claude-fable-5-1": derive(10, 50, 0.25),
  "claude-mythos-5-1": derive(10, 50, 0.25),
  "claude-fable-5": derive(10, 50),
  "claude-mythos-5": derive(10, 50),
  "claude-opus-5-5": derive(4, 20, 0.2),
  "claude-opus-5": derive(5, 25),
  "claude-opus-4-8": derive(5, 25),
  "claude-opus-4-7": derive(5, 25),
  "claude-opus-4-6": derive(5, 25),
  "claude-opus-4-5": derive(5, 25),
  "claude-opus-4": derive(15, 75, 1.5),
  "claude-sonnet-5-5": derive(2, 10),
  "claude-sonnet-5": derive(2, 10),
  "claude-sonnet-4": derive(3, 15),
  "claude-haiku-5-5": derive(0.1, 0.5),
  "claude-haiku-4-5": derive(1, 5),
  "claude-3-5-haiku": derive(0.8, 4),
};

export function priceFor(modelId: string): ModelPricing | null {
  let best: { len: number; pricing: ModelPricing } | null = null;
  for (const [prefix, pricing] of Object.entries(PRICES)) {
    if (modelId.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, pricing };
    }
  }
  return best?.pricing ?? null;
}

export function estimateCost(u: Usage, p: ModelPricing): number {
  return (
    (u.input * p.inPerMTok +
      u.output * p.outPerMTok +
      u.cacheRead * p.cacheReadPerMTok +
      u.cache5m * p.cacheWrite5mPerMTok +
      u.cache1h * p.cacheWrite1hPerMTok) /
    1_000_000
  );
}
