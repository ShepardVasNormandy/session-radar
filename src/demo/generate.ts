import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Step = [tool: string, input: Record<string, unknown>];
type LiveState = "busy" | "waiting" | "idle";

interface Turn {
  prompt: string;
  steps: Step[];
  reply: string;
}

interface SessionSpec {
  project: "storefront" | "docs-site" | "infra-tools";
  branch: string;
  title: string;
  model: string;
  state: LiveState | "ended";
  kind?: "interactive" | "bg";
  waitingFor?: string;
  startMinAgo: number;
  endMinAgo: number;
  turns: Turn[];
  tasks: [subject: string, status: "completed" | "in_progress" | "pending", activeForm: string][];
  subagent?: { agentType: string; description: string; model: string };
  job?: { state: string; detail: string; children: Record<string, string>[] };
  artifactTitle?: string;
}

export const DEMO_HOME = "/home/dev";
export const DEMO_ARTIFACT_URL = "https://claude.ai/artifact/demo";

const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
};

const SPECS: SessionSpec[] = [
  {
    project: "storefront",
    branch: "feat/saved-addresses",
    title: "Add saved addresses to checkout",
    model: MODELS.opus,
    state: "busy",
    startMinAgo: 170,
    endMinAgo: 1,
    turns: [
      {
        prompt: "Let signed-in customers pick a saved address at checkout",
        steps: [
          ["Agent", { description: "Map the checkout address flow", subagent_type: "Explore" }],
          ["Read", { file_path: "src/checkout/AddressStep.tsx" }],
          ["Read", { file_path: "src/checkout/useAddresses.ts" }],
          ["Grep", { pattern: "shippingAddress" }],
        ],
        reply: "The address step already loads the profile, so saved addresses can feed the same form.",
      },
      {
        prompt: "Go ahead, keep manual entry as the fallback",
        steps: [
          ["Edit", { file_path: "src/checkout/useAddresses.ts" }],
          ["Write", { file_path: "src/checkout/SavedAddressPicker.tsx" }],
          ["Edit", { file_path: "src/checkout/AddressStep.tsx" }],
          ["Bash", { command: "bun test src/checkout", description: "Run checkout tests" }],
        ],
        reply: "The saved-address picker is wired in and the checkout tests pass.",
      },
      {
        prompt: "Now add the endpoint that lists saved addresses",
        steps: [
          ["Read", { file_path: "server/routes/addresses.ts" }],
          ["Edit", { file_path: "server/routes/addresses.ts" }],
          ["Bash", { command: "bun run typecheck", description: "Typecheck" }],
          ["Edit", { file_path: "server/routes/addresses.test.ts" }],
        ],
        reply: "",
      },
    ],
    tasks: [
      ["Find where the address step loads data", "completed", "Finding the address data source"],
      ["Add SavedAddressPicker component", "completed", "Adding SavedAddressPicker component"],
      ["Add saved-addresses endpoint", "in_progress", "Adding saved-addresses endpoint"],
      ["Cover the fallback path in tests", "pending", "Covering the fallback path"],
      ["Update the checkout docs", "pending", "Updating the checkout docs"],
    ],
    subagent: { agentType: "Explore", description: "Map the checkout address flow", model: MODELS.haiku },
  },
  {
    project: "infra-tools",
    branch: "main",
    title: "Nightly backup verification",
    model: MODELS.sonnet,
    state: "busy",
    kind: "bg",
    startMinAgo: 95,
    endMinAgo: 2,
    turns: [
      {
        prompt: "Restore last night's backups to scratch databases and check row counts",
        steps: [
          ["Bash", { command: "./scripts/list-backups.sh --since 24h", description: "List recent backups" }],
          ["Agent", { description: "Restore the orders snapshot and compare counts", subagent_type: "general-purpose" }],
          ["Bash", { command: "./scripts/restore.sh users scratch-users", description: "Restore users snapshot" }],
          ["Bash", { command: "./scripts/compare-counts.sh scratch-users", description: "Compare row counts" }],
        ],
        reply: "Users and orders restored cleanly; counts match within the expected window.",
      },
      {
        prompt: "Continue with the remaining sets and publish a report",
        steps: [
          ["Bash", { command: "./scripts/restore.sh inventory scratch-inventory", description: "Restore inventory snapshot" }],
          ["Write", { file_path: "reports/backup-check.html" }],
          ["Artifact", { file_path: "reports/backup-check.html", label: "draft" }],
          ["Bash", { command: "./scripts/restore.sh events scratch-events", description: "Restore events snapshot" }],
        ],
        reply: "",
      },
    ],
    tasks: [
      ["List last night's backup sets", "completed", "Listing backup sets"],
      ["Restore users and orders", "completed", "Restoring users and orders"],
      ["Restore inventory", "completed", "Restoring inventory"],
      ["Restore events", "in_progress", "Restoring events"],
    ],
    subagent: { agentType: "general-purpose", description: "Restore the orders snapshot and compare counts", model: MODELS.haiku },
    job: {
      state: "running",
      detail: "3 of 4 backup sets verified",
      children: [
        { id: "report", href: DEMO_ARTIFACT_URL, kind: "frame", title: "Backup verification report" },
        { id: "128", href: "https://github.com/example/infra-tools/pull/128", kind: "pr", title: "Raise restore timeout" },
      ],
    },
  },
  {
    project: "docs-site",
    branch: "search-pagefind",
    title: "Move docs search to Pagefind",
    model: MODELS.sonnet,
    state: "waiting",
    waitingFor: "permission to run bun add pagefind",
    startMinAgo: 130,
    endMinAgo: 6,
    turns: [
      {
        prompt: "Replace the Algolia search with Pagefind so the docs build offline",
        steps: [
          ["Read", { file_path: "astro.config.mjs" }],
          ["Grep", { pattern: "algolia" }],
          ["Read", { file_path: "src/components/Search.astro" }],
        ],
        reply: "Search is only referenced in two places. Pagefind needs a post-build step.",
      },
      {
        prompt: "Sounds good, do it",
        steps: [
          ["Edit", { file_path: "src/components/Search.astro" }],
          ["Bash", { command: "bun add pagefind", description: "Install pagefind" }],
        ],
        reply: "",
      },
    ],
    tasks: [
      ["Find all Algolia references", "completed", "Finding Algolia references"],
      ["Swap the search component", "in_progress", "Swapping the search component"],
      ["Add the Pagefind post-build step", "pending", "Adding the post-build step"],
    ],
  },
  {
    project: "storefront",
    branch: "fix/cart-totals",
    title: "Fix flaky cart totals test",
    model: MODELS.opus,
    state: "idle",
    startMinAgo: 110,
    endMinAgo: 42,
    turns: [
      {
        prompt: "cart totals test fails about one run in ten, can you find out why",
        steps: [
          ["Bash", { command: "bun test src/cart --rerun-each 20", description: "Rerun cart tests" }],
          ["Read", { file_path: "src/cart/totals.test.ts" }],
          ["Read", { file_path: "src/cart/totals.ts" }],
        ],
        reply: "The test depends on the system timezone when it rounds the discount window.",
      },
      {
        prompt: "Fix it in the code, not the test",
        steps: [
          ["Edit", { file_path: "src/cart/totals.ts" }],
          ["Bash", { command: "bun test src/cart --rerun-each 50", description: "Rerun cart tests" }],
        ],
        reply: "Discount windows now compare in UTC. 50 reruns pass.",
      },
    ],
    tasks: [
      ["Reproduce the flaky failure", "completed", "Reproducing the failure"],
      ["Find the root cause", "completed", "Finding the root cause"],
      ["Fix totals rounding", "completed", "Fixing totals rounding"],
    ],
  },
  {
    project: "docs-site",
    branch: "webhooks-v2",
    title: "API reference for v2 webhooks",
    model: MODELS.opus,
    state: "ended",
    startMinAgo: 330,
    endMinAgo: 250,
    turns: [
      {
        prompt: "Write the API reference page for the v2 webhook events",
        steps: [
          ["Read", { file_path: "openapi/webhooks.yaml" }],
          ["Write", { file_path: "src/content/docs/api/webhooks-v2.mdx" }],
        ],
        reply: "Drafted the reference with one section per event type.",
      },
      {
        prompt: "Publish a preview page so the team can review it",
        steps: [
          ["Write", { file_path: "preview/webhooks-v2.html" }],
          ["Artifact", { file_path: "preview/webhooks-v2.html", label: "v1" }],
        ],
        reply: "Preview is published.",
      },
    ],
    tasks: [
      ["Read the webhook schema", "completed", "Reading the webhook schema"],
      ["Write one section per event", "completed", "Writing event sections"],
      ["Add payload examples", "completed", "Adding payload examples"],
      ["Publish a preview", "completed", "Publishing a preview"],
    ],
    artifactTitle: "Webhooks v2 reference",
  },
  {
    project: "infra-tools",
    branch: "chore/providers",
    title: "Bump Terraform providers",
    model: MODELS.sonnet,
    state: "ended",
    startMinAgo: 560,
    endMinAgo: 500,
    turns: [
      {
        prompt: "Bump the AWS and Cloudflare providers to the latest minor versions",
        steps: [
          ["Read", { file_path: "terraform/versions.tf" }],
          ["Edit", { file_path: "terraform/versions.tf" }],
          ["Bash", { command: "terraform init -upgrade", description: "Upgrade providers" }],
          ["Bash", { command: "terraform plan -out plan.out", description: "Plan changes" }],
        ],
        reply: "Both providers bumped. The plan shows no resource changes.",
      },
    ],
    tasks: [],
  },
];

export const DEMO_SESSION_COUNT = SPECS.length;
export const DEMO_LIVE_COUNT = SPECS.filter((s) => s.state !== "ended").length;

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugFor(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface Ctx {
  sessionId: string;
  cwd: string;
  branch: string;
  rand: () => number;
  seq: number;
}

function usage(ctx: Ctx, scale = 1) {
  const r = ctx.rand;
  const write = Math.round((500 + r() * 4000) * scale);
  return {
    input_tokens: Math.round(2 + r() * 40),
    cache_creation_input_tokens: write,
    cache_read_input_tokens: Math.round((15_000 + r() * 70_000) * scale),
    output_tokens: Math.round((120 + r() * 1400) * scale),
    cache_creation: { ephemeral_1h_input_tokens: write, ephemeral_5m_input_tokens: 0 },
  };
}

function line(row: Record<string, unknown>): string {
  return JSON.stringify(row) + "\n";
}

function base(ctx: Ctx, ts: number, sidechain = false) {
  ctx.seq++;
  return {
    uuid: `${ctx.sessionId.slice(-4)}-${ctx.seq}`,
    sessionId: ctx.sessionId,
    timestamp: iso(ts),
    cwd: ctx.cwd,
    gitBranch: ctx.branch,
    isSidechain: sidechain,
  };
}

function promptRow(ctx: Ctx, ts: number, text: string): string {
  return line({ type: "user", ...base(ctx, ts), promptId: `p${ctx.seq}`, promptSource: "typed", message: { role: "user", content: text } });
}

function assistantRow(ctx: Ctx, ts: number, model: string, content: unknown[], sidechain = false): string {
  const b = base(ctx, ts, sidechain);
  return line({
    type: "assistant",
    ...b,
    requestId: `req_demo_${b.uuid}`,
    message: { id: `msg_demo_${b.uuid}`, model, role: "assistant", usage: usage(ctx, sidechain ? 0.4 : 1), content },
  });
}

function toolResultRow(ctx: Ctx, ts: number, toolUseId: string, toolUseResult?: Record<string, unknown>): string {
  return line({
    type: "user",
    ...base(ctx, ts),
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: false }] },
    ...(toolUseResult ? { toolUseResult } : {}),
  });
}

function absolutize(cwd: string, input: Record<string, unknown>): Record<string, unknown> {
  const fp = input.file_path;
  return typeof fp === "string" && !fp.startsWith("/") ? { ...input, file_path: `${cwd}/${fp}` } : input;
}

function stepRows(ctx: Ctx, ts: number, model: string, step: Step, artifactTitle?: string): { rows: string; toolUseId: string } {
  const [tool, input] = step;
  const toolUseId = `toolu_demo_${ctx.sessionId.slice(-4)}_${ctx.seq}`;
  const full = absolutize(ctx.cwd, input);
  let rows = assistantRow(ctx, ts, model, [{ type: "tool_use", id: toolUseId, name: tool, input: full }]);
  const result =
    tool === "Artifact" && artifactTitle
      ? { url: DEMO_ARTIFACT_URL, path: full.file_path, title: artifactTitle, updated: false }
      : undefined;
  rows += toolResultRow(ctx, ts + 2_000 + ctx.rand() * 6_000, toolUseId, result);
  return { rows, toolUseId };
}

function writeSubagent(sessionDir: string, ctx: Ctx, spec: NonNullable<SessionSpec["subagent"]>, toolUseId: string, ts: number): void {
  const agentId = (0xa000 + ctx.seq).toString(16) + "f00d";
  const dir = join(sessionDir, "subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `agent-${agentId}.meta.json`),
    JSON.stringify({ agentType: spec.agentType, description: spec.description, toolUseId, spawnDepth: 1 }),
  );
  let rows = "";
  for (let i = 0; i < 5; i++) {
    const t = ts + (i + 1) * 15_000;
    rows += assistantRow(ctx, t, spec.model, [{ type: "tool_use", id: `toolu_sub_${i}`, name: i % 2 ? "Grep" : "Read", input: { pattern: "TODO" } }], true);
  }
  writeFileSync(join(dir, `agent-${agentId}.jsonl`), rows);
}

export interface DemoData {
  sessionIds: string[];
  tick(now: number): void;
}

const LIVE_TICK_STEPS: Step[] = [
  ["Read", { file_path: "src/index.ts" }],
  ["Grep", { pattern: "TODO" }],
  ["Edit", { file_path: "src/index.ts" }],
  ["Bash", { command: "bun test", description: "Run tests" }],
];

export function generateDemo(claudeDir: string, opts: { now: number; pids: number[] }): DemoData {
  const { now } = opts;
  const rand = rng(42);
  for (const sub of ["sessions", "projects", "tasks", "jobs"]) mkdirSync(join(claudeDir, sub), { recursive: true });

  const sessionIds: string[] = [];
  const busy: { path: string; ctx: Ctx; model: string }[] = [];
  let pidIdx = 0;

  for (const [i, spec] of SPECS.entries()) {
    const sessionId = `00000000-demo-4000-8000-${String(i + 1).padStart(12, "0")}`;
    sessionIds.push(sessionId);
    const cwd = `${DEMO_HOME}/code/${spec.project}`;
    const slugDir = join(claudeDir, "projects", slugFor(cwd));
    const sessionDir = join(slugDir, sessionId);
    mkdirSync(slugDir, { recursive: true });
    const ctx: Ctx = { sessionId, cwd, branch: spec.branch, rand, seq: 0 };

    const start = now - spec.startMinAgo * 60_000;
    const end = now - spec.endMinAgo * 60_000;
    const span = (end - start) / spec.turns.length;
    let rows = line({ type: "ai-title", aiTitle: spec.title, sessionId });
    let lastTs = start;

    spec.turns.forEach((turn, ti) => {
      const isLast = ti === spec.turns.length - 1;
      const gap = Math.min(300_000, (span * 0.8) / (turn.steps.length + 1));
      const offsets = turn.steps.map(() => gap * (0.6 + rand() * 0.4));
      const turnLength = offsets.reduce((a, b) => a + b, 0) + (turn.reply ? gap * 0.5 : 0);
      const turnStart = isLast ? end - turnLength : start + ti * span;
      let ts = turnStart;
      rows += promptRow(ctx, ts, turn.prompt);
      turn.steps.forEach((step, si) => {
        ts += offsets[si]!;
        const { rows: r, toolUseId } = stepRows(ctx, ts, spec.model, step, spec.artifactTitle);
        rows += r;
        if (step[0] === "Agent" && spec.subagent) writeSubagent(sessionDir, ctx, spec.subagent, toolUseId, ts);
      });
      if (turn.reply) {
        ts += gap * 0.5;
        rows += assistantRow(ctx, ts, spec.model, [{ type: "text", text: turn.reply }]);
        rows += line({ type: "system", subtype: "turn_duration", durationMs: Math.round(ts - turnStart), timestamp: iso(ts + 500) });
      }
      lastTs = ts;
    });

    if (spec.state === "idle") {
      rows += line({ type: "system", subtype: "away_summary", content: "Fixed the timezone bug behind the flaky cart totals test.", timestamp: iso(lastTs + 60_000) });
    }

    const transcriptPath = join(slugDir, `${sessionId}.jsonl`);
    writeFileSync(transcriptPath, rows);

    if (spec.tasks.length > 0) {
      const taskDir = join(claudeDir, "tasks", sessionId);
      mkdirSync(taskDir, { recursive: true });
      spec.tasks.forEach(([subject, status, activeForm], k) => {
        const id = String(k + 1);
        writeFileSync(
          join(taskDir, `${id}.json`),
          JSON.stringify({ id, subject, description: subject, activeForm, status, blocks: [], blockedBy: k > 0 ? [String(k)] : [] }),
        );
      });
      writeFileSync(join(taskDir, ".highwatermark"), String(spec.tasks.length));
    }

    if (spec.state === "ended") continue;

    const pid = opts.pids[pidIdx++];
    if (pid === undefined) throw new Error(`need ${DEMO_LIVE_COUNT} pids for live demo sessions`);
    const jobId = spec.job ? `demo-job-${i + 1}` : undefined;
    writeFileSync(
      join(claudeDir, "sessions", `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId,
        cwd,
        startedAt: start,
        kind: spec.kind ?? "interactive",
        name: `${spec.project}-${i + 1}`,
        status: spec.state,
        ...(spec.waitingFor ? { waitingFor: spec.waitingFor } : {}),
        updatedAt: lastTs,
        ...(jobId ? { jobId } : {}),
      }),
    );
    if (spec.job && jobId) {
      mkdirSync(join(claudeDir, "jobs", jobId), { recursive: true });
      writeFileSync(
        join(claudeDir, "jobs", jobId, "state.json"),
        JSON.stringify({ state: spec.job.state, detail: spec.job.detail, tokens: 412_380, children: spec.job.children }),
      );
    }
    if (spec.state === "busy") busy.push({ path: transcriptPath, ctx, model: spec.model });
  }

  let tickCount = 0;
  return {
    sessionIds,
    tick(at: number) {
      const target = busy[tickCount % busy.length];
      if (!target) return;
      const step = LIVE_TICK_STEPS[tickCount % LIVE_TICK_STEPS.length]!;
      tickCount++;
      appendFileSync(target.path, stepRows(target.ctx, at - 10_000, target.model, step).rows);
    },
  };
}
