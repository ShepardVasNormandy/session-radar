import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { RecomputeWhat, SessionStore } from "./store.ts";

export interface WatcherOpts {
  claudeDir: string;
  debounceMs: number;
  livenessPollMs: number;
  reconcileMs: number;
  onChange: () => void;
}

export function startWatchers(store: SessionStore, opts: WatcherOpts): () => void {
  const dirty = new Map<string, Set<RecomputeWhat>>();
  let registryDirty = false;
  let discoverNeeded = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  const mark = (sessionId: string, what: RecomputeWhat) => {
    if (!dirty.has(sessionId)) dirty.set(sessionId, new Set());
    dirty.get(sessionId)!.add(what);
    schedule();
  };

  const schedule = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, opts.debounceMs);
  };

  const flush = async () => {
    if (flushing) {
      schedule();
      return;
    }
    flushing = true;
    try {
      if (registryDirty) {
        registryDirty = false;
        await store.refreshRegistry();
      }
      if (discoverNeeded) {
        discoverNeeded = false;
        await store.discover();
      }
      const batch = [...dirty.entries()];
      dirty.clear();
      for (const [sessionId, what] of batch) {
        await store.recompute(sessionId, [...what]);
      }
      opts.onChange();
    } catch (err) {
      console.error("[watcher] flush failed:", err);
    } finally {
      flushing = false;
    }
  };

  const watchers: FSWatcher[] = [];
  const tryWatch = (dir: string, recursive: boolean, handler: (filename: string) => void) => {
    try {
      const w = watch(dir, { recursive }, (_event, filename) => {
        if (filename) handler(filename.toString());
      });
      w.on("error", (err) => console.error(`[watcher] ${dir}:`, err.message));
      watchers.push(w);
    } catch (err) {
      console.error(`[watcher] cannot watch ${dir}:`, (err as Error).message);
    }
  };

  tryWatch(join(opts.claudeDir, "sessions"), false, () => {
    registryDirty = true;
    schedule();
  });

  tryWatch(join(opts.claudeDir, "projects"), true, (rel) => {
    const parts = rel.split("/");
    if (parts.length === 2 && parts[1]!.endsWith(".jsonl")) {
      const sessionId = parts[1]!.slice(0, -".jsonl".length);
      if (store.has(sessionId)) mark(sessionId, "transcript");
      else {
        discoverNeeded = true;
        schedule();
      }
    } else if (parts.length >= 3 && parts[2] === "subagents") {
      const sessionId = parts[1]!;
      if (store.has(sessionId)) mark(sessionId, "subagents");
    }
  });

  tryWatch(join(opts.claudeDir, "tasks"), true, (rel) => {
    const sessionId = rel.split("/")[0];
    if (sessionId && store.has(sessionId)) mark(sessionId, "tasks");
  });

  tryWatch(join(opts.claudeDir, "jobs"), true, (rel) => {
    const jobId = rel.split("/")[0];
    if (!jobId) return;
    const sessionId = store.sessionIdForJob(jobId);
    if (sessionId) mark(sessionId, "job");
  });

  const livenessTimer = setInterval(async () => {
    if (await store.refreshRegistry()) opts.onChange();
  }, opts.livenessPollMs);

  const reconcileTimer = setInterval(async () => {
    const registryChanged = await store.refreshRegistry();
    const found = await store.discover();
    if (registryChanged || found.length > 0) opts.onChange();
  }, opts.reconcileMs);

  return () => {
    for (const w of watchers) w.close();
    clearInterval(livenessTimer);
    clearInterval(reconcileTimer);
    if (flushTimer) clearTimeout(flushTimer);
  };
}
