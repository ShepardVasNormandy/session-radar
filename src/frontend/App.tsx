import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerEvent, SessionDetail, SessionSummary } from "../shared/types.ts";
import * as api from "./api.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { RadarView } from "./RadarView.tsx";
import { SessionList } from "./SessionList.tsx";

export function App() {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<"list" | "radar">("list");
  const [, setTick] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const selectedRef = useRef<string | null>(null);
  const lastActivityRef = useRef(0);
  selectedRef.current = selectedId;

  const refreshDetail = useCallback((id: string) => {
    api.fetchDetail(id).then((d) => {
      if (d && selectedRef.current === d.sessionId) setDetail(d);
    });
  }, []);

  const attach = useCallback(() => {
    if (esRef.current) return;
    const es = new EventSource(api.eventsUrl());
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data) as ServerEvent;
      if (ev.type !== "snapshot") return;
      setSummaries(ev.summaries);
      const id = selectedRef.current;
      if (id) {
        const s = ev.summaries.find((x) => x.sessionId === id);
        if (s && s.lastActivity !== lastActivityRef.current) {
          lastActivityRef.current = s.lastActivity;
          refreshDetail(id);
        }
      }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setConnected(false);
      api.fetchSessions().then(setSummaries).catch(() => {});
      setTimeout(attach, 2000);
    };
  }, [refreshDetail]);

  useEffect(() => {
    api.fetchSessions().then(setSummaries).catch(() => {});
    attach();
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => {
      clearInterval(timer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [attach]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetail(null);
      lastActivityRef.current = 0;
      refreshDetail(id);
    },
    [refreshDetail],
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="sweep" aria-hidden="true" />
          <h1>session radar</h1>
        </div>
        <div className="view-toggle" role="tablist">
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            list
          </button>
          <button role="tab" aria-selected={view === "radar"} className={view === "radar" ? "active" : ""} onClick={() => setView("radar")}>
            radar
          </button>
        </div>
        <div className="topbar-meta">
          <span>{summaries.filter((s) => s.live).length} live</span>
          <span className="sep">/</span>
          <span>{summaries.length} tracked</span>
          <span className={`link-dot ${connected ? "on" : "off"}`} title={connected ? "stream connected" : "reconnecting…"} />
        </div>
      </header>
      {view === "list" ? (
        <main className="layout">
          <SessionList summaries={summaries} selectedId={selectedId} onSelect={select} />
          <DetailPanel detail={detail} hasSelection={selectedId !== null} />
        </main>
      ) : (
        <main className="layout radar-layout">
          <RadarView summaries={summaries} selectedId={selectedId} onSelect={select} detail={detail} />
        </main>
      )}
    </div>
  );
}
