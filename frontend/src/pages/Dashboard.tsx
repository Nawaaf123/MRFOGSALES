import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Package,
  ShoppingBag,
  FileText,
  DollarSign,
  Percent,
  AlertCircle,
  Map as MapIcon,
  LayoutDashboard,
} from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { LowStockAlert } from "@/components/dashboard/LowStockAlert";
import { PendingPayments } from "@/components/dashboard/PendingPayments";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { TopShops } from "@/components/dashboard/TopShops";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHero } from "@/components/ui/PageHero";
import { DeferredLocationsMap } from "@/components/location/DeferredLocationsMap";

type DashboardStats = {
  products_count: number;
  shops_count: number;
  invoices_count: number;
  total_revenue: number;
  collection_rate: number;
  unpaid_invoices?: number;
};

const greetingFor = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const Dashboard = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>("/dashboard/stats"),
    enabled: !!user?.id,
  });

  const firstName = user?.full_name?.split(" ")[0] || "there";
  const greeting = useMemo(() => greetingFor(), []);

  const avgInvoice =
    stats?.invoices_count && stats.invoices_count > 0
      ? `$${((stats.total_revenue || 0) / stats.invoices_count).toFixed(2)}`
      : "$0.00";

  return (
    <div className="space-y-6">
      <PageHero
        icon={LayoutDashboard}
        title={`${greeting}, ${firstName}`}
        description={
          isAdmin
            ? "Your sales pulse — revenue, collections, and what’s waiting on you."
            : "Your personal sales performance and what’s still outstanding."
        }
        stats={[
          {
            label: "Revenue",
            value: isLoading ? "…" : `$${(stats?.total_revenue ?? 0).toFixed(0)}`,
            accent: true,
          },
          {
            label: "Unpaid",
            value: isLoading ? "…" : String(stats?.unpaid_invoices ?? 0),
          },
          ...(isAdmin
            ? [
                {
                  label: "Collected",
                  value: isLoading ? "…" : `${(stats?.collection_rate ?? 0).toFixed(0)}%`,
                },
              ]
            : []),
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Products"
          value={isLoading ? "…" : String(stats?.products_count ?? 0)}
          icon={Package}
          href="/products"
        />
        <StatsCard
          title="Shops"
          value={isLoading ? "…" : String(stats?.shops_count ?? 0)}
          icon={ShoppingBag}
          href="/shops"
        />
        <StatsCard
          title="Invoices"
          value={isLoading ? "…" : String(stats?.invoices_count ?? 0)}
          icon={FileText}
          href="/invoices"
        />
        <StatsCard
          title="Unpaid"
          value={isLoading ? "…" : String(stats?.unpaid_invoices ?? 0)}
          icon={AlertCircle}
          href="/invoices"
          accent
          description="Unpaid or partial"
        />
      </div>

      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Percent className="h-4 w-4" />
                </span>
                Collection rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? "…" : `${(stats?.collection_rate ?? 0).toFixed(1)}%`}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Of total invoiced amount collected</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, stats?.collection_rate ?? 0))}%`,
                  }}
                />
              </div>
            </CardContent>
          </Card>
          <Card className="border-primary/10">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <DollarSign className="h-4 w-4" />
                </span>
                Average invoice
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {isLoading ? "…" : avgInvoice}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Per invoice</p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className={`grid gap-4 ${isAdmin ? "md:grid-cols-2" : ""}`}>
        <PendingPayments />
        {isAdmin && <LowStockAlert />}
      </div>

      {isAdmin && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <TopProducts />
          <TopShops />
          <RecentActivity />
        </div>
      )}

      {isAdmin && (
        <section className="overflow-hidden rounded-2xl border border-primary/15 bg-card">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.08] to-transparent px-4 py-4 sm:px-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <MapIcon className="h-5 w-5 text-primary" />
              Locations map
            </h2>
            <p className="text-sm text-muted-foreground">
              Red markers show shop locations
            </p>
          </div>
          <div className="p-2 sm:p-3">
            <DeferredLocationsMap heightClassName="h-[280px] md:h-[420px]" />
          </div>
        </section>
      )}
    </div>
  );
};

export default Dashboard;
