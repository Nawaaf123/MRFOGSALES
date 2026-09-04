import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { FileText, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchAllRows, fetchAllByIds } from "@/lib/fetchAll";

interface ShopInvoicesProps {
  shopId: string;
  shopName: string;
}

export const ShopInvoices = ({ shopId, shopName }: ShopInvoicesProps) => {
  const navigate = useNavigate();

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["shop-invoices", shopId],
    queryFn: async () =>
      await fetchAllRows<any>(() =>
        supabase
          .from("invoices")
          .select("id, invoice_number, total_amount, payment_status, created_at, discount_amount")
          .eq("shop_id", shopId)
          .order("created_at", { ascending: false })
      ),
  });

  const { data: payments } = useQuery({
    queryKey: ["shop-invoice-payments", shopId, invoices?.length],
    queryFn: async () => {
      if (!invoices?.length) return [];
      const invoiceIds = invoices.map((i) => i.id);
      return await fetchAllByIds<{ invoice_id: string; amount: number }>(
        invoiceIds,
        (chunk) => supabase.from("payments").select("invoice_id, amount").in("invoice_id", chunk)
      );
    },
    enabled: !!invoices?.length,
  });


  const getPaymentTotal = (invoiceId: string) => {
    return payments?.filter((p) => p.invoice_id === invoiceId).reduce((sum, p) => sum + Number(p.amount), 0) || 0;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "paid": return "bg-green-100 text-green-800 border-green-200";
      case "partial": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default: return "bg-red-100 text-red-800 border-red-200";
    }
  };

  if (isLoading) {
    return (
      <div className="py-4 px-2 text-sm text-muted-foreground">
        Loading invoices...
      </div>
    );
  }

  if (!invoices?.length) {
    return (
      <div className="py-4 px-2 text-sm text-muted-foreground flex items-center gap-2">
        <FileText className="h-4 w-4" />
        No invoices for this shop
      </div>
    );
  }

  const totalOwed = invoices.reduce((sum, inv) => {
    const paid = getPaymentTotal(inv.id);
    const remaining = Number(inv.total_amount) - paid;
    return sum + (remaining > 0 ? remaining : 0);
  }, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-medium text-muted-foreground">
          {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
        </p>
        {totalOwed > 0 && (
          <div className="flex items-center gap-1 text-sm font-semibold text-destructive">
            <DollarSign className="h-3.5 w-3.5" />
            {totalOwed.toFixed(2)} owed
          </div>
        )}
      </div>
      <div className="space-y-1.5 max-h-60 overflow-y-auto">
        {invoices.map((inv) => {
          const paid = getPaymentTotal(inv.id);
          const remaining = Number(inv.total_amount) - paid;
          return (
            <div
              key={inv.id}
              onClick={() => navigate(`/invoices?search=${encodeURIComponent(inv.invoice_number)}`)}
              className="flex items-center justify-between p-2 rounded-md border bg-background hover:bg-accent/50 cursor-pointer transition-colors text-sm"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{inv.invoice_number}</span>
                <span className="text-muted-foreground text-xs">
                  {format(new Date(inv.created_at), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">${Number(inv.total_amount).toFixed(2)}</span>
                <Badge className={`text-xs ${statusColor(inv.payment_status)}`}>
                  {inv.payment_status}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
