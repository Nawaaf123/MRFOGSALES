import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { Store } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type ShopSalesRow = {
  shop_name: string;
  invoice_count: number;
  total_revenue: number;
};

export const TopShops = () => {
  const { data: topShops, isLoading } = useQuery({
    queryKey: ["top-shops", 5],
    queryFn: () => api<ShopSalesRow[]>("/analytics/top-shops?limit=5"),
  });

  const maxTotal = topShops?.[0]?.total_revenue || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Shops by Revenue</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : topShops && topShops.length > 0 ? (
          <div className="space-y-4">
            {topShops.map((shop, index) => (
              <div key={`${shop.shop_name}-${index}`} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{shop.shop_name}</span>
                  </div>
                  <span className="text-sm font-semibold">
                    ${Number(shop.total_revenue).toFixed(2)}
                  </span>
                </div>
                <Progress
                  value={(Number(shop.total_revenue) / Number(maxTotal)) * 100}
                  className="h-2"
                />
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
