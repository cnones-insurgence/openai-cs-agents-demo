"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentPanel } from "@/components/agent-panel";
import { ChatKitPanel } from "@/components/chatkit-panel";
import type { Agent, AgentEvent, GuardrailCheck } from "@/lib/types";
import { fetchBootstrapState, fetchThreadState } from "@/lib/api";

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentAgent, setCurrentAgent] = useState<string>("");
  const [guardrails, setGuardrails] = useState<GuardrailCheck[]>([]);
  const [context, setContext] = useState<Record<string, any>>({});
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialThreadId, setInitialThreadId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connecting" | "open" | "error"
  >("idle");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [chatkitError, setChatkitError] = useState<string | null>(null);

  const normalizeEvents = useCallback((items: AgentEvent[]) => {
    if (!items.length) return items;
    const now = Date.now();
    const latestNonProgress = items
      .filter((e) => e.type !== "progress_update")
      .reduce((max, e) => Math.max(max, e.timestamp.getTime()), 0);
    const pruned = items.filter((e) => {
      if (e.type !== "progress_update") return true;
      const ts = e.timestamp.getTime();
      // Drop old progress once a newer non-progress exists, or after 15s
      if (latestNonProgress && ts < latestNonProgress) return false;
      if (now - ts > 15000) return false;
      return true;
    });
    return pruned;
  }, []);

  const hydrateState = useCallback(async (id: string | null) => {
    if (!id) return;
    const data = await fetchThreadState(id);
    if (!data) return;

    setCurrentAgent(data.current_agent || "");
    setContext(data.context || {});
    setLastSyncAt(new Date());
    if (Array.isArray(data.agents)) setAgents(data.agents);
    if (Array.isArray(data.events)) {
      setEvents(
        data.events.map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp ?? Date.now()),
        }))
      );
    }
    if (Array.isArray(data.guardrails)) {
      setGuardrails(
        data.guardrails.map((g: any) => ({
          ...g,
          timestamp: new Date(g.timestamp ?? Date.now()),
        }))
      );
    }
  }, []);

  useEffect(() => {
    if (threadId) {
      void hydrateState(threadId);
    }
  }, [threadId, hydrateState]);

  useEffect(() => {
    if (!threadId) return;
    setStreamStatus("connecting");
    const es = new EventSource(
      `/chatkit/state/stream?thread_id=${encodeURIComponent(threadId)}`
    );
    es.onopen = () => {
      setStreamStatus("open");
      console.info("[agent-state] stream open", { threadId });
    };
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        setLastSyncAt(new Date());
        console.info("[agent-state] stream message", {
          threadId,
          events: Array.isArray(data.events) ? data.events.length : undefined,
          events_delta: Array.isArray(data.events_delta)
            ? data.events_delta.length
            : undefined,
        });
        if (data.current_agent) setCurrentAgent(data.current_agent);
        if (data.context) setContext(data.context);
        if (Array.isArray(data.agents)) setAgents(data.agents);
        if (Array.isArray(data.events)) {
          setEvents(
            normalizeEvents(
              data.events.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp ?? Date.now()),
              }))
            )
          );
        }
        if (Array.isArray(data.guardrails)) {
          setGuardrails(
            data.guardrails.map((g: any) => ({
              ...g,
              timestamp: new Date(g.timestamp ?? Date.now()),
            }))
          );
        }
      } catch (err) {
        console.error("Failed to parse state stream payload", err);
      }
    };
    es.onerror = () => {
      setStreamStatus("error");
      console.warn("[agent-state] stream error, falling back to snapshot fetch", {
        threadId,
      });
      // Fallback to snapshot fetch if the stream drops temporarily.
      void hydrateState(threadId);
    };
    return () => es.close();
  }, [threadId, hydrateState, normalizeEvents]);

  useEffect(() => {
    if (!threadId) return;
    const poll = setInterval(() => {
      void hydrateState(threadId);
    }, 2000);
    return () => clearInterval(poll);
  }, [threadId, hydrateState]);

  useEffect(() => {
    (async () => {
      const bootstrap = await fetchBootstrapState();
      if (!bootstrap) return;
      setInitialThreadId(bootstrap.thread_id || null);
      setThreadId(bootstrap.thread_id || null);
      if (bootstrap.current_agent) setCurrentAgent(bootstrap.current_agent);
      if (Array.isArray(bootstrap.agents)) setAgents(bootstrap.agents);
      if (bootstrap.context) setContext(bootstrap.context);
      if (Array.isArray(bootstrap.events)) {
        setEvents(
          normalizeEvents(
            bootstrap.events.map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp ?? Date.now()),
            }))
          )
        );
      }
      if (Array.isArray(bootstrap.guardrails)) {
        setGuardrails(
          bootstrap.guardrails.map((g: any) => ({
            ...g,
            timestamp: new Date(g.timestamp ?? Date.now()),
          }))
        );
      }
    })();
  }, []);

  const handleThreadChange = useCallback((id: string | null) => {
    setThreadId(id);
  }, []);

  const handleBindThread = useCallback((id: string) => {
    setThreadId(id);
  }, []);

  const handleResponseEnd = useCallback(() => {
    void hydrateState(threadId);
  }, [hydrateState, threadId]);

  return (
    <main className="flex h-screen gap-2 bg-gray-100 p-2">
      <div className="fixed bottom-2 left-2 z-50 rounded bg-black/80 px-3 py-2 text-xs text-white">
        <div>thread: {threadId ?? "none"}</div>
        <div>stream: {streamStatus}</div>
        <div>events: {events.length}</div>
        <div>sync: {lastSyncAt ? lastSyncAt.toLocaleTimeString() : "never"}</div>
        <div>chatkit_error: {chatkitError ?? "none"}</div>
      </div>
      <AgentPanel
        agents={agents}
        currentAgent={currentAgent}
        events={events}
        guardrails={guardrails}
        context={context}
      />
      <ChatKitPanel
        initialThreadId={initialThreadId}
        onThreadChange={handleThreadChange}
        onResponseEnd={handleResponseEnd}
        onRunnerUpdate={handleResponseEnd}
        onRunnerBindThread={handleBindThread}
        onChatKitError={setChatkitError}
      />
    </main>
  );
}
