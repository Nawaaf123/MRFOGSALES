import { lazy, Suspense, useState } from "react";
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
} from "lucide-react";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { LowStockAlert } from "@/components/dashboard/LowStockAlert";
import { PendingPayments } from "@/components/dashboard/PendingPayments";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { TopShops } from "@/components/dashboard/TopShops";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const LocationsMap = lazy(() =>
  import("@/components/location/SalesMap").then((m) => ({ default: m.LocationsMap }))
);

type DashboardStats = {
  products_count: number;
  shops_count: number;
  invoices_count: number;
  total_revenue: number;
  collection_rate: number;
  unpaid_invoices?: number;
};

const Dashboard = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // Don't auto-load heavy Mapbox bundle on phones — tap to open
  const [showMap, setShowMap] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true
  );

  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api<DashboardStats>("/dashboard/stats"),
    enabled: !!user?.id,
  });

  return (
    <>
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
            href="/products"
          />
          <StatsCard
            title="Shops"
            value={isLoading ? "..." : String(stats?.shops_count ?? 0)}
            icon={ShoppingBag}
            href="/shops"
          />
          <StatsCard
            title="Invoices"
            value={isLoading ? "..." : String(stats?.invoices_count ?? 0)}
            icon={FileText}
            href="/invoices"
          />
          <StatsCard
            title="Revenue"
            value={isLoading ? "..." : `$${(stats?.total_revenue ?? 0).toFixed(2)}`}
            icon={DollarSign}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <StatsCard
            title="Unpaid Invoices"
            value={isLoading ? "..." : String(stats?.unpaid_invoices ?? 0)}
            icon={AlertCircle}
            href="/invoices"
            description="Unpaid or partially paid"
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
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Locations map</h2>
                <p className="text-sm text-muted-foreground">
                  Shop pins and live salesperson GPS on one map
                </p>
              </div>
              {!showMap && (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto h-11"
                  onClick={() => setShowMap(true)}
                >
                  <MapIcon className="h-4 w-4 mr-2" />
                  Load map
                </Button>
              )}
            </div>
            {showMap ? (
              <Suspense
                fallback={
                  <div className="flex h-[280px] md:h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
                    Loading map...
                  </div>
                }
              >
                <LocationsMap heightClassName="h-[280px] md:h-[420px]" />
              </Suspense>
            ) : (
              <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground px-4 text-center">
                Map paused on mobile to save data — tap Load map when you need it
              </div>
            )}
          </div>
        )}

        
      </div>
    </>
  );
};

export default Dashboard;
