import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const LowStockAlert = () => {
  const { data: lowStockProducts, isLoading } = useQuery({
    queryKey: ["low-stock-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true);

      if (error) throw error;

      return (data as any[])
        .map((p) => ({
          ...p,
          total_stock: (p.stock_quantity || 0) + (p.stock_quantity_b || 0),
        }))
        .filter((p) => p.total_stock <= p.low_stock_threshold)
        .sort((a, b) => a.total_stock - b.total_stock)
        .slice(0, 5);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Low Stock Alert
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : lowStockProducts && lowStockProducts.length > 0 ? (
          <div className="space-y-3">
            {lowStockProducts.map((product: any) => (
              <div
                key={product.id}
                className="flex items-center justify-between p-3 border border-orange-200 rounded-lg bg-orange-50/50"
              >
                <div>
                  <p className="font-medium text-sm">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.category} · A: {product.stock_quantity} · B: {product.stock_quantity_b || 0}
                  </p>
                </div>
                <Badge variant="destructive">
                  {product.total_stock} left
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">All products well stocked ✓</p>
        )}
      </CardContent>
    </Card>
  );
};
