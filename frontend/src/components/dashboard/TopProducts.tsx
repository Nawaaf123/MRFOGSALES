import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Package } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type ProductSalesRow = {
  product_name: string;
  total_quantity: number;
  total_revenue: number;
};

export const TopProducts = () => {
  const { data: topProducts, isLoading } = useQuery({
    queryKey: ["top-products", 5],
    queryFn: () => api<ProductSalesRow[]>("/analytics/top-products?limit=5"),
  });

  const maxQuantity = topProducts?.[0]?.total_quantity || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Selling Products</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : topProducts && topProducts.length > 0 ? (
          <div className="space-y-4">
            {topProducts.map((product, index) => (
              <div key={`${product.product_name}-${index}`} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{product.product_name}</span>
                  </div>
                  <span className="text-sm font-semibold">{product.total_quantity} units</span>
                </div>
                <Progress value={(product.total_quantity / maxQuantity) * 100} className="h-2" />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No sales data yet</p>
        )}
      </CardContent>
    </Card>
  );
};
