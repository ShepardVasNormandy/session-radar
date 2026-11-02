import type { ModelUsage } from "../shared/types.ts";
import { formatCost, formatTokens, formatUSD, totalTokens } from "./format.ts";

export function TokenStats(props: { usage: ModelUsage[]; totalCostUSD: number | null; costPartial: boolean }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span>tokens</span>
        <span className="panel-sub">{formatTokens(totalTokens(props.usage))}</span>
        {props.usage.length > 0 && (
          <span
            className="panel-sub cost-total"
            title={props.costPartial ? "lower bound: some models have no price" : "estimated cost at API rates"}
          >
            {formatCost(props.totalCostUSD, props.costPartial)}
          </span>
        )}
      </div>
      {props.usage.length === 0 && <div className="empty">no usage recorded</div>}
      {props.usage.map((u) => (
        <div key={u.model} className="model-block">
          <div className="model-name">
            {u.model}
            <span className="cost" title={u.costUSD === null ? "no price for this model" : "estimated cost"}>
              {formatTokens(u.input + u.output + u.cacheRead + u.cache5m + u.cache1h)} · {formatUSD(u.costUSD)}
            </span>
          </div>
          <div className="tok-grid">
            <span title="input tokens">in {formatTokens(u.input)}</span>
            <span title="output tokens">out {formatTokens(u.output)}</span>
            <span title="cache reads">cr {formatTokens(u.cacheRead)}</span>
            <span title="cache writes 5m + 1h">cw {formatTokens(u.cache5m + u.cache1h)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
