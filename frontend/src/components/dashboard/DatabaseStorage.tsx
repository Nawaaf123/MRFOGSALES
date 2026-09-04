import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Database } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const DatabaseStorage = () => {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["database-stats"],
    queryFn: async () => {
      const [sizeResult, products, shops, invoices, payments] = await Promise.all([
        supabase.rpc("get_database_size"),
        supabase.from("products").select("*", { count: "exact", head: true }),
        supabase.from("shops").select("*", { count: "exact", head: true }),
        supabase.from("invoices").select("*", { count: "exact", head: true }),
        supabase.from("payments").select("*", { count: "exact", head: true }),
      ]);

      const sizeData = sizeResult.data?.[0];
      const totalBytes = Number(sizeData?.total_bytes || 0);
      const totalSize = sizeData?.total_size || "0 bytes";

      return {
        totalSize,
        totalBytes,
        products: products.count || 0,
        shops: shops.count || 0,
        invoices: invoices.count || 0,
        payments: payments.count || 0,
      };
    },
  });

  const maxStorageBytes = 8 * 1024 * 1024 * 1024; // 8 GB
  const totalBytes = stats?.totalBytes || 0;
  const usagePercent = Math.min((totalBytes / maxStorageBytes) * 100, 100);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} bytes`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Database Storage</CardTitle>
        <Database className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">
            {isLoading ? "..." : formatSize(totalBytes)}
          </span>
          <span className="text-muted-foreground">8 GB</span>
        </div>
        <Progress value={isLoading ? 0 : usagePercent} className="h-2" />
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2">
          <div>Products: {stats?.products || 0}</div>
          <div>Shops: {stats?.shops || 0}</div>
          <div>Invoices: {stats?.invoices || 0}</div>
          <div>Payments: {stats?.payments || 0}</div>
        </div>
      </CardContent>
    </Card>
  );
};
