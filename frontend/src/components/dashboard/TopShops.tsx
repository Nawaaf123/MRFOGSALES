import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Store } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface TopShopsProps {
  userId?: string;
  isAdmin?: boolean;
}

export const TopShops = ({ userId, isAdmin }: TopShopsProps) => {
  const { data: topShops, isLoading } = useQuery({
    queryKey: ["top-shops", userId, isAdmin],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_shops", {
        p_user_id: isAdmin ? null : (userId ?? null),
        p_limit: 5,
      });

      if (error) throw error;
      return data as { shop_name: string; total_revenue: number }[];
    },
    enabled: !!userId,
  });

  const maxTotal = topShops?.[0]?.total_revenue || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isAdmin ? "Top Shops by Revenue" : "My Top Shops"}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : topShops && topShops.length > 0 ? (
          <div className="space-y-4">
            {topShops.map((shop, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{shop.shop_name}</span>
                  </div>
                  <span className="text-sm font-semibold">${Number(shop.total_revenue).toFixed(2)}</span>
                </div>
                <Progress value={(Number(shop.total_revenue) / Number(maxTotal)) * 100} className="h-2" />
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
