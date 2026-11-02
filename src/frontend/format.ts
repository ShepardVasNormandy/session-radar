import type { ModelUsage, TaskItem } from "../shared/types.ts";

export function totalTokens(usage: ModelUsage[]): number {
  return usage.reduce((sum, u) => sum + u.input + u.output + u.cacheRead + u.cache5m + u.cache1h, 0);
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function formatUSD(v: number | null): string {
  if (v === null) return "—";
  if (v !== 0 && v < 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export function formatCost(total: number | null, partial: boolean): string {
  return partial && total !== null ? `≥ ${formatUSD(total)}` : formatUSD(total);
}

export function relTime(ts: number, now = Date.now()): string {
  if (ts <= 0) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clockTime(ts: number): string {
  if (ts <= 0) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function openBlockers(task: TaskItem, tasks: TaskItem[]): string[] {
  if (task.status === "completed") return [];
  const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
  return task.blockedBy.filter((id) => !done.has(id));
}
