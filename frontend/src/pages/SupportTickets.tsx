import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDot,
  Clock,
  LifeBuoy,
  MessageSquareText,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";

type SupportTicket = {
  id: string;
  created_by: string;
  created_by_name: string | null;
  created_by_email: string | null;
  subject: string;
  body: string;
  status: "open" | "resolved" | string;
  resolution: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
};

const emptyCreate = { subject: "", body: "" };

const formatWhen = (value: string | null) => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const SupportTickets = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";
  const canUse = user?.role === "admin" || user?.role === "sales" || user?.role === "srour";

  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [resolving, setResolving] = useState<SupportTicket | null>(null);
  const [resolution, setResolution] = useState("");
  const [viewing, setViewing] = useState<SupportTicket | null>(null);

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => api<SupportTicket[]>("/support-tickets"),
    enabled: canUse,
  });

  const filtered = useMemo(() => {
    if (statusFilter === "all") return tickets;
    return tickets.filter((t) => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const openCount = tickets.filter((t) => t.status === "open").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  const createMutation = useMutation({
    mutationFn: () => {
      if (!createForm.subject.trim() || !createForm.body.trim()) {
        throw { message: "Subject and details are required" } satisfies ApiError;
      }
      return api<SupportTicket>("/support-tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: createForm.subject.trim(),
          body: createForm.body.trim(),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      toast({ title: "Support request submitted" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () => {
      if (!resolving) throw { message: "Nothing to resolve" } satisfies ApiError;
      if (!resolution.trim()) {
        throw { message: "Resolution notes are required" } satisfies ApiError;
      }
      return api<SupportTicket>(`/support-tickets/${resolving.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution: resolution.trim() }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      setResolving(null);
      setResolution("");
      toast({ title: "Marked as resolved" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (user && !canUse) {
    return <Navigate to="/dashboard" replace />;
  }

  const filters: { id: "all" | "open" | "resolved"; label: string; count: number }[] = [
    { id: "all", label: "All", count: tickets.length },
    { id: "open", label: "Open", count: openCount },
    { id: "resolved", label: "Resolved", count: resolvedCount },
  ];

  return (
    <>
      <div className="space-y-5">
        {/* Hero band */}
        <section className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.12] via-white to-white px-4 py-5 sm:px-6 sm:py-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 right-16 h-36 w-36 rounded-full bg-primary/10 blur-2xl"
          />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
                <LifeBuoy className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Support</h1>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {isAdmin
                    ? "See what the team needs help with, then leave a clear resolution."
                    : "Stuck on something? Send it here — we'll reply with a fix when ready."}
                </p>
              </div>
            </div>

            <Button
              className="h-11 w-full shrink-0 shadow-sm shadow-primary/25 sm:w-auto"
              onClick={() => {
                setCreateForm(emptyCreate);
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New request
            </Button>
          </div>

          <div className="relative mt-5 grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-xl border border-primary/10 bg-white/80 px-3 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
                <CircleDot className="h-3.5 w-3.5" />
                Open
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{openCount}</p>
            </div>
            <div className="rounded-xl border border-border bg-white/80 px-3 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Resolved
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{resolvedCount}</p>
            </div>
          </div>
        </section>

        {/* Filters */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors",
                statusFilter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-xs tabular-nums",
                  statusFilter === f.id ? "bg-white/20" : "bg-muted text-muted-foreground"
                )}
              >
                {f.count}
              </span>
            </button>
          ))}
        </div>

        {/* Ticket list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[5.5rem] animate-pulse rounded-xl border border-border bg-muted/60"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-primary/25 bg-gradient-to-b from-primary/[0.06] to-transparent px-6 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="h-7 w-7" />
              </div>
              <p className="text-base font-semibold">No requests here</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {statusFilter === "open"
                  ? "Nothing open right now — nice work."
                  : statusFilter === "resolved"
                    ? "No resolved tickets in this view yet."
                    : "Tap New request when you need help."}
              </p>
              {statusFilter === "all" && (
                <Button
                  className="mt-5 h-11"
                  onClick={() => {
                    setCreateForm(emptyCreate);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New request
                </Button>
              )}
            </div>
          ) : (
            filtered.map((ticket) => {
              const isOpen = ticket.status === "open";
              return (
                <article
                  key={ticket.id}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border bg-card transition-all duration-200",
                    "hover:border-primary/35 hover:shadow-md hover:shadow-primary/10",
                    isOpen ? "border-primary/20" : "border-border"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 w-1",
                      isOpen ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  />
                  <div className="flex flex-col gap-3 p-4 pl-5 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setViewing(ticket)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold group-hover:text-primary">
                          {ticket.subject}
                        </h2>
                        <Badge
                          className={cn(
                            "capitalize",
                            isOpen
                              ? "bg-primary/15 text-primary hover:bg-primary/15"
                              : "bg-muted text-muted-foreground hover:bg-muted"
                          )}
                          variant="secondary"
                        >
                          {ticket.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{ticket.body}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatWhen(ticket.created_at)}
                        </span>
                        {isAdmin && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="h-3.5 w-3.5" />
                            {ticket.created_by_name || ticket.created_by_email || "Unknown"}
                          </span>
                        )}
                        {ticket.resolution && (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <MessageSquareText className="h-3.5 w-3.5" />
                            Has resolution
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="flex shrink-0 gap-2 sm:flex-col sm:items-stretch lg:flex-row">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 flex-1 sm:flex-none"
                        onClick={() => setViewing(ticket)}
                      >
                        View
                      </Button>
                      {isAdmin && isOpen && (
                        <Button
                          size="sm"
                          className="h-10 flex-1 sm:flex-none"
                          onClick={() => {
                            setResolving(ticket);
                            setResolution("");
                          }}
                        >
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />
                          Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <LifeBuoy className="h-5 w-5 text-primary" />
                New support request
              </DialogTitle>
              <DialogDescription>
                Describe the problem clearly so we can fix it faster.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="support-subject">Subject</Label>
              <Input
                id="support-subject"
                value={createForm.subject}
                onChange={(e) => setCreateForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Short summary of the issue"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-body">Details</Label>
              <Textarea
                id="support-body"
                value={createForm.body}
                onChange={(e) => setCreateForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="What went wrong? Which shop/invoice? What did you try?"
                rows={5}
                className="resize-none"
              />
            </div>
            <Button
              className="h-11 w-full"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-5">
            <DialogHeader>
              <DialogTitle className="pr-6 text-xl leading-snug">{viewing?.subject}</DialogTitle>
              {viewing && (
                <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge
                    className={cn(
                      "capitalize",
                      viewing.status === "open"
                        ? "bg-primary/15 text-primary hover:bg-primary/15"
                        : "bg-muted text-muted-foreground hover:bg-muted"
                    )}
                    variant="secondary"
                  >
                    {viewing.status}
                  </Badge>
                  <span>{formatWhen(viewing.created_at)}</span>
                </DialogDescription>
              )}
            </DialogHeader>
          </div>
          {viewing && (
            <div className="space-y-4 px-6 py-5 text-sm">
              {isAdmin && (
                <p className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <UserRound className="h-4 w-4" />
                  {viewing.created_by_name} · {viewing.created_by_email}
                </p>
              )}
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Issue
                </p>
                <p className="whitespace-pre-wrap leading-relaxed text-foreground">{viewing.body}</p>
              </div>
              {viewing.resolution && (
                <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                    Resolution
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground">
                    {viewing.resolution}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {viewing.resolved_by_name ? `By ${viewing.resolved_by_name} · ` : ""}
                    {formatWhen(viewing.resolved_at)}
                  </p>
                </div>
              )}
              {isAdmin && viewing.status === "open" && (
                <Button
                  className="h-11 w-full"
                  onClick={() => {
                    setViewing(null);
                    setResolving(viewing);
                    setResolution("");
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Resolve this
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!resolving}
        onOpenChange={(open) => {
          if (!open) {
            setResolving(null);
            setResolution("");
          }
        }}
      >
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-5">
            <DialogHeader>
              <DialogTitle className="text-xl">Resolve request</DialogTitle>
              <DialogDescription className="line-clamp-2">{resolving?.subject}</DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="whitespace-pre-wrap">{resolving?.body}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-resolution">Your resolution</Label>
              <Textarea
                id="support-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="What fixed it / what should the sales person do?"
                rows={4}
                className="resize-none"
              />
            </div>
            <Button
              className="h-11 w-full"
              disabled={resolveMutation.isPending}
              onClick={() => resolveMutation.mutate()}
            >
              {resolveMutation.isPending ? "Saving…" : "Mark resolved"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default SupportTickets;
