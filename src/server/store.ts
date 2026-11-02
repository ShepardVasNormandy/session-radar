import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Artifact, SessionDetail, SessionSummary, TaskItem, TimelineEvent } from "../shared/types.ts";
import { activitySeries, applyLine, newAgg, resolveTitle, summarizeCost, usageByModel, type SessionAgg } from "./aggregate.ts";
import { ACTIVITY_BUCKET_MS, ACTIVITY_BUCKETS } from "./config.ts";
import { readJob } from "./jobs.ts";
import { classify, defaultPidAlive, readRegistry, type Classification, type LiveEntry } from "./registry.ts";
import { scanSubagents, type SubagentState } from "./subagents.ts";
import { freshTail, readNewLines, streamLines, type TailState } from "./tail.ts";
import { readTasks, taskCounts } from "./tasks.ts";

export type RecomputeWhat = "transcript" | "tasks" | "subagents" | "job";

export interface StoreConfig {
  claudeDir: string;
  historyDays: number;
  maxSessionsPerProject: number;
  timelineCap: number;
  heartbeatStaleMs: number;
  activeNowMs: number;
  pidAlive?: (pid: number) => boolean;
  now?: () => number;
}

interface SessionState {
  sessionId: string;
  transcriptPath: string | null;
  sessionDir: string | null;
  agg: SessionAgg;
  tail: TailState;
  tasks: TaskItem[];
  subagents: Map<string, SubagentState>;
  registry?: LiveEntry;
  classification: Classification;
  job: Awaited<ReturnType<typeof readJob>>;
}

export class SessionStore {
  private cfg: Required<StoreConfig>;
  private sessions = new Map<string, SessionState>();

  constructor(cfg: StoreConfig) {
    this.cfg = {
      ...cfg,
      pidAlive: cfg.pidAlive ?? defaultPidAlive,
      now: cfg.now ?? (() => Date.now()),
    };
  }

  private get projectsDir() {
    return join(this.cfg.claudeDir, "projects");
  }
  private get sessionsDir() {
    return join(this.cfg.claudeDir, "sessions");
  }
  private get tasksDir() {
    return join(this.cfg.claudeDir, "tasks");
  }
  private get jobsDir() {
    return join(this.cfg.claudeDir, "jobs");
  }

  async init(): Promise<void> {
    await this.refreshRegistry();
    await this.discover();
    // Re-classify now that transcript activity is known.
    await this.refreshRegistry();
  }

  private newState(sessionId: string): SessionState {
    return {
      sessionId,
      transcriptPath: null,
      sessionDir: null,
      agg: newAgg(this.cfg.timelineCap),
      tail: freshTail(),
      tasks: [],
      subagents: new Map(),
      classification: { live: false, status: "ended", activeNow: false },
      job: null,
    };
  }

  async refreshRegistry(): Promise<boolean> {
    const entries = await readRegistry(this.sessionsDir);
    const byId = new Map(entries.map((e) => [e.sessionId, e]));
    let changed = false;
    for (const [sessionId, entry] of byId) {
      let state = this.sessions.get(sessionId);
      if (!state) {
        state = this.newState(sessionId);
        this.sessions.set(sessionId, state);
        changed = true;
      }
      state.registry = entry;
    }
    const opts = {
      heartbeatStaleMs: this.cfg.heartbeatStaleMs,
      activeNowMs: this.cfg.activeNowMs,
      pidAlive: this.cfg.pidAlive,
    };
    const now = this.cfg.now();
    for (const state of this.sessions.values()) {
      const entry = state.registry;
      const next: Classification =
        entry && byId.has(state.sessionId)
          ? classify(entry, now, opts, state.agg.lastActivity)
          : { live: false, status: "ended", activeNow: false };
      if (
        next.live !== state.classification.live ||
        next.status !== state.classification.status ||
        next.activeNow !== state.classification.activeNow
      ) {
        state.classification = next;
        changed = true;
      }
      if (entry && !byId.has(state.sessionId)) state.registry = undefined;
    }
    return changed;
  }

  async discover(): Promise<string[]> {
    const found: string[] = [];
    let slugs: string[];
    try {
      slugs = await readdir(this.projectsDir);
    } catch {
      return found;
    }
    const cutoff = this.cfg.now() - this.cfg.historyDays * 24 * 3600 * 1000;
    for (const slug of slugs) {
      const slugDir = join(this.projectsDir, slug);
      let files: string[];
      try {
        files = await readdir(slugDir);
      } catch {
        continue;
      }
      const candidates: { sessionId: string; path: string; mtime: number }[] = [];
      for (const file of files) {
        if (!file.endsWith(".jsonl")) continue;
        const sessionId = file.slice(0, -".jsonl".length);
        const path = join(slugDir, file);
        try {
          const mtime = (await stat(path)).mtimeMs;
          candidates.push({ sessionId, path, mtime });
        } catch {
          // vanished between readdir and stat
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      let kept = 0;
      for (const c of candidates) {
        const existing = this.sessions.get(c.sessionId);
        const isLive = existing?.classification.live ?? false;
        if (existing?.transcriptPath) {
          kept++;
          continue;
        }
        if (!isLive && (c.mtime < cutoff || kept >= this.cfg.maxSessionsPerProject)) continue;
        kept++;
        const state = existing ?? this.newState(c.sessionId);
        this.sessions.set(c.sessionId, state);
        state.transcriptPath = c.path;
        state.sessionDir = join(slugDir, c.sessionId);
        await this.fullParse(state);
        await this.recompute(c.sessionId, ["tasks", "subagents", "job"]);
        found.push(c.sessionId);
      }
    }
    return found;
  }

  private async fullParse(state: SessionState): Promise<void> {
    if (!state.transcriptPath) return;
    state.agg = newAgg(this.cfg.timelineCap);
    const bytes = await streamLines(state.transcriptPath, (line) => applyLine(state.agg, line));
    state.tail = { offset: bytes, carry: "" };
  }

  async recompute(sessionId: string, what: RecomputeWhat[]): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    for (const w of what) {
      if (w === "transcript" && state.transcriptPath) {
        const { lines, state: tail, reset } = await readNewLines(state.transcriptPath, state.tail);
        if (reset) {
          await this.fullParse(state);
        } else {
          state.tail = tail;
          for (const line of lines) applyLine(state.agg, line);
        }
      } else if (w === "tasks") {
        state.tasks = await readTasks(this.tasksDir, sessionId);
      } else if (w === "subagents" && state.sessionDir) {
        await scanSubagents(state.sessionDir, state.subagents);
      } else if (w === "job") {
        const jobId = state.registry?.jobId;
        state.job = jobId ? await readJob(this.jobsDir, jobId) : state.job;
      }
    }
  }

  sessionIdForJob(jobId: string): string | null {
    for (const state of this.sessions.values()) {
      if (state.registry?.jobId === jobId) return state.sessionId;
    }
    return null;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private summarize(state: SessionState): SessionSummary {
    const byModel = usageByModel(state.agg, [...state.subagents.values()].map((a) => a.byMessageId));
    const { total, partial } = summarizeCost(byModel);
    const cwd = state.registry?.cwd ?? state.agg.cwd ?? "";
    const subagentLast = Math.max(0, ...[...state.subagents.values()].map((a) => a.lastActivity));
    return {
      sessionId: state.sessionId,
      title: resolveTitle(state.agg, state.registry?.name, state.sessionId),
      cwd,
      project: cwd ? basename(cwd) : "?",
      gitBranch: state.agg.gitBranch,
      live: state.classification.live,
      activeNow: state.classification.activeNow,
      status: state.classification.status,
      waitingFor: state.classification.status === "waiting" ? state.registry?.waitingFor : undefined,
      kind: state.registry?.kind,
      jobId: state.registry?.jobId,
      startedAt: state.registry?.startedAt ?? state.agg.startedAt,
      lastActivity: Math.max(state.agg.lastActivity, state.registry?.updatedAt ?? 0, subagentLast),
      usageByModel: byModel,
      totalCostUSD: total,
      costPartial: partial,
      taskCounts: taskCounts(state.tasks),
      activity: activitySeries(state.agg, this.cfg.now(), ACTIVITY_BUCKET_MS, ACTIVITY_BUCKETS),
      turnCount: state.agg.turnCount,
      artifactCount: this.mergedArtifacts(state).length,
      subagentCount: state.subagents.size,
      parseErrors: state.agg.parseErrors,
    };
  }

  private mergedArtifacts(state: SessionState): Artifact[] {
    const merged = [...state.agg.artifacts];
    for (const a of state.job?.artifacts ?? []) {
      if (!merged.some((m) => m.url === a.url)) merged.push(a);
    }
    return merged;
  }

  getSummaries(): SessionSummary[] {
    return [...this.sessions.values()].map((s) => this.summarize(s));
  }

  getDetail(sessionId: string): SessionDetail | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    const timeline: TimelineEvent[] = state.agg.timeline.map(({ ...ev }) => {
      delete (ev as { toolUseId?: string }).toolUseId;
      return ev;
    });
    return {
      ...this.summarize(state),
      tasks: state.tasks,
      timeline,
      timelineTruncated: state.agg.timelineTruncated,
      artifacts: this.mergedArtifacts(state),
      subagents: [...state.subagents.values()].map((a) => ({
        id: a.id,
        agentType: a.agentType,
        description: a.description,
        usageByModel: usageByModel(newAgg(0), [a.byMessageId]),
        lastActivity: a.lastActivity,
      })),
      job: state.job?.info ?? null,
    };
  }
}
