"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, GripHorizontal, Loader2, Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { apiPath } from "@/lib/api-path";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MIN_W = 320;
const MIN_H = 300;
const DEFAULT_W = 420;
const DEFAULT_H = 520;

export function ForecastChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_W, height: DEFAULT_H });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Drag-to-resize from the top-left handle (panel is anchored bottom-right,
  // so dragging up/left expands it in those directions).
  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };

    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const dw = dragRef.current.startX - e.clientX;
      const dh = dragRef.current.startY - e.clientY;
      // Keep the panel within the viewport (24px right margin, 88px bottom offset, 16px breathing room)
      const maxW = window.innerWidth - 24 - 16;
      const maxH = window.innerHeight - 88 - 16;
      setSize({
        width:  Math.min(maxW, Math.max(MIN_W, dragRef.current.startW + dw)),
        height: Math.min(maxH, Math.max(MIN_H, dragRef.current.startH + dh)),
      });
    }

    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setStatusText(null);
    setError(null);

    try {
      const res = await fetch(apiPath("/api/forecast/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Request failed");
        return;
      }

      // Add placeholder assistant message that we'll fill in via deltas
      setMessages([...next, { role: "assistant", content: "" }]);

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          if (event.type === "status") {
            setStatusText(event.text as string);
          } else if (event.type === "delta") {
            const chunk = event.text as string;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: updated[updated.length - 1].content + chunk,
              };
              return updated;
            });
          } else if (event.type === "done") {
            setStatusText(null);
          } else if (event.type === "error") {
            setError(event.text as string);
          }
        }
      }
    } catch {
      setError("Could not reach the forecast server.");
    } finally {
      setLoading(false);
      setStatusText(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus:outline-none"
        aria-label="Open forecast assistant"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-22 right-6 z-50 flex flex-col rounded-xl border bg-background shadow-2xl"
          style={{ width: size.width, height: size.height }}
        >
          {/* Resize handle — top-left corner */}
          <div
            onMouseDown={onResizeStart}
            className="absolute -top-1 -left-1 z-10 flex h-5 w-5 cursor-nw-resize items-center justify-center rounded-sm text-muted-foreground opacity-40 hover:opacity-80"
            title="Drag to resize"
          >
            <GripHorizontal className="h-3 w-3 rotate-45" />
          </div>

          {/* Header */}
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Forecast Assistant</span>
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setError(null); setStatusText(null); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm min-h-0">
            {messages.length === 0 && !loading && (
              <p className="text-center text-muted-foreground text-xs mt-8">
                Ask about forecasts, segments, SKU demand, accuracy, or order recommendations.
              </p>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
                      : "w-full rounded-2xl rounded-bl-sm bg-muted px-3 py-2"
                  }
                >
                  {m.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none
                      [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5
                      [&_code]:bg-background [&_code]:px-1 [&_code]:rounded
                      [&_strong]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
                      [&_hr]:border-border [&_hr]:my-2">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="w-full border-collapse text-xs">{children}</table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th className="border border-border bg-background/60 px-2 py-1 text-left font-medium">{children}</th>
                          ),
                          td: ({ children }) => (
                            <td className="border border-border px-2 py-1">{children}</td>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <span>{m.content}</span>
                  )}
                </div>
              </div>
            ))}

            {loading && !messages.at(-1)?.content && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                  {statusText && (
                    <span className="text-xs text-muted-foreground">{statusText}</span>
                  )}
                </div>
              </div>
            )}

            {error && (
              <p className="text-center text-xs text-destructive">{error}</p>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t px-3 py-3 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about demand, forecasts, or order amounts…"
              rows={1}
              className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              style={{ maxHeight: "100px", overflowY: "auto" }}
              disabled={loading}
            />
            <Button size="icon" onClick={send} disabled={loading || !input.trim()} className="h-9 w-9 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
