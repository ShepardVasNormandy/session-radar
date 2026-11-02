import { join } from "node:path";
import type { Artifact, JobInfo } from "../shared/types.ts";

export async function readJob(jobsDir: string, jobId: string): Promise<{ info: JobInfo; artifacts: Artifact[] } | null> {
  let raw: Record<string, unknown>;
  try {
    raw = await Bun.file(join(jobsDir, jobId, "state.json")).json();
  } catch {
    return null;
  }
  const output = (raw.output ?? {}) as Record<string, unknown>;
  const info: JobInfo = {
    jobId,
    state: String(raw.state ?? "unknown"),
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
    tokens: typeof raw.tokens === "number" ? raw.tokens : undefined,
    needs: typeof raw.needs === "string" ? raw.needs : undefined,
    result: typeof output.result === "string" ? output.result : undefined,
  };
  const children = Array.isArray(raw.children) ? (raw.children as Record<string, unknown>[]) : [];
  const artifacts: Artifact[] = children
    .filter((c) => typeof c.href === "string")
    .map((c) => ({
      title: String(c.title ?? c.id ?? c.href),
      url: c.href as string,
      path: undefined,
      source: "job" as const,
      kind: c.kind === "pr" ? ("pr" as const) : c.kind === "frame" ? ("artifact" as const) : ("other" as const),
    }));
  return { info, artifacts };
}
