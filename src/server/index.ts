import index from "../frontend/index.html";
import type { ServerEvent } from "../shared/types.ts";
import {
  ACTIVE_NOW_MS,
  CLAUDE_DIR,
  DEBOUNCE_MS,
  HEARTBEAT_STALE_MS,
  HISTORY_DAYS,
  LIVENESS_POLL_MS,
  MAX_SESSIONS_PER_PROJECT,
  PORT,
  RECONCILE_MS,
  TIMELINE_CAP,
} from "./config.ts";
import { SessionStore } from "./store.ts";
import { startWatchers } from "./watcher.ts";

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Transcript titles/prompts are sensitive: block DNS-rebound pages via Host check.
function guard(req: Request): Response | null {
  const host = req.headers.get("host");
  if (host !== null && !ALLOWED_HOSTS.has(host)) {
    return Response.json({ error: "bad host" }, { status: 403 });
  }
  return null;
}

const store = new SessionStore({
  claudeDir: CLAUDE_DIR,
  historyDays: HISTORY_DAYS,
  maxSessionsPerProject: MAX_SESSIONS_PER_PROJECT,
  timelineCap: TIMELINE_CAP,
  heartbeatStaleMs: HEARTBEAT_STALE_MS,
  activeNowMs: ACTIVE_NOW_MS,
});

const t0 = performance.now();
await store.init();
console.log(`[radar] initial scan: ${store.getSummaries().length} sessions in ${Math.round(performance.now() - t0)}ms`);

const listeners = new Set<(ev: ServerEvent) => void>();

function broadcast(): void {
  if (listeners.size === 0) return;
  const ev: ServerEvent = { type: "snapshot", summaries: store.getSummaries() };
  for (const listener of listeners) listener(ev);
}

startWatchers(store, {
  claudeDir: CLAUDE_DIR,
  debounceMs: DEBOUNCE_MS,
  livenessPollMs: LIVENESS_POLL_MS,
  reconcileMs: RECONCILE_MS,
  onChange: broadcast,
});

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    reusePort: false,
    idleTimeout: 0,
    // Dev mode's event-loop instrumentation is ~25x slower on heavy I/O — keep off.
    development: false,
    routes: {
      "/": index,

      "/api/sessions": {
        GET: (req) => guard(req) ?? Response.json({ summaries: store.getSummaries() }),
      },

      "/api/sessions/:id": {
        GET: (req) => {
          const denied = guard(req);
          if (denied) return denied;
          const detail = store.getDetail(req.params.id);
          return detail ? Response.json(detail) : Response.json({ error: "unknown session" }, { status: 404 });
        },
      },

      "/api/events": {
        GET: (req) => {
          const denied = guard(req);
          if (denied) return denied;
          let cleanup = () => {};
          const stream = new ReadableStream({
            start(sse) {
              const send = (ev: ServerEvent) => {
                try {
                  sse.enqueue(`data: ${JSON.stringify(ev)}\n\n`);
                } catch {
                  cleanup();
                }
              };
              const heartbeat = setInterval(() => {
                try {
                  sse.enqueue(": ping\n\n");
                } catch {
                  cleanup();
                }
              }, 5000);
              cleanup = () => {
                clearInterval(heartbeat);
                listeners.delete(send);
              };
              listeners.add(send);
              send({ type: "snapshot", summaries: store.getSummaries() });
            },
            cancel() {
              cleanup();
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            },
          });
        },
      },
    },

    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });
} catch (err) {
  if ((err as { code?: string }).code !== "EADDRINUSE") throw err;
  console.error(`Port ${PORT} is in use. Set PORT to another value.`);
  process.exit(1);
}

console.log(`session-radar running at ${server.url}`);
