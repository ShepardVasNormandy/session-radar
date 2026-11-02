import { useState } from "react";
import type { SessionSummary } from "../shared/types.ts";
import { SessionCard } from "./SessionCard.tsx";

const STATUS_RANK: Record<string, number> = { busy: 0, waiting: 1, idle: 2, stale: 3, ended: 4 };

export type SessionFilter = "all" | "live" | "ended";

export function order(a: SessionSummary, b: SessionSummary): number {
  if (a.live !== b.live) return a.live ? -1 : 1;
  const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (a.live && rank !== 0) return rank;
  return b.lastActivity - a.lastActivity;
}

const FILTERS: SessionFilter[] = ["all", "live", "ended"];

export function SessionList(props: {
  summaries: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<SessionFilter>("all");
  const sorted = [...props.summaries].sort(order);
  const visible = sorted.filter((s) => (filter === "all" ? true : filter === "live" ? s.live : !s.live));
  const live = visible.filter((s) => s.live);
  const past = visible.filter((s) => !s.live);
  return (
    <nav className="session-list">
      <div className="filter-row" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`filter-btn ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {live.length > 0 && <div className="list-head">live — {live.length}</div>}
      {live.map((s) => (
        <SessionCard key={s.sessionId} summary={s} selected={s.sessionId === props.selectedId} onSelect={props.onSelect} />
      ))}
      {past.length > 0 && <div className="list-head">ended — {past.length}</div>}
      {past.map((s) => (
        <SessionCard key={s.sessionId} summary={s} selected={s.sessionId === props.selectedId} onSelect={props.onSelect} />
      ))}
      {visible.length === 0 && <div className="empty">nothing matches this filter</div>}
    </nav>
  );
}
