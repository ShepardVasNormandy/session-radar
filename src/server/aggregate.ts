import { estimateCost, priceFor } from "../shared/pricing.ts";
import type { ActivitySeries, Artifact, ModelUsage, TimelineEvent, Usage } from "../shared/types.ts";
import { parseRecord } from "./transcript.ts";

type TimelineItem = TimelineEvent & { toolUseId?: string };

export interface SessionAgg {
  cap: number;
  byMessageId: Map<string, { model: string; usage: Usage }>;
  timeline: TimelineItem[];
  timelineTruncated: number;
  artifacts: Artifact[];
  customTitle?: string;
  aiTitle?: string;
  firstPrompt?: string;
  cwd?: string;
  gitBranch?: string;
  startedAt: number;
  lastActivity: number;
  turnCount: number;
  parseErrors: number;
  seenTextIds: Set<string>;
  activityBuckets: Map<number, number>;
}

export function newAgg(cap = 200): SessionAgg {
  return {
    cap,
    byMessageId: new Map(),
    timeline: [],
    timelineTruncated: 0,
    artifacts: [],
    startedAt: 0,
    lastActivity: 0,
    turnCount: 0,
    parseErrors: 0,
    seenTextIds: new Set(),
    activityBuckets: new Map(),
  };
}

const ACTIVITY_BUCKET_MS = 900_000;

function push(agg: SessionAgg, ev: TimelineItem): void {
  agg.timeline.push(ev);
  if (agg.timeline.length > agg.cap) {
    agg.timeline.shift();
    agg.timelineTruncated++;
  }
}

function touch(agg: SessionAgg, ts: number): void {
  if (ts <= 0) return;
  if (agg.startedAt === 0 || ts < agg.startedAt) agg.startedAt = ts;
  if (ts > agg.lastActivity) agg.lastActivity = ts;
  const bucket = Math.floor(ts / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;
  agg.activityBuckets.set(bucket, (agg.activityBuckets.get(bucket) ?? 0) + 1);
}

export function activitySeries(agg: SessionAgg, now: number, bucketMs: number, buckets: number): ActivitySeries {
  const endBucket = Math.floor(now / bucketMs) * bucketMs;
  const start = endBucket - (buckets - 1) * bucketMs;
  const counts = new Array<number>(buckets).fill(0);
  for (const [bucket, count] of agg.activityBuckets) {
    // stored buckets use ACTIVITY_BUCKET_MS; re-bucket if a different width was asked for
    const idx = Math.floor((bucket - start) / bucketMs);
    if (idx >= 0 && idx < buckets) counts[idx] = (counts[idx] ?? 0) + count;
  }
  return { start, bucketMs, counts };
}

export function applyLine(agg: SessionAgg, line: string): void {
  const rec = parseRecord(line);
  if (rec === null) {
    agg.parseErrors++;
    return;
  }
  switch (rec.kind) {
    case "assistant": {
      if (rec.isSidechain) return;
      touch(agg, rec.ts);
      if (rec.cwd) agg.cwd = rec.cwd;
      if (rec.gitBranch) agg.gitBranch = rec.gitBranch;
      if (rec.messageId) agg.byMessageId.set(rec.messageId, { model: rec.model, usage: rec.usage });
      if (rec.text && !agg.seenTextIds.has(rec.messageId)) {
        agg.seenTextIds.add(rec.messageId);
        push(agg, { ts: rec.ts, kind: "assistant", text: rec.text, model: rec.model });
      }
      for (const tool of rec.toolUses) {
        push(agg, { ts: rec.ts, kind: "tool", tool: tool.name, summary: tool.summary, toolUseId: tool.id });
      }
      return;
    }
    case "prompt": {
      if (rec.isSidechain) return;
      touch(agg, rec.ts);
      if (rec.cwd) agg.cwd = rec.cwd;
      agg.firstPrompt ??= rec.text;
      push(agg, { ts: rec.ts, kind: "prompt", text: rec.text });
      return;
    }
    case "tool-result": {
      if (rec.isSidechain) return;
      touch(agg, rec.ts);
      if (rec.isError) {
        const ev = agg.timeline.find((e) => e.kind === "tool" && e.toolUseId === rec.toolUseId);
        if (ev && ev.kind === "tool") ev.isError = true;
      }
      if (rec.artifact) {
        const artifact: Artifact = {
          title: rec.artifact.title ?? rec.artifact.url,
          url: rec.artifact.url,
          path: rec.artifact.path,
          source: "transcript",
          kind: "artifact",
        };
        const i = agg.artifacts.findIndex((a) => a.url === artifact.url);
        if (i >= 0) agg.artifacts[i] = artifact;
        else agg.artifacts.push(artifact);
      }
      return;
    }
    case "turn":
      touch(agg, rec.ts);
      agg.turnCount++;
      return;
    case "away-summary":
      touch(agg, rec.ts);
      push(agg, { ts: rec.ts, kind: "away-summary", text: rec.text });
      return;
    case "ai-title":
      agg.aiTitle = rec.title;
      return;
    case "custom-title":
      agg.customTitle = rec.title;
      return;
    case "other":
      return;
  }
}

export function usageByModel(agg: SessionAgg, extra?: Map<string, { model: string; usage: Usage }>[]): ModelUsage[] {
  const totals = new Map<string, Usage>();
  const sources = [agg.byMessageId, ...(extra ?? [])];
  for (const source of sources) {
    for (const { model, usage } of source.values()) {
      const t = totals.get(model) ?? { input: 0, output: 0, cacheRead: 0, cache5m: 0, cache1h: 0 };
      t.input += usage.input;
      t.output += usage.output;
      t.cacheRead += usage.cacheRead;
      t.cache5m += usage.cache5m;
      t.cache1h += usage.cache1h;
      totals.set(model, t);
    }
  }
  return [...totals.entries()].map(([model, usage]) => {
    const pricing = priceFor(model);
    return { model, ...usage, costUSD: pricing ? estimateCost(usage, pricing) : null };
  });
}

export function summarizeCost(byModel: ModelUsage[]): { total: number | null; partial: boolean } {
  const priced = byModel.filter((m) => m.costUSD !== null);
  const partial = priced.length < byModel.length;
  if (byModel.length === 0) return { total: 0, partial: false };
  if (priced.length === 0) return { total: null, partial };
  return { total: priced.reduce((sum, m) => sum + (m.costUSD ?? 0), 0), partial };
}

export function resolveTitle(agg: SessionAgg, registryName: string | undefined, sessionId: string): string {
  return agg.customTitle ?? agg.aiTitle ?? registryName ?? agg.firstPrompt ?? sessionId.slice(0, 8);
}
