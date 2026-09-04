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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-orange-500" />
            {isAdmin ? "Pending Payments" : "My Pending Payments"}
          </CardTitle>
          <Badge variant="outline" className="text-sm">
            ${totalPending.toFixed(2)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : pendingInvoices && pendingInvoices.length > 0 ? (
          <div className="space-y-3">
            {pendingInvoices.map((invoice) => {
              const remaining = Math.max(
                0,
                Number(invoice.total_amount) - Number(invoice.amount_paid || 0)
              );
              return (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{invoice.invoice_number}</p>
                      <Badge
                        variant={getStatusColor(invoice.payment_status)}
                        className="text-xs capitalize"
                      >
                        {invoice.payment_status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {invoice.shop?.name || "Unknown Shop"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-orange-600">
                      ${remaining.toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm">No pending payments</p>
            <p className="text-xs mt-1">All invoices are paid!</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
