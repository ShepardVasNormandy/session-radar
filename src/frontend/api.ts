import type { SessionDetail, SessionSummary } from "../shared/types.ts";

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`sessions: ${res.status}`);
  const body = (await res.json()) as { summaries: SessionSummary[] };
  return body.summaries;
}

export async function fetchDetail(id: string): Promise<SessionDetail | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as SessionDetail;
}

export function eventsUrl(): string {
  return "/api/events";
}
