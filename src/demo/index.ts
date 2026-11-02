import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEMO_LIVE_COUNT, generateDemo } from "./generate.ts";

const TICK_MS = 4_000;

const dir = mkdtempSync(join(tmpdir(), "session-radar-demo-"));
// Each live session needs a pid that passes the liveness check; `cat` on a pipe exits when we do.
const holders = Array.from({ length: DEMO_LIVE_COUNT }, () => Bun.spawn(["cat"], { stdin: "pipe", stdout: "ignore" }));
let timer: ReturnType<typeof setInterval> | undefined;
let cleaned = false;

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  if (timer) clearInterval(timer);
  for (const h of holders) h.kill();
  rmSync(dir, { recursive: true, force: true });
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}

const demo = generateDemo(dir, { now: Date.now(), pids: holders.map((h) => h.pid) });
process.env.CLAUDE_CONFIG_DIR = dir;
console.log(`[demo] synthetic data in ${dir}`);

await import("../server/index.ts");
timer = setInterval(() => demo.tick(Date.now()), TICK_MS);
