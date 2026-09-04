import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { FileText, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RecentActivityProps {
  userId?: string;
  isAdmin?: boolean;
}

export const RecentActivity = ({ userId, isAdmin }: RecentActivityProps) => {
  const { data: recentInvoices, isLoading } = useQuery({
    queryKey: ["recent-invoices", userId, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("invoices")
        .select(`
          *,
          shops!inner (name, is_frozen)
        `)
        .eq("shops.is_frozen", false)
        .order("created_at", { ascending: false })
        .limit(5);
      
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
    switch (status) {
      case "paid":
        return "default";
      case "partial":
        return "secondary";
      case "unpaid":
        return "destructive";
      default:
        return "default";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isAdmin ? "Recent Invoices" : "My Recent Invoices"}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : recentInvoices && recentInvoices.length > 0 ? (
          <div className="space-y-4">
            {recentInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{invoice.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.shops?.name} • {format(new Date(invoice.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-sm">${Number(invoice.total_amount).toFixed(2)}</p>
                  <Badge variant={getStatusColor(invoice.payment_status)} className="text-xs mt-1">
                    {invoice.payment_status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent invoices</p>
        )}
      </CardContent>
    </Card>
  );
};
