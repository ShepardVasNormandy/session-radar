import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LiveStatus } from "../shared/types.ts";

export interface LiveEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind?: "interactive" | "bg";
  name?: string;
  status?: string;
  waitingFor?: string;
  updatedAt?: number;
  jobId?: string;
  procStart?: string;
}

export async function readRegistry(dir: string): Promise<LiveEntry[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const entries: LiveEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await Bun.file(join(dir, file)).json();
      if (typeof raw?.pid === "number" && typeof raw?.sessionId === "string") {
        entries.push(raw as LiveEntry);
      }
    } catch {
      // unreadable or mid-write — skip this poll round
    }
  }
  return entries;
}

export function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface ClassifyOpts {
  heartbeatStaleMs: number;
  activeNowMs: number;
  pidAlive: (pid: number) => boolean;
}

export interface Classification {
  live: boolean;
  status: LiveStatus;
  activeNow: boolean;
}

export function classify(entry: LiveEntry, now: number, opts: ClassifyOpts, lastActivity = 0): Classification {
  if (!opts.pidAlive(entry.pid)) return { live: false, status: "ended", activeNow: false };
  // updatedAt only moves on status transitions, so activity evidence is the max of
  // the registry timestamp and the transcript's last row.
  const evidence = Math.max(entry.updatedAt ?? 0, lastActivity);
  const status: LiveStatus = entry.status === "busy" ? "busy" : entry.status === "waiting" ? "waiting" : "idle";
  if (status === "busy" && now - evidence > opts.heartbeatStaleMs) {
    return { live: true, status: "stale", activeNow: false };
  }
  return {
    live: true,
    status,
    activeNow: status === "busy" && now - evidence <= opts.activeNowMs,
  };
}
