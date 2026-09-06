import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type LowStockProduct = {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  stock_quantity_b: number;
  low_stock_threshold: number;
  total_stock: number;
};

export const LowStockAlert = () => {
  const { data: lowStockProducts, isLoading } = useQuery({
    queryKey: ["low-stock-products"],
    queryFn: () => api<LowStockProduct[]>("/dashboard/low-stock"),
  });

  return (
    <Card className="overflow-hidden border-primary/10">
      <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.07] to-transparent">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AlertTriangle className="h-4 w-4" />
          </span>
          Low stock alert
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
            <div className="h-14 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : lowStockProducts && lowStockProducts.length > 0 ? (
          <div className="space-y-2">
            {lowStockProducts.map((product) => (
              <div
                key={product.id}
                className="relative flex items-center justify-between overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.04] p-3 pl-4"
              >
                <div className="absolute inset-y-0 left-0 w-1 bg-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.category} · A: {product.stock_quantity} · B:{" "}
                    {product.stock_quantity_b || 0}
                  </p>
                </div>
                <Badge variant="destructive">{product.total_stock} left</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-sm font-medium">All products well stocked</p>
            <p className="mt-1 text-xs text-muted-foreground">Nothing below threshold</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
