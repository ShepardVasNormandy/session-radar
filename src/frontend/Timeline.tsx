import { useEffect, useRef, useState } from "react";
import type { TimelineEvent } from "../shared/types.ts";
import { clockTime } from "./format.ts";

function glyph(ev: TimelineEvent): string {
  switch (ev.kind) {
    case "prompt":
      return "❯";
    case "assistant":
      return "●";
    case "tool":
      return ev.isError ? "✗" : "⚙";
    case "away-summary":
      return "✉";
    case "subagent":
      return "⇉";
    case "turn":
      return "·";
  }
}

function text(ev: TimelineEvent): string {
  switch (ev.kind) {
    case "prompt":
    case "assistant":
    case "away-summary":
      return ev.text;
    case "tool":
      return `${ev.tool}  ${ev.summary}`;
    case "subagent":
      return `${ev.agentType}: ${ev.description}`;
    case "turn":
      return `turn (${Math.round(ev.durationMs / 1000)}s)`;
  }
}

export function Timeline(props: { events: TimelineEvent[]; truncated: number; live: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const count = props.events.length;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom || el.scrollTop === 0) el.scrollTop = el.scrollHeight;
  }, [count, collapsed]);

  return (
    <div className="panel timeline">
      <button className="panel-head collapsible" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span className="chevron">{collapsed ? "▸" : "▾"}</span>
        <span>activity</span>
        <span className="panel-sub">{count} events</span>
      </button>
      {collapsed ? null : (
      <div className="timeline-scroll" ref={ref}>
        {props.truncated > 0 && <div className="truncated-note">… {props.truncated} earlier events not shown</div>}
        {props.events.map((ev, i) => (
          <div key={i} className={`tl-row ${ev.kind} ${ev.kind === "tool" && ev.isError ? "error" : ""}`}>
            <span className="tl-time">{clockTime(ev.ts)}</span>
            <span className="tl-glyph">{glyph(ev)}</span>
            <span className="tl-text">{text(ev)}</span>
          </div>
        ))}
        {count === 0 && <div className="empty">no activity parsed</div>}
      </div>
      )}
    </div>
  );
}
