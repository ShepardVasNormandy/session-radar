import type { TaskItem } from "../shared/types.ts";
import { openBlockers } from "./format.ts";

interface StepKind {
  glyph: string;
  label: string;
}

const KINDS: [RegExp, StepKind][] = [
  [/verif|test|check|e2e|validate|qa\b/i, { glyph: "▣", label: "verify" }],
  [/plan|design|spec|brainstorm|architect/i, { glyph: "◈", label: "plan" }],
  [/explor|investigat|research|find|scan|dig|audit|map\b/i, { glyph: "⌕", label: "explore" }],
  [/draft|message|reply|post|send|mail|slack|announce/i, { glyph: "✉", label: "message" }],
  [/doc\b|docs|readme|report|write-?up/i, { glyph: "▤", label: "docs" }],
  [/writ|build|implement|scaffold|refactor|fix|cod|wire|component|endpoint|api|server|frontend|migrat/i, { glyph: "{}", label: "code" }],
];

export function stepKind(text: string): StepKind {
  for (const [re, kind] of KINDS) {
    if (re.test(text)) return kind;
  }
  return { glyph: "•", label: "step" };
}

export function StepFlow(props: { tasks: TaskItem[]; live: boolean; title?: string }) {
  const done = props.tasks.filter((t) => t.status === "completed").length;
  return (
    <div className="panel stepflow">
      <div className="panel-head">
        <span>steps</span>
        {props.title && <span className="panel-sub">{props.title}</span>}
        <span className="panel-sub steps-count">
          {done}/{props.tasks.length}
        </span>
      </div>
      {props.tasks.length === 0 ? (
        <div className="empty">no task list in this session; see the activity timeline instead</div>
      ) : (
        <ol className="steps">
          {props.tasks.map((t, i) => {
            const kind = stepKind(`${t.subject} ${t.description ?? ""}`);
            const blockers = openBlockers(t, props.tasks);
            const animate = props.live && t.status === "in_progress";
            return (
              <li key={t.id} className={`step ${t.status} ${animate ? "animate" : ""} ${i === props.tasks.length - 1 ? "last" : ""}`}>
                <span className="step-rail">
                  <span className="step-node">{t.status === "completed" ? "✓" : kind.glyph}</span>
                </span>
                <span className="step-body" title={t.description ?? t.subject}>
                  <span className="step-title">{t.status === "in_progress" && t.activeForm ? t.activeForm : t.subject}</span>
                  <span className="step-meta">
                    <span className={`kind-tag ${kind.label}`}>{kind.label}</span>
                    {t.status === "in_progress" && <span className="now-tag">now</span>}
                    {blockers.length > 0 && <span className="chip warn">⧗ after #{blockers.join(", #")}</span>}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
