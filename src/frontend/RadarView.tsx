import { useState } from "react";
import type { SessionDetail, SessionSummary } from "../shared/types.ts";
import { clockTime, formatTokens, relTime, totalTokens } from "./format.ts";
import { order } from "./SessionList.tsx";
import { StepFlow } from "./StepFlow.tsx";

// Node-type palette validated for dark surface (dataviz six checks): CVD-safe, in-band.
const NODE_COLORS = { subagent: "#3a86b8", artifact: "#1fa565", job: "#c1772a" } as const;

function Swimlanes(props: { summaries: SessionSummary[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const rows = [...props.summaries].sort(order).filter((s) => s.live || s.activity.counts.some((c) => c > 0));
  if (rows.length === 0) return <div className="empty">no activity in the last 12h</div>;
  const first = rows[0]!.activity;
  const buckets = first.counts.length;
  const max = Math.max(1, ...rows.map((s) => Math.max(...s.activity.counts)));
  const ticks: { idx: number; label: string }[] = [];
  for (let i = 0; i < buckets; i += 8) {
    ticks.push({ idx: i, label: clockTime(first.start + i * first.bucketMs) });
  }
  return (
    <div className="panel swimlanes">
      <div className="panel-head">
        <span>activity — last 12h</span>
        <span className="panel-sub">{rows.length} sessions</span>
      </div>
      <div className="lane axis">
        <span className="lane-label" />
        <div className="lane-strip axis-strip">
          {ticks.map((t) => (
            <span key={t.idx} className="axis-tick" style={{ left: `${(t.idx / buckets) * 100}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {rows.map((s) => (
        <button
          key={s.sessionId}
          className={`lane ${s.sessionId === props.selectedId ? "selected" : ""}`}
          onClick={() => props.onSelect(s.sessionId)}
        >
          <span className="lane-label">
            <span className={`dot ${s.status} ${s.activeNow ? "pulse" : ""}`} />
            <span className="lane-title">{s.title}</span>
          </span>
          <span className="lane-strip">
            <svg viewBox={`0 0 ${buckets} 10`} preserveAspectRatio="none" aria-label={`activity for ${s.title}`}>
              {s.activity.counts.map((c, i) =>
                c > 0 ? (
                  <rect key={i} x={i + 0.08} y={0.5} width={0.84} height={9} rx={0.3} fill="#4ef09b" opacity={0.2 + 0.8 * Math.sqrt(c / max)}>
                    <title>{`${c} events · ${clockTime(s.activity.start + i * s.activity.bucketMs)}`}</title>
                  </rect>
                ) : null,
              )}
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
}

function ContextCard(props: { detail: SessionDetail }) {
  const d = props.detail;
  return (
    <div className="panel context-card">
      <div className="panel-head">
        <span>context</span>
        <span className="panel-sub cost-total">{formatTokens(totalTokens(d.usageByModel))}</span>
      </div>
      <div className="context-body">
        <div className="detail-title-row">
          <span className={`dot ${d.status} ${d.activeNow ? "pulse" : ""}`} />
          <span className="context-title">{d.title}</span>
        </div>
        <div className="detail-meta">
          <span className="chip" title={d.cwd}>
            {d.project}
          </span>
          {d.gitBranch && <span className="chip">⎇ {d.gitBranch}</span>}
          <span className="chip">{d.turnCount} turns</span>
          <span className="chip">{relTime(d.lastActivity)}</span>
        </div>
      </div>
    </div>
  );
}

function CompactMap(props: { detail: SessionDetail }) {
  const d = props.detail;
  const [collapsed, setCollapsed] = useState(true);
  const rows = [
    ...d.subagents.map((a) => ({
      key: `sub-${a.id}`,
      color: NODE_COLORS.subagent,
      label: a.description || a.id,
      sub: `${a.agentType} · ${formatTokens(a.usageByModel.reduce((n, u) => n + u.output, 0))} out`,
      href: undefined as string | undefined,
    })),
    ...d.artifacts.map((a, i) => ({
      key: `art-${i}`,
      color: NODE_COLORS.artifact,
      label: a.title,
      sub: a.kind === "pr" ? "pull request" : "artifact",
      href: a.url,
    })),
    ...(d.job ? [{ key: "job", color: NODE_COLORS.job, label: `job ${d.job.jobId}`, sub: d.job.state, href: undefined }] : []),
  ];
  return (
    <div className="panel">
      <button className="panel-head collapsible" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span className="chevron">{collapsed ? "▸" : "▾"}</span>
        <span>session map</span>
        <span className="panel-sub">{rows.length}</span>
      </button>
      {collapsed ? null : rows.length === 0 ? (
        <div className="empty">no subagents, artifacts or jobs yet</div>
      ) : (
        <ul className="map-list">
          {rows.map((r) => (
            <li key={r.key}>
              <i className="map-dot" style={{ background: r.color }} />
              <span className="map-body">
                {r.href ? (
                  <a href={r.href} target="_blank" rel="noreferrer">
                    {r.label}
                  </a>
                ) : (
                  <span className="map-label">{r.label}</span>
                )}
                <span className="map-sub">{r.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RadarView(props: {
  summaries: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  detail: SessionDetail | null;
}) {
  const d = props.detail;
  return (
    <section className="radar-view">
      <Swimlanes summaries={props.summaries} selectedId={props.selectedId} onSelect={props.onSelect} />
      {d ? (
        <div className="radar-grid">
          <StepFlow tasks={d.tasks} live={d.live} title={d.title} />
          <aside className="side-col">
            <ContextCard detail={d} />
            <CompactMap detail={d} />
          </aside>
        </div>
      ) : (
        <div className="panel">
          <div className="empty">select a lane to see its steps</div>
        </div>
      )}
    </section>
  );
}
