import "dotenv/config";
import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { InputGuardrailTripwireTriggered, run, type RunItem } from "@openai/agents";
import { agentMap } from "./airline/agents.js";
import { createInitialContext, publicContext, type AirlineContext } from "./airline/types.js";

type AgentName = keyof typeof agentMap;
type AgentEvent = { id: string; type: "message" | "handoff" | "tool_call" | "tool_output" | "context_update" | "progress_update"; agent: string; content: string; timestamp: number; metadata?: Record<string, unknown> };
type GuardrailCheck = { id: string; name: string; input: string; reasoning: string; passed: boolean; timestamp: number };
type ThreadState = { thread_id: string; created_at: string; current_agent: AgentName; context: AirlineContext; events: AgentEvent[]; guardrails: GuardrailCheck[]; input_items: any[] };

const app = express();
const PORT = Number(process.env.PORT ?? 8000);
const threads = new Map<string, ThreadState>();
const listeners = new Map<string, Set<express.Response>>();
let lastActiveThreadId: string | null = null;

function ensureThread(id?: string): ThreadState {
  const threadId = id && id.length ? id : `thread_${randomUUID()}`;
  const existing = threads.get(threadId);
  if (existing) {
    lastActiveThreadId = existing.thread_id;
    return existing;
  }
  const s: ThreadState = { thread_id: threadId, created_at: new Date().toISOString(), current_agent: "Triage Agent", context: createInitialContext(), events: [], guardrails: [], input_items: [] };
  threads.set(threadId, s);
  lastActiveThreadId = s.thread_id;
  return s;
}

function pushEvent(state: ThreadState, e: Omit<AgentEvent, "id" | "timestamp">) {
  const ev: AgentEvent = { ...e, id: randomUUID(), timestamp: Date.now() };
  state.events.push(ev);
  return ev;
}

function contextDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) changes[k] = { before: before[k], after: v };
  }
  return changes;
}

function broadcast(threadId: string, payload: Record<string, unknown>) {
  const clients = listeners.get(threadId);
  if (!clients) return;
  const wire = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => res.write(wire));
}

function payload(state: ThreadState) {
  const agents = Object.values(agentMap).map((a) => ({
    name: a.name,
    description: a.handoffDescription ?? "",
    handoffs: (a.handoffs ?? []).map((h: any) => h.name ?? "handoff"),
    tools: (a.tools ?? []).map((t: any) => t.name ?? "tool"),
    input_guardrails: ["Relevance Guardrail", "Jailbreak Guardrail"]
  }));
  return { thread_id: state.thread_id, current_agent: state.current_agent, context: publicContext(state.context), agents, events: state.events, guardrails: state.guardrails };
}

function extractUserText(body: unknown): string {
  if (typeof body === "string") return body;
  const b = body as any;
  const fromParams =
    b?.params?.input?.find?.((x: any) => x?.role === "user") ??
    b?.params?.input?.[0];
  const fromParamsText =
    fromParams?.content?.find?.((c: any) => c?.type === "input_text")?.text ??
    fromParams?.content?.[0]?.text;
  if (typeof fromParamsText === "string") return fromParamsText;
  const msg = b?.input?.find?.((x: any) => x?.role === "user");
  const text = msg?.content?.find?.((c: any) => c?.type === "input_text")?.text ?? msg?.content?.[0]?.text;
  return typeof text === "string" ? text : JSON.stringify(body);
}

function extractThreadId(queryThreadId: unknown, body: unknown): string {
  const fromQuery = String(queryThreadId ?? "");
  if (fromQuery.length > 0) return fromQuery;
  const b = body as any;
  const derived = String(
    b?.params?.thread_id ??
      b?.params?.threadId ??
      b?.params?.thread?.id ??
      b?.params?.thread?.thread_id ??
      b?.params?.thread?.threadId ??
      b?.thread_id ??
      b?.threadId ??
      ""
  );
  if (derived.length > 0) return derived;
  // ChatKit may issue threads.create without a thread id; bind it to the active UI thread.
  return String(lastActiveThreadId ?? "");
}

function maybeHydrateForHandoff(state: ThreadState, target: string) {
  if (target === "Seat and Special Services Agent" || target === "Booking and Cancellation Agent") {
    if (!state.context.confirmation_number) state.context.confirmation_number = `CNF-${Math.floor(Math.random() * 900000 + 100000)}`;
    if (!state.context.flight_number) state.context.flight_number = `FLT-${Math.floor(Math.random() * 900 + 100)}`;
  }
}

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: "*/*", limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ status: "healthy" }));
app.get("/chatkit/bootstrap", (_req, res) => res.json(payload(ensureThread())));
app.get("/chatkit/state", (req, res) => {
  const state = ensureThread(String(req.query.thread_id ?? ""));
  lastActiveThreadId = state.thread_id;
  res.json(payload(state));
});
app.get("/chatkit/state/stream", (req, res) => {
  const state = ensureThread(String(req.query.thread_id ?? ""));
  lastActiveThreadId = state.thread_id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify(payload(state))}\n\n`);
  const set = listeners.get(state.thread_id) ?? new Set<express.Response>();
  set.add(res);
  listeners.set(state.thread_id, set);
  req.on("close", () => set.delete(res));
});

app.post("/chatkit", async (req, res) => {
  const resolvedThreadId = extractThreadId(req.query.thread_id, req.body);
  const state = ensureThread(resolvedThreadId);
  lastActiveThreadId = state.thread_id;
  const beforeContext = publicContext(state.context);
  const startEventIndex = state.events.length;
  const text = extractUserText(req.body).slice(0, 2000);
  state.input_items.push({ role: "user", content: text });
  try {
    const result = await run(agentMap[state.current_agent], state.input_items as any, { context: state.context as any, maxTurns: 12 });

    for (const item of result.newItems as RunItem[]) {
      if (item.type === "message_output_item") pushEvent(state, { type: "message", agent: (item as any).agent?.name ?? "Agent", content: String((item as any).content ?? "") });
      if (item.type === "handoff_output_item") {
        const target = (item as any).targetAgent?.name ?? "";
        maybeHydrateForHandoff(state, target);
        pushEvent(state, { type: "handoff", agent: (item as any).sourceAgent?.name ?? "Agent", content: `${(item as any).sourceAgent?.name} -> ${target}`, metadata: { source_agent: (item as any).sourceAgent?.name, target_agent: target } });
      }
      if (item.type === "tool_call_item") pushEvent(state, { type: "tool_call", agent: (item as any).agent?.name ?? "Agent", content: `Calling ${(item as any).rawItem?.name ?? "tool"}`, metadata: { tool_name: (item as any).rawItem?.name ?? "tool", tool_args: (item as any).rawItem?.arguments ?? null } });
      if (item.type === "tool_call_output_item") pushEvent(state, { type: "tool_output", agent: (item as any).agent?.name ?? "Agent", content: String((item as any).output ?? ""), metadata: { tool_result: (item as any).output ?? null } });
    }

    state.input_items = (result as any).history ?? state.input_items;
    state.current_agent = (((result as any).lastAgent?.name as AgentName) ?? state.current_agent);
    const guardrailResults = (result as any).inputGuardrailResults ?? [];
    state.guardrails = guardrailResults.map((r: any) => ({
      id: randomUUID(),
      name: String(r?.guardrail?.name ?? "Guardrail"),
      input: text,
      reasoning: String(r?.output?.outputInfo?.reasoning ?? ""),
      passed: !Boolean(r?.output?.tripwireTriggered),
      timestamp: Date.now()
    }));
    const afterContext = publicContext(state.context);
    const changes = contextDiff(beforeContext, afterContext);
    if (Object.keys(changes).length > 0) {
      pushEvent(state, { type: "context_update", agent: state.current_agent, content: "", metadata: { changes } });
    }
    const reply = [...state.events].reverse().find((e) => e.type === "message")?.content ?? "Done.";
    const eventsDelta = state.events.slice(startEventIndex);
    broadcast(state.thread_id, { ...payload(state), events_delta: eventsDelta });
    return res.json({ type: "response.completed", output: [{ type: "message", content: [{ type: "output_text", text: reply }] }] });
  } catch (err) {
    if (err instanceof InputGuardrailTripwireTriggered) {
      const guardrailName = err.result.guardrail.name;
      const reasoning = String((err.result.output?.outputInfo as any)?.reasoning ?? "");
      state.guardrails = [
        {
          id: randomUUID(),
          name: guardrailName,
          input: text,
          reasoning,
          passed: false,
          timestamp: Date.now()
        }
      ];
      const blocked = "Sorry, I can only answer questions related to airline travel.";
      const ev = pushEvent(state, { type: "message", agent: state.current_agent, content: blocked });
      broadcast(state.thread_id, { ...payload(state), events_delta: [ev] });
      return res.json({ type: "response.completed", output: [{ type: "message", content: [{ type: "output_text", text: blocked }] }] });
    }
    throw err;
  }
});

app.listen(PORT, () => {
  console.log(`TypeScript backend listening on http://localhost:${PORT}`);
});
