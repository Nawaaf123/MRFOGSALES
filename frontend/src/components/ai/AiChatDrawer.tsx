import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type ChatMsg = { role: "user" | "assistant"; content: string };

export function AiChatDrawer() {
  const { user } = useAuth();
  const role = user?.role;
  const allowed = role === "admin" || role === "sales" || role === "srour";

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: "Ask about unpaid shops, recent invoices, low stock, or top products.",
    },
  ]);

  const chatMutation = useMutation({
    mutationFn: (history: ChatMsg[]) =>
      api<{ reply: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (error: ApiError) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error.status === 503
              ? "AI is not configured yet (missing OpenAI key on the server)."
              : error.message || "Something went wrong.",
        },
      ]);
    },
  });

  if (!allowed) return null;

  const send = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    const forApi: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(forApi);
    setInput("");
    chatMutation.mutate(forApi);
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        className="fixed z-40 h-12 w-12 rounded-full shadow-lg right-4 bottom-20 md:bottom-6 md:right-6"
        onClick={() => setOpen(true)}
        aria-label="Ask AI"
      >
        <Bot className="h-5 w-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[min(85dvh,32rem)] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="px-4 py-3 border-b flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-base">Ask AI</SheetTitle>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </SheetHeader>

          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-3 pb-2">
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={cn(
                    "max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "mr-auto bg-muted text-foreground"
                  )}
                >
                  {m.content}
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="mr-auto bg-muted text-muted-foreground rounded-lg px-3 py-2 text-sm">
                  Thinking…
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3 flex gap-2 safe-area-inset">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Which shops have unpaid balances?"
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={chatMutation.isPending}
            />
            <Button
              type="button"
              className="h-11 w-11 shrink-0"
              disabled={!input.trim() || chatMutation.isPending}
              onClick={send}
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
