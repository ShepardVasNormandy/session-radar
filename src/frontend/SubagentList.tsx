import type { SubagentInfo } from "../shared/types.ts";
import { formatTokens, relTime } from "./format.ts";

export function SubagentList(props: { subagents: SubagentInfo[] }) {
  if (props.subagents.length === 0) return null;
  const sorted = [...props.subagents].sort((a, b) => b.lastActivity - a.lastActivity);
  return (
    <div className="panel">
      <div className="panel-head">
        <span>subagents</span>
        <span className="panel-sub">{props.subagents.length}</span>
      </div>
      <ul className="subagent-list">
        {sorted.map((a) => {
          const out = a.usageByModel.reduce((sum, u) => sum + u.output, 0);
          return (
            <li key={a.id}>
              <span className="chip">{a.agentType}</span>
              <span className="sub-desc">{a.description || a.id}</span>
              <span className="sub-meta">
                {formatTokens(out)} out · {relTime(a.lastActivity)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
