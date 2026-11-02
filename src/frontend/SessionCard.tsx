import type { SessionSummary } from "../shared/types.ts";
import { formatTokens, relTime, totalTokens } from "./format.ts";

export function SessionCard(props: { summary: SessionSummary; selected: boolean; onSelect: (id: string) => void }) {
  const s = props.summary;
  const total = s.taskCounts.pending + s.taskCounts.inProgress + s.taskCounts.completed;
  return (
    <button className={`card ${props.selected ? "selected" : ""}`} onClick={() => props.onSelect(s.sessionId)}>
      <span className={`dot ${s.status} ${s.activeNow ? "pulse" : ""}`} title={s.status} />
      <span className="card-body">
        <span className="card-title">{s.title}</span>
        <span className="card-meta">
          <span className="chip">{s.project}</span>
          {s.kind === "bg" && <span className="chip bg-chip">bg</span>}
          <span>{relTime(s.lastActivity)}</span>
          {total > 0 && (
            <span className="tasks-mini">
              ✓{s.taskCounts.completed}/{total}
            </span>
          )}
        </span>
      </span>
      <span className="card-cost">{formatTokens(totalTokens(s.usageByModel))}</span>
    </button>
  );
}
