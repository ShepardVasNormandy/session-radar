import { homedir } from "node:os";
import { join } from "node:path";

export const PORT = Number(process.env.PORT ?? 4747);
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

export const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");
export const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
export const TASKS_DIR = join(CLAUDE_DIR, "tasks");
export const JOBS_DIR = join(CLAUDE_DIR, "jobs");

export const HISTORY_DAYS = 7;
export const MAX_SESSIONS_PER_PROJECT = 20;
export const DEBOUNCE_MS = 300;
export const TIMELINE_CAP = 200;
// Registry updatedAt only moves on status transitions; a busy Fable turn can run
// many minutes between transcript rows. Stale = busy with no evidence for 30 min.
export const HEARTBEAT_STALE_MS = 1_800_000;
export const ACTIVE_NOW_MS = 300_000;
export const LIVENESS_POLL_MS = 5_000;
export const RECONCILE_MS = 60_000;

// Swimlane window: 48 buckets of 15 min = last 12 hours.
export const ACTIVITY_BUCKET_MS = 900_000;
export const ACTIVITY_BUCKETS = 48;
