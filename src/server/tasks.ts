import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TaskCounts, TaskItem } from "../shared/types.ts";

const STATUSES = new Set(["pending", "in_progress", "completed"]);

export async function readTasks(tasksDir: string, sessionId: string): Promise<TaskItem[]> {
  const dir = join(tasksDir, sessionId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const tasks: TaskItem[] = [];
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue;
    try {
      const raw = await Bun.file(join(dir, file)).json();
      if (typeof raw?.subject !== "string" || !STATUSES.has(raw?.status)) continue;
      tasks.push({
        id: String(raw.id ?? file.replace(".json", "")),
        subject: raw.subject,
        description: typeof raw.description === "string" ? raw.description : undefined,
        activeForm: typeof raw.activeForm === "string" ? raw.activeForm : undefined,
        status: raw.status,
        blocks: Array.isArray(raw.blocks) ? raw.blocks.map(String) : [],
        blockedBy: Array.isArray(raw.blockedBy) ? raw.blockedBy.map(String) : [],
      });
    } catch {
      // partially-written task file — next change event re-reads
    }
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}

export function taskCounts(tasks: TaskItem[]): TaskCounts {
  const counts = { pending: 0, inProgress: 0, completed: 0 };
  for (const t of tasks) {
    if (t.status === "pending") counts.pending++;
    else if (t.status === "in_progress") counts.inProgress++;
    else counts.completed++;
  }
  return counts;
}
