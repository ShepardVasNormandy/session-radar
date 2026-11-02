import type { Usage } from "../shared/types.ts";

export interface SplitResult {
  lines: string[];
  carry: string;
}

export function splitLines(chunk: string, carry: string): SplitResult {
  const text = carry + chunk;
  const parts = text.split("\n");
  const newCarry = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.length > 0), carry: newCarry };
}

export interface ToolUseRef {
  id: string;
  name: string;
  summary: string;
}

export interface ArtifactRef {
  url: string;
  title?: string;
  path?: string;
}

export type ParsedRecord =
  | {
      kind: "assistant";
      ts: number;
      messageId: string;
      model: string;
      usage: Usage;
      text?: string;
      toolUses: ToolUseRef[];
      cwd?: string;
      gitBranch?: string;
      isSidechain: boolean;
    }
  | { kind: "prompt"; ts: number; text: string; cwd?: string; isSidechain: boolean }
  | { kind: "tool-result"; ts: number; toolUseId: string; isError: boolean; artifact?: ArtifactRef; isSidechain: boolean }
  | { kind: "turn"; ts: number; durationMs: number }
  | { kind: "away-summary"; ts: number; text: string }
  | { kind: "ai-title"; title: string }
  | { kind: "custom-title"; title: string }
  | { kind: "other" };

const MAX_SUMMARY = 120;

function truncate(s: string, max = MAX_SUMMARY): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function toolSummary(name: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  };
  let s: string | null;
  switch (name) {
    case "Read":
    case "Edit":
    case "Write":
    case "NotebookEdit":
    case "Artifact":
      s = pick("file_path", "label");
      break;
    case "Bash":
      s = pick("description", "command");
      break;
    case "Task":
    case "Agent":
      s = pick("description", "prompt");
      break;
    case "Skill":
      s = pick("skill");
      break;
    case "WebFetch":
    case "WebSearch":
      s = pick("url", "query");
      break;
    case "Grep":
    case "Glob":
      s = pick("pattern");
      break;
    default:
      s = null;
  }
  if (s === null) {
    s = Object.values(obj).find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  }
  return truncate(s);
}

function toMs(timestamp: unknown): number {
  if (typeof timestamp !== "string") return 0;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? 0 : ms;
}

function extractUsage(usage: Record<string, unknown>): Usage {
  const n = (v: unknown): number => (typeof v === "number" ? v : 0);
  const cc = (usage.cache_creation ?? {}) as Record<string, unknown>;
  const cache5m = n(cc.ephemeral_5m_input_tokens);
  const cache1h = n(cc.ephemeral_1h_input_tokens);
  const ccTotal = n(usage.cache_creation_input_tokens);
  return {
    input: n(usage.input_tokens),
    output: n(usage.output_tokens),
    cacheRead: n(usage.cache_read_input_tokens),
    // Older rows may lack the 5m/1h breakdown — attribute the total to 5m (default TTL).
    cache5m: cache5m + cache1h > 0 ? cache5m : ccTotal,
    cache1h,
  };
}

export function parseRecord(line: string): ParsedRecord | null {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (row === null || typeof row !== "object") return null;

  const type = row.type;
  const ts = toMs(row.timestamp);
  const isSidechain = row.isSidechain === true;

  if (type === "assistant") {
    const message = (row.message ?? {}) as Record<string, unknown>;
    const content = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [];
    const textBlock = content.find((b) => b.type === "text" && typeof b.text === "string");
    const toolUses: ToolUseRef[] = content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: String(b.id ?? ""),
        name: String(b.name ?? ""),
        summary: toolSummary(String(b.name ?? ""), b.input),
      }));
    return {
      kind: "assistant",
      ts,
      messageId: String(message.id ?? ""),
      model: String(message.model ?? ""),
      usage: extractUsage((message.usage ?? {}) as Record<string, unknown>),
      text: textBlock ? truncate(String(textBlock.text), 200) : undefined,
      toolUses,
      cwd: typeof row.cwd === "string" ? row.cwd : undefined,
      gitBranch: typeof row.gitBranch === "string" ? row.gitBranch : undefined,
      isSidechain,
    };
  }

  if (type === "user") {
    const message = (row.message ?? {}) as Record<string, unknown>;
    if (row.promptId && row.promptSource === "typed" && typeof message.content === "string") {
      return {
        kind: "prompt",
        ts,
        text: truncate(message.content, 200),
        cwd: typeof row.cwd === "string" ? row.cwd : undefined,
        isSidechain,
      };
    }
    const content = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [];
    const result = content.find((b) => b.type === "tool_result");
    if (result) {
      const tur = (row.toolUseResult ?? null) as Record<string, unknown> | null;
      let artifact: ArtifactRef | undefined;
      if (tur && typeof tur.url === "string" && tur.url.includes("/artifact/")) {
        artifact = {
          url: tur.url,
          title: typeof tur.title === "string" ? tur.title : undefined,
          path: typeof tur.path === "string" ? tur.path : undefined,
        };
      }
      return {
        kind: "tool-result",
        ts,
        toolUseId: String(result.tool_use_id ?? ""),
        isError: result.is_error === true,
        artifact,
        isSidechain,
      };
    }
    return { kind: "other" };
  }

  if (type === "system") {
    if (row.subtype === "turn_duration" && typeof row.durationMs === "number") {
      return { kind: "turn", ts, durationMs: row.durationMs };
    }
    if (row.subtype === "away_summary" && typeof row.content === "string") {
      return { kind: "away-summary", ts, text: row.content };
    }
    return { kind: "other" };
  }

  if (type === "ai-title" && typeof row.aiTitle === "string") return { kind: "ai-title", title: row.aiTitle };
  if (type === "custom-title" && typeof row.customTitle === "string") return { kind: "custom-title", title: row.customTitle };

  return { kind: "other" };
}
