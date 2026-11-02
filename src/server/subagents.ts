import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Usage } from "../shared/types.ts";
import { freshTail, readNewLines, type TailState } from "./tail.ts";
import { parseRecord } from "./transcript.ts";

export interface SubagentState {
  id: string;
  agentType: string;
  description: string;
  tail: TailState;
  byMessageId: Map<string, { model: string; usage: Usage }>;
  lastActivity: number;
}

export async function scanSubagents(sessionDir: string, agents: Map<string, SubagentState>): Promise<void> {
  const dir = join(sessionDir, "subagents");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }
  for (const file of files) {
    const match = file.match(/^agent-([0-9a-f]+)\.jsonl$/);
    if (!match) continue;
    const id = match[1]!;
    let state = agents.get(id);
    if (!state) {
      state = { id, agentType: "unknown", description: "", tail: freshTail(), byMessageId: new Map(), lastActivity: 0 };
      try {
        const meta = await Bun.file(join(dir, `agent-${id}.meta.json`)).json();
        state.agentType = String(meta.agentType ?? "unknown");
        state.description = String(meta.description ?? "");
      } catch {
        // meta may not exist yet
      }
      agents.set(id, state);
    }
    const path = join(dir, file);
    const { lines, state: tail, reset } = await readNewLines(path, state.tail);
    if (reset) state.byMessageId.clear();
    state.tail = tail;
    for (const line of lines) {
      const rec = parseRecord(line);
      if (rec?.kind === "assistant" && rec.messageId) {
        state.byMessageId.set(rec.messageId, { model: rec.model, usage: rec.usage });
        if (rec.ts > state.lastActivity) state.lastActivity = rec.ts;
      }
    }
    if (state.lastActivity === 0) {
      try {
        state.lastActivity = (await stat(path)).mtimeMs;
      } catch {
        // file vanished between readdir and stat
      }
    }
  }
}
