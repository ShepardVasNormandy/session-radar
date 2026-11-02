import type { TaskItem } from "../shared/types.ts";
import { openBlockers } from "./format.ts";

const GLYPH: Record<TaskItem["status"], string> = { completed: "✓", in_progress: "▶", pending: "○" };
const ORDER: TaskItem["status"][] = ["in_progress", "pending", "completed"];

export function TaskChecklist(props: { tasks: TaskItem[] }) {
  const done = props.tasks.filter((t) => t.status === "completed").length;
  const sorted = [...props.tasks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  return (
    <div className="panel checklist">
      <div className="panel-head">
        <span>tasks</span>
        <span className="panel-sub">
          {done}/{props.tasks.length}
        </span>
        <span className="progress">
          <span className="progress-fill" style={{ width: `${props.tasks.length ? (done / props.tasks.length) * 100 : 0}%` }} />
        </span>
      </div>
      <ul>
        {sorted.map((t) => {
          const blockers = openBlockers(t, props.tasks);
          return (
            <li key={t.id} className={`task ${t.status}`}>
              <span className="task-glyph">{GLYPH[t.status]}</span>
              <span className="task-subject">{t.status === "in_progress" && t.activeForm ? t.activeForm : t.subject}</span>
              {blockers.length > 0 && <span className="chip warn">⧗ blocked by {blockers.join(", ")}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
