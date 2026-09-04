import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PendingPaymentsProps {
  userId?: string;
  isAdmin?: boolean;
}

export const PendingPayments = ({ userId, isAdmin }: PendingPaymentsProps) => {
  const { data: pendingInvoices, isLoading } = useQuery({
    queryKey: ["pending-payments", userId, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("invoices")
        .select(`
          id,
          invoice_number,
          total_amount,
          payment_status,
          created_at,
          shops!inner (name, is_frozen)
        `)
        .eq("shops.is_frozen", false)
        .in("payment_status", ["unpaid", "partial"])
        .order("created_at", { ascending: false })
        .limit(8);
      
      // Filter by user if not admin
      if (!isAdmin && userId) {
        query = query.eq("created_by", userId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });

  const getStatusColor = (status: string) => {
    return status === "unpaid" ? "destructive" : "secondary";
  };

  const totalPending = pendingInvoices?.reduce(
    (sum, inv) => sum + Number(inv.total_amount),
    0
  ) || 0;

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
            {pendingInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm">{invoice.invoice_number}</p>
                    <Badge variant={getStatusColor(invoice.payment_status)} className="text-xs">
                      {invoice.payment_status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {invoice.shops?.name || "Unknown Shop"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm text-orange-600">
                    ${Number(invoice.total_amount).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
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
