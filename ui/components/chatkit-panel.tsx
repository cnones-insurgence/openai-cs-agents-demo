"use client";

import React, { useEffect, useMemo, useState } from "react";

type ChatKitPanelProps = {
  initialThreadId?: string | null;
  onThreadChange?: (threadId: string | null) => void;
  onResponseEnd?: () => void;
  onRunnerUpdate?: () => void;
  onRunnerEventDelta?: (events: any[]) => void;
  onRunnerBindThread?: (threadId: string) => void;
  onChatKitError?: (message: string) => void;
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export function ChatKitPanel({
  initialThreadId,
  onThreadChange,
  onResponseEnd,
  onRunnerUpdate,
  onRunnerEventDelta,
  onRunnerBindThread,
  onChatKitError,
}: ChatKitPanelProps) {
  const [threadId, setThreadId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (initialThreadId) {
      setThreadId(initialThreadId);
      onThreadChange?.(initialThreadId);
      onRunnerBindThread?.(initialThreadId);
    }
  }, [initialThreadId, onRunnerBindThread, onThreadChange]);

  const starterPrompts = useMemo(
    () => [
      "Can you move me to seat 14C?",
      "What's the status of flight FLT-123?",
      "My flight from Paris to New York was delayed and I missed my connection to Austin. Also, my checked bag is missing and I need to spend the night in New York. Can you help me?",
    ],
    []
  );

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || isSending) return;
    setIsSending(true);
    setMessages((m) => [...m, { role: "user", text: content }]);
    setInput("");

    try {
      let activeThreadId = threadId;
      if (!activeThreadId) {
        const boot = await fetch("/chatkit/bootstrap");
        const bootJson = await boot.json();
        activeThreadId = bootJson?.thread_id ?? null;
        if (activeThreadId) {
          setThreadId(activeThreadId);
          onThreadChange?.(activeThreadId);
          onRunnerBindThread?.(activeThreadId);
        }
      }

      const res = await fetch(`/chatkit?thread_id=${encodeURIComponent(activeThreadId ?? "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: content }],
            },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const data = await res.json();
      const assistantText =
        data?.output?.[0]?.content?.[0]?.text ??
        data?.output_text ??
        "Done.";

      setMessages((m) => [...m, { role: "assistant", text: String(assistantText) }]);
      onRunnerUpdate?.();
      onRunnerEventDelta?.([]);
      onResponseEnd?.();
    } catch (err: any) {
      const msg = err?.message ?? "Unknown send error";
      onChatKitError?.(msg);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Sorry, I hit an error sending your message." },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full flex-1 bg-white shadow-sm border border-gray-200 border-t-0 rounded-xl">
      <div className="bg-blue-600 text-white h-12 px-4 flex items-center rounded-t-xl">
        <h2 className="font-semibold text-sm sm:text-base lg:text-lg">Customer View</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
        {messages.length === 0 ? (
          <>
            <div className="text-4xl font-semibold text-zinc-800">Hi! I'm your airline assistant. How can I help today?</div>
            <div className="space-y-2 mt-4">
              {starterPrompts.map((p) => (
                <button
                  key={p}
                  className="block text-left text-zinc-600 hover:text-zinc-900"
                  onClick={() => sendMessage(p)}
                  disabled={isSending}
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={
                  m.role === "user"
                    ? "inline-block rounded-lg bg-blue-600 text-white px-3 py-2 max-w-[80%]"
                    : "inline-block rounded-lg bg-gray-100 text-zinc-900 px-3 py-2 max-w-[80%]"
                }
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="p-3 border-t border-gray-200"
        onSubmit={(e) => {
          e.preventDefault();
          void sendMessage(input);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
            disabled={isSending}
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 text-white px-4 py-2 disabled:opacity-50"
            disabled={isSending || !input.trim()}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
