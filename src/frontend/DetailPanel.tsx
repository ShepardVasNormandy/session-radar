import type { SessionDetail } from "../shared/types.ts";
import { ArtifactList } from "./ArtifactList.tsx";
import { formatTokens, relTime } from "./format.ts";
import { SubagentList } from "./SubagentList.tsx";
import { TaskChecklist } from "./TaskChecklist.tsx";
import { Timeline } from "./Timeline.tsx";
import { TokenStats } from "./TokenStats.tsx";

export function DetailPanel(props: { detail: SessionDetail | null; hasSelection: boolean }) {
  const d = props.detail;
  if (!props.hasSelection) {
    return (
      <section className="detail placeholder">
        <div className="placeholder-inner">
          <span className="sweep big" aria-hidden="true" />
          <p>select a session to inspect</p>
        </div>
      </section>
    );
  }
  if (!d) {
    return (
      <section className="detail placeholder">
        <div className="placeholder-inner">
          <p>loading…</p>
        </div>
      </section>
    );
  }
  return (
    <section className="detail">
      <header className="detail-head">
        <div className="detail-title-row">
          <span className={`dot ${d.status} ${d.activeNow ? "pulse" : ""}`} />
          <h2>{d.title}</h2>
          <span className={`status-chip ${d.status}`}>
            {d.status}
            {d.waitingFor ? ` · ${d.waitingFor}` : ""}
          </span>
        </div>
        <div className="detail-meta">
          <span className="chip" title={d.cwd}>
            {d.cwd || "?"}
          </span>
          {d.gitBranch && <span className="chip">⎇ {d.gitBranch}</span>}
          {d.kind && <span className="chip">{d.kind}</span>}
          <span className="chip">{d.turnCount} turns</span>
          <span className="chip">started {relTime(d.startedAt)}</span>
          {d.parseErrors > 0 && <span className="chip warn">{d.parseErrors} parse errors</span>}
        </div>
        {d.job && (
          <div className={`job-strip ${d.job.state}`}>
            <span className="job-state">job {d.job.jobId} · {d.job.state}</span>
            {d.job.tokens !== undefined && <span>{formatTokens(d.job.tokens)} tok</span>}
            {d.job.detail && <span className="job-detail">{d.job.detail}</span>}
            {d.job.needs && <span className="job-needs">needs: {d.job.needs}</span>}
          </div>
        )}
      </header>
      {d.tasks.length > 0 && <TaskChecklist tasks={d.tasks} />}
      <div className="detail-grid">
        <Timeline events={d.timeline} truncated={d.timelineTruncated} live={d.live} />
        <aside className="side-col">
          <TokenStats usage={d.usageByModel} totalCostUSD={d.totalCostUSD} costPartial={d.costPartial} />
          <ArtifactList artifacts={d.artifacts} />
          <SubagentList subagents={d.subagents} />
        </aside>
      </div>
    </section>
  );
}
