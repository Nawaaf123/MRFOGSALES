import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  startOfMonth,
  startOfYear,
  subDays,
  format,
} from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as XLSX from "xlsx";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHero } from "@/components/ui/PageHero";
import { FilterChips } from "@/components/ui/FilterChips";
import { EmptyState } from "@/components/ui/EmptyState";
import { api } from "@/lib/api";
import {
  AlertTriangle,
  BarChart3,
  DollarSign,
  Download,
  FileText,
  Package,
  Percent,
  ShoppingBag,
  TrendingDown,
} from "lucide-react";

type DatePreset = "7d" | "30d" | "90d" | "month" | "year";

type Overview = {
  invoice_count: number;
  revenue: number;
  discounts: number;
  collected: number;
  outstanding: number;
  collection_rate: number;
  paid_count: number;
  unpaid_count: number;
  partial_count: number;
  unique_shops: number;
  units_sold: number;
  average_invoice: number;
};

type OverviewCompare = {
  current: Overview;
  prior: Overview;
  revenue_delta_pct: number | null;
  collected_delta_pct: number | null;
  outstanding_delta_pct: number | null;
  invoice_count_delta_pct: number | null;
  units_sold_delta_pct: number | null;
  collection_rate_delta_pp: number | null;
};

type MoneyMix = {
  paid_amount: number;
  partial_outstanding: number;
  unpaid_amount: number;
  outstanding: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
};

type ProductSalesRow = {
  product_name: string;
  total_quantity: number;
  total_revenue: number;
};

type ShopSalesRow = {
  shop_name: string;
  invoice_count: number;
  total_revenue: number;
};

type QuietShopRow = {
  shop_id: string;
  shop_name: string;
  prior_invoice_count: number;
  prior_revenue: number;
  last_invoice_at: string | null;
};

type CategorySalesRow = {
  category: string;
  total_quantity: number;
  total_revenue: number;
};

type DailySalesRow = {
  date: string;
  invoice_count: number;
  revenue: number;
  collected: number;
};

function rangeForPreset(preset: DatePreset): { from: Date; to: Date } {
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  let from: Date;
  switch (preset) {
    case "7d":
      from = subDays(to, 6);
      break;
    case "30d":
      from = subDays(to, 29);
      break;
    case "90d":
      from = subDays(to, 89);
      break;
    case "month":
      from = startOfMonth(to);
      break;
    case "year":
      from = startOfYear(to);
      break;
  }
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function toQuery(from: Date, to: Date) {
  const params = new URLSearchParams({
    date_from: from.toISOString(),
    date_to: to.toISOString(),
  });
  return params.toString();
}

function trendFromDelta(delta: number | null | undefined, invertGood = false) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return undefined;
  const isPositive = invertGood ? delta <= 0 : delta >= 0;
  return { value: Math.abs(delta), isPositive, label: "vs prior period" };
}

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
];

const ProductAnalytics = () => {
  const [preset, setPreset] = useState<DatePreset>("30d");
  const { from, to } = useMemo(() => rangeForPreset(preset), [preset]);
  const qs = useMemo(() => toQuery(from, to), [from, to]);

  const { data: compare, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics-overview-compare", qs],
    queryFn: () => api<OverviewCompare>(`/analytics/overview-compare?${qs}`),
  });

  const overview = compare?.current;

  const { data: moneyMix, isLoading: moneyLoading } = useQuery({
    queryKey: ["analytics-money-mix", qs],
    queryFn: () => api<MoneyMix>(`/analytics/money-mix?${qs}`),
  });

  const { data: daily = [], isLoading: dailyLoading } = useQuery({
    queryKey: ["analytics-daily", qs],
    queryFn: () => api<DailySalesRow[]>(`/analytics/daily?${qs}`),
  });

  const { data: categories = [], isLoading: catLoading } = useQuery({
    queryKey: ["analytics-category", qs],
    queryFn: () => api<CategorySalesRow[]>(`/analytics/by-category?${qs}`),
  });

  const { data: topProducts = [], isLoading: productsLoading } = useQuery({
    queryKey: ["analytics-top-products", qs],
    queryFn: () => api<ProductSalesRow[]>(`/analytics/top-products?${qs}&limit=10`),
  });

  const { data: slowProducts = [], isLoading: slowLoading } = useQuery({
    queryKey: ["analytics-slow-products", qs],
    queryFn: () => api<ProductSalesRow[]>(`/analytics/slow-products?${qs}&limit=10`),
  });

  const { data: topShops = [], isLoading: shopsLoading } = useQuery({
    queryKey: ["analytics-top-shops", qs],
    queryFn: () => api<ShopSalesRow[]>(`/analytics/top-shops?${qs}&limit=10`),
  });

  const { data: quietShops = [], isLoading: quietLoading } = useQuery({
    queryKey: ["analytics-quiet-shops", qs],
    queryFn: () => api<QuietShopRow[]>(`/analytics/quiet-shops?${qs}&limit=15`),
  });

  const dailyChart = daily.map((d) => ({
    ...d,
    label: format(new Date(d.date + "T00:00:00"), "MMM d"),
  }));

  const categoryChart = categories.slice(0, 8).map((c) => ({
    name: c.category.length > 18 ? `${c.category.slice(0, 16)}…` : c.category,
    fullName: c.category,
    revenue: Number(c.total_revenue) || 0,
  }));

  const moneyTotal =
    (moneyMix?.paid_amount ?? 0) +
      (moneyMix?.partial_outstanding ?? 0) +
      (moneyMix?.unpaid_amount ?? 0) || 1;
  const paidPct = ((moneyMix?.paid_amount ?? 0) / moneyTotal) * 100;
  const partialPct = ((moneyMix?.partial_outstanding ?? 0) / moneyTotal) * 100;
  const unpaidPct = ((moneyMix?.unpaid_amount ?? 0) / moneyTotal) * 100;

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const summary = [
      { Metric: "Period Start", Value: format(from, "yyyy-MM-dd") },
      { Metric: "Period End", Value: format(to, "yyyy-MM-dd") },
      { Metric: "Invoices", Value: overview?.invoice_count ?? 0 },
      { Metric: "Revenue", Value: overview?.revenue ?? 0 },
      { Metric: "Collected", Value: overview?.collected ?? 0 },
      { Metric: "Outstanding", Value: overview?.outstanding ?? 0 },
      { Metric: "Collection Rate %", Value: overview?.collection_rate ?? 0 },
      { Metric: "Units Sold", Value: overview?.units_sold ?? 0 },
      { Metric: "Unique Shops", Value: overview?.unique_shops ?? 0 },
      { Metric: "Avg Invoice", Value: overview?.average_invoice ?? 0 },
      { Metric: "Revenue Δ % vs prior", Value: compare?.revenue_delta_pct ?? "" },
      { Metric: "Collected Δ % vs prior", Value: compare?.collected_delta_pct ?? "" },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Overview");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          Paid: moneyMix?.paid_amount ?? 0,
          Partial_Outstanding: moneyMix?.partial_outstanding ?? 0,
          Unpaid: moneyMix?.unpaid_amount ?? 0,
          Outstanding_Total: moneyMix?.outstanding ?? 0,
        },
      ]),
      "Money Mix"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        daily.map((d) => ({
          Date: d.date,
          Invoices: d.invoice_count,
          Revenue: d.revenue,
          Collected: d.collected,
        }))
      ),
      "Daily"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        categories.map((c) => ({
          Category: c.category,
          Quantity: c.total_quantity,
          Revenue: c.total_revenue,
        }))
      ),
      "By Category"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        topProducts.map((p, i) => ({
          Rank: i + 1,
          Product: p.product_name,
          Quantity: p.total_quantity,
          Revenue: p.total_revenue,
        }))
      ),
      "Top Products"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        slowProducts.map((p, i) => ({
          Rank: i + 1,
          Product: p.product_name,
          Quantity: p.total_quantity,
          Revenue: p.total_revenue,
        }))
      ),
      "Slow Products"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        topShops.map((s, i) => ({
          Rank: i + 1,
          Shop: s.shop_name,
          Invoices: s.invoice_count,
          Revenue: s.total_revenue,
        }))
      ),
      "Top Shops"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        quietShops.map((s) => ({
          Shop: s.shop_name,
          Prior_Invoices: s.prior_invoice_count,
          Prior_Revenue: s.prior_revenue,
          Last_Invoice: s.last_invoice_at || "",
        }))
      ),
      "Quiet Shops"
    );
    XLSX.writeFile(
      wb,
      `analytics_${format(from, "yyyy-MM-dd")}_to_${format(to, "yyyy-MM-dd")}.xlsx`
    );
  };

  return (
    <div className="space-y-6">
      <PageHero
        icon={BarChart3}
        title="Analytics"
        description={`${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")} · compared to prior period`}
        stats={[
          {
            label: "Revenue",
            value: overviewLoading ? "…" : `$${(overview?.revenue ?? 0).toFixed(0)}`,
            accent: true,
          },
          {
            label: "Outstanding",
            value: overviewLoading ? "…" : `$${(overview?.outstanding ?? 0).toFixed(0)}`,
          },
          {
            label: "Collected",
            value: overviewLoading ? "…" : `${(overview?.collection_rate ?? 0).toFixed(0)}%`,
          },
        ]}
        action={
          <Button
            variant="outline"
            className="h-11 w-full border-primary/30 sm:w-auto"
            onClick={exportExcel}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Excel
          </Button>
        }
      />

      <FilterChips
        value={preset}
        onChange={(id) => setPreset(id as DatePreset)}
        items={PRESETS.map((p) => ({ id: p.id, label: p.label }))}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatsCard
          title="Revenue"
          value={overviewLoading ? "…" : `$${(overview?.revenue ?? 0).toFixed(2)}`}
          icon={DollarSign}
          accent
          trend={trendFromDelta(compare?.revenue_delta_pct)}
        />
        <StatsCard
          title="Collected"
          value={overviewLoading ? "…" : `$${(overview?.collected ?? 0).toFixed(2)}`}
          icon={DollarSign}
          trend={trendFromDelta(compare?.collected_delta_pct)}
        />
        <StatsCard
          title="Outstanding"
          value={overviewLoading ? "…" : `$${(overview?.outstanding ?? 0).toFixed(2)}`}
          icon={AlertTriangle}
          trend={trendFromDelta(compare?.outstanding_delta_pct, true)}
        />
        <StatsCard
          title="Collection rate"
          value={overviewLoading ? "…" : `${(overview?.collection_rate ?? 0).toFixed(1)}%`}
          icon={Percent}
          description={
            compare?.collection_rate_delta_pp != null
              ? `${compare.collection_rate_delta_pp >= 0 ? "+" : ""}${compare.collection_rate_delta_pp.toFixed(1)} pp vs prior`
              : undefined
          }
        />
        <StatsCard
          title="Invoices"
          value={overviewLoading ? "…" : String(overview?.invoice_count ?? 0)}
          icon={FileText}
          trend={trendFromDelta(compare?.invoice_count_delta_pct)}
        />
        <StatsCard
          title="Units sold"
          value={overviewLoading ? "…" : String(overview?.units_sold ?? 0)}
          icon={Package}
          trend={trendFromDelta(compare?.units_sold_delta_pct)}
        />
      </div>

      <Card className="border-primary/10">
        <CardHeader>
          <CardTitle className="text-base">Daily revenue &amp; collections</CardTitle>
        </CardHeader>
        <CardContent className="h-[320px]">
          {dailyLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : dailyChart.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No activity in this period"
              description="Try a wider date range"
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyChart}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" name="Revenue" fill="#D95D4E" radius={[4, 4, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="collected"
                  name="Collected"
                  stroke="#1F2937"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-primary/10">
        <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.07] to-transparent pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4 text-primary" />
            Money health (invoice dollars)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {moneyLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                <div className="bg-primary" style={{ width: `${paidPct}%` }} />
                <div className="bg-primary/45" style={{ width: `${partialPct}%` }} />
                <div className="bg-muted-foreground/35" style={{ width: `${unpaidPct}%` }} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Paid</p>
                  <p className="font-semibold tabular-nums text-primary">
                    ${(moneyMix?.paid_amount ?? 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">{moneyMix?.paid_count ?? 0} invoices</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Partial left</p>
                  <p className="font-semibold tabular-nums">
                    ${(moneyMix?.partial_outstanding ?? 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">{moneyMix?.partial_count ?? 0} invoices</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unpaid</p>
                  <p className="font-semibold tabular-nums">
                    ${(moneyMix?.unpaid_amount ?? 0).toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">{moneyMix?.unpaid_count ?? 0} invoices</p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-base">Revenue by category</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {catLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : categoryChart.length === 0 ? (
              <p className="text-sm text-muted-foreground">No category sales</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChart} layout="vertical" margin={{ left: 8, right: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, _n, item) => [
                      `$${Number(value).toFixed(2)}`,
                      (item?.payload as { fullName?: string })?.fullName || "Revenue",
                    ]}
                  />
                  <Bar dataKey="revenue" fill="#D95D4E" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Unique shops · Avg invoice
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Shops sold to</p>
              <p className="text-2xl font-bold tabular-nums">{overview?.unique_shops ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avg invoice</p>
              <p className="text-2xl font-bold tabular-nums">
                ${(overview?.average_invoice ?? 0).toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="text-base">Top products</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {productsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No product sales</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProducts.map((p) => (
                    <TableRow key={p.product_name}>
                      <TableCell className="font-medium">{p.product_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.total_quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${p.total_revenue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-primary" />
              Slow movers
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {slowLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : slowProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No product sales</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slowProducts.map((p) => (
                    <TableRow key={`slow-${p.product_name}`}>
                      <TableCell className="font-medium">{p.product_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.total_quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${p.total_revenue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="text-base">Top shops</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {shopsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : topShops.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shop sales</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topShops.map((s) => (
                    <TableRow key={s.shop_name}>
                      <TableCell className="font-medium">{s.shop_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.invoice_count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${s.total_revenue.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-primary" />
              Quiet shops
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Ordered in the prior period, no invoices this period.
            </p>
            {quietLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : quietShops.length === 0 ? (
              <p className="text-sm text-muted-foreground">No quiet shops — nice coverage</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shop</TableHead>
                    <TableHead className="text-right">Prior $</TableHead>
                    <TableHead className="text-right">Prior #</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quietShops.map((s) => (
                    <TableRow key={s.shop_id}>
                      <TableCell className="font-medium">{s.shop_name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${s.prior_revenue.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.prior_invoice_count}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductAnalytics;
