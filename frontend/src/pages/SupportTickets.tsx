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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, LifeBuoy, Plus } from "lucide-react";

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
    return new Date(value).toLocaleString();
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

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <LifeBuoy className="h-6 w-6" />
              Support
            </h1>
            <p className="text-muted-foreground">
              {isAdmin
                ? "Review issues from the sales team and add resolutions"
                : "Report an issue and track when it gets resolved"}
            </p>
          </div>
          <Button
            className="w-full sm:w-auto h-11"
            onClick={() => {
              setCreateForm(emptyCreate);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            New request
          </Button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isAdmin ? `${openCount} open` : `${tickets.length} of your requests`}
          </p>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "all" | "open" | "resolved")}
          >
            <SelectTrigger className="w-full sm:w-[160px] h-11">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                {isAdmin && <TableHead>From</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 5 : 4} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 5 : 4} className="text-muted-foreground">
                    No support requests yet
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-medium max-w-[220px]">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setViewing(ticket)}
                      >
                        {ticket.subject}
                      </button>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-sm">
                        <div>{ticket.created_by_name || "—"}</div>
                        <div className="text-muted-foreground truncate max-w-[160px]">
                          {ticket.created_by_email}
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={ticket.status === "open" ? "default" : "secondary"}>
                        {ticket.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatWhen(ticket.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setViewing(ticket)}>
                          View
                        </Button>
                        {isAdmin && ticket.status === "open" && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setResolving(ticket);
                              setResolution("");
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Resolve
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New support request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
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
              />
            </div>
            <Button
              className="w-full h-11"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.subject}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={viewing.status === "open" ? "default" : "secondary"}>
                  {viewing.status}
                </Badge>
                <span className="text-muted-foreground">{formatWhen(viewing.created_at)}</span>
              </div>
              {isAdmin && (
                <p className="text-muted-foreground">
                  From {viewing.created_by_name} ({viewing.created_by_email})
                </p>
              )}
              <div>
                <p className="font-medium mb-1">Issue</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{viewing.body}</p>
              </div>
              {viewing.resolution && (
                <div>
                  <p className="font-medium mb-1">Resolution</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{viewing.resolution}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {viewing.resolved_by_name ? `By ${viewing.resolved_by_name} · ` : ""}
                    {formatWhen(viewing.resolved_at)}
                  </p>
                </div>
              )}
              {isAdmin && viewing.status === "open" && (
                <Button
                  className="w-full h-11"
                  onClick={() => {
                    setViewing(null);
                    setResolving(viewing);
                    setResolution("");
                  }}
                >
                  Resolve
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve: {resolving?.subject}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{resolving?.body}</p>
            <div className="space-y-2">
              <Label htmlFor="support-resolution">Resolution</Label>
              <Textarea
                id="support-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="What fixed it / what should the sales person do?"
                rows={4}
              />
            </div>
            <Button
              className="w-full h-11"
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
