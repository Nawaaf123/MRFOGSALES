import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Package, ShoppingBag, FileText, DollarSign, Percent } from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DashboardStats = {
  products_count: number;
  shops_count: number;
  invoices_count: number;
  total_revenue: number;
  collection_rate: number;
};

const Dashboard = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>("/dashboard/stats"),
    enabled: !!user?.id,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {isAdmin ? "Dashboard" : "My Sales Dashboard"}
          </h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Overview of your sales and business metrics"
              : "Your personal sales performance and metrics"}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Products"
            value={isLoading ? "..." : String(stats?.products_count ?? 0)}
            icon={Package}
          />
          <StatsCard
            title="Shops"
            value={isLoading ? "..." : String(stats?.shops_count ?? 0)}
            icon={ShoppingBag}
          />
          <StatsCard
            title="Invoices"
            value={isLoading ? "..." : String(stats?.invoices_count ?? 0)}
            icon={FileText}
          />
          <StatsCard
            title="Revenue"
            value={isLoading ? "..." : `$${(stats?.total_revenue ?? 0).toFixed(2)}`}
            icon={DollarSign}
          />
        </div>

        {isAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Percent className="h-4 w-4" />
                  Payment Collection Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {isLoading ? "..." : `${(stats?.collection_rate ?? 0).toFixed(1)}%`}
                </div>
                <p className="text-sm text-muted-foreground mt-1">Of total invoiced amount collected</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Average Invoice Value</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {isLoading
                    ? "..."
                    : stats?.invoices_count
                      ? `$${((stats.total_revenue || 0) / stats.invoices_count).toFixed(2)}`
                      : "$0.00"}
                </div>
                <p className="text-sm text-muted-foreground mt-1">Per invoice</p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Dashboard;
