import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type PendingInvoice = {
  id: string;
  invoice_number: string;
  total_amount: number;
  amount_paid: number;
  payment_status: "paid" | "partial" | "unpaid";
  shop: { id: string; name: string } | null;
};

export const PendingPayments = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: pendingInvoices, isLoading } = useQuery({
    queryKey: ["pending-payments"],
    queryFn: () => api<PendingInvoice[]>("/dashboard/pending-payments"),
    enabled: !!user?.id,
  });

  const getStatusColor = (status: string) => {
    return status === "unpaid" ? "destructive" : "secondary";
  };

  const totalPending =
    pendingInvoices?.reduce((sum, inv) => {
      const remaining = Math.max(0, Number(inv.total_amount) - Number(inv.amount_paid || 0));
      return sum + remaining;
    }, 0) || 0;

  return (
    <Card className="overflow-hidden border-primary/10">
      <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.07] to-transparent">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <AlertCircle className="h-4 w-4" />
            </span>
            {isAdmin ? "Pending payments" : "My pending payments"}
          </CardTitle>
          <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
            ${totalPending.toFixed(2)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : pendingInvoices && pendingInvoices.length > 0 ? (
          <div className="space-y-2">
            {pendingInvoices.map((invoice) => {
              const remaining = Math.max(
                0,
                Number(invoice.total_amount) - Number(invoice.amount_paid || 0)
              );
              return (
                <div
                  key={invoice.id}
                  className="relative flex items-center justify-between overflow-hidden rounded-lg border border-border p-3 pl-4 transition-colors hover:border-primary/30 hover:bg-primary/[0.03]"
                >
                  <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{invoice.invoice_number}</p>
                      <Badge
                        variant={getStatusColor(invoice.payment_status)}
                        className="text-xs capitalize"
                      >
                        {invoice.payment_status}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {invoice.shop?.name || "Unknown Shop"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-primary">
                      ${remaining.toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-muted-foreground">
            <p className="text-sm font-medium text-foreground">No pending payments</p>
            <p className="mt-1 text-xs">All invoices are paid</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
