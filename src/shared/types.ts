export type LiveStatus = "busy" | "idle" | "waiting" | "stale" | "ended";

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cache5m: number;
  cache1h: number;
}

export interface ModelUsage extends Usage {
  model: string;
  costUSD: number | null;
}

export interface ActivitySeries {
  start: number;
  bucketMs: number;
  counts: number[];
}

export interface TaskCounts {
  pending: number;
  inProgress: number;
  completed: number;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  cwd: string;
  project: string;
  gitBranch?: string;
  live: boolean;
  activeNow: boolean;
  status: LiveStatus;
  waitingFor?: string;
  kind?: "interactive" | "bg";
  jobId?: string;
  startedAt: number;
  lastActivity: number;
  usageByModel: ModelUsage[];
  totalCostUSD: number | null;
  costPartial: boolean;
  taskCounts: TaskCounts;
  activity: ActivitySeries;
  turnCount: number;
  artifactCount: number;
  subagentCount: number;
  parseErrors: number;
}

export interface TaskItem {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
}

export type TimelineEvent =
  | { ts: number; kind: "prompt"; text: string }
  | { ts: number; kind: "assistant"; text: string; model: string }
  | { ts: number; kind: "tool"; tool: string; summary: string; isError?: boolean }
  | { ts: number; kind: "turn"; durationMs: number }
  | { ts: number; kind: "away-summary"; text: string }
  | { ts: number; kind: "subagent"; agentType: string; description: string };

export interface Artifact {
  title: string;
  url?: string;
  path?: string;
  source: "transcript" | "job";
  kind: "artifact" | "pr" | "other";
}

export interface SubagentInfo {
  id: string;
  agentType: string;
  description: string;
  usageByModel: ModelUsage[];
  lastActivity: number;
}

export interface JobInfo {
  jobId: string;
  state: string;
  detail?: string;
  tokens?: number;
  needs?: string;
  result?: string;
}

export interface SessionDetail extends SessionSummary {
  tasks: TaskItem[];
  timeline: TimelineEvent[];
  timelineTruncated: number;
  artifacts: Artifact[];
  subagents: SubagentInfo[];
  job: JobInfo | null;
}

export type ServerEvent =
  | { type: "snapshot"; summaries: SessionSummary[] }
  | { type: "summaries"; updated: SessionSummary[]; removed: string[] };
