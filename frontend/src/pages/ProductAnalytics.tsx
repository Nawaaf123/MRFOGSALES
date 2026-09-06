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
  Cell,
  Legend,
  Pie,
  PieChart,
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
import { api } from "@/lib/api";
import {
  BarChart3,
  DollarSign,
  Download,
  FileText,
  Package,
  Percent,
  ShoppingBag,
} from "lucide-react";

type DatePreset = "7d" | "30d" | "90d" | "month" | "year";

type Overview = {
  invoice_count: number;
  revenue: number;
  discounts: number;
  collected: number;
  collection_rate: number;
  paid_count: number;
  unpaid_count: number;
  partial_count: number;
  unique_shops: number;
  units_sold: number;
  average_invoice: number;
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

type CategorySalesRow = {
  category: string;
  total_quantity: number;
  total_revenue: number;
};

type DailySalesRow = {
  date: string;
  invoice_count: number;
  revenue: number;
};

const PIE_COLORS = ["#D95D4E", "#1F2937", "#94A3B8", "#F07164", "#64748B", "#B91C1C", "#CBD5E1", "#7F1D1D"];

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

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics-overview", qs],
    queryFn: () => api<Overview>(`/analytics/overview?${qs}`),
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
    queryFn: () => api<ProductSalesRow[]>(`/analytics/top-products?${qs}&limit=15`),
  });

  const { data: topShops = [], isLoading: shopsLoading } = useQuery({
    queryKey: ["analytics-top-shops", qs],
    queryFn: () => api<ShopSalesRow[]>(`/analytics/top-shops?${qs}&limit=15`),
  });

  const dailyChart = daily.map((d) => ({
    ...d,
    label: format(new Date(d.date + "T00:00:00"), "MMM d"),
  }));

  const categoryChart = categories.map((c) => ({
    name: c.category,
    value: Number(c.total_revenue) || 0,
  }));

  const paymentTotal =
    (overview?.paid_count ?? 0) + (overview?.partial_count ?? 0) + (overview?.unpaid_count ?? 0) || 1;
  const paidPct = ((overview?.paid_count ?? 0) / paymentTotal) * 100;
  const partialPct = ((overview?.partial_count ?? 0) / paymentTotal) * 100;
  const unpaidPct = ((overview?.unpaid_count ?? 0) / paymentTotal) * 100;

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const summary = [
      { Metric: "Period Start", Value: format(from, "yyyy-MM-dd") },
      { Metric: "Period End", Value: format(to, "yyyy-MM-dd") },
      { Metric: "Invoices", Value: overview?.invoice_count ?? 0 },
      { Metric: "Revenue", Value: overview?.revenue ?? 0 },
      { Metric: "Collected", Value: overview?.collected ?? 0 },
      { Metric: "Collection Rate %", Value: overview?.collection_rate ?? 0 },
      { Metric: "Units Sold", Value: overview?.units_sold ?? 0 },
      { Metric: "Unique Shops", Value: overview?.unique_shops ?? 0 },
      { Metric: "Avg Invoice", Value: overview?.average_invoice ?? 0 },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Overview");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        daily.map((d) => ({
          Date: d.date,
          Invoices: d.invoice_count,
          Revenue: d.revenue,
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
        topShops.map((s, i) => ({
          Rank: i + 1,
          Shop: s.shop_name,
          Invoices: s.invoice_count,
          Revenue: s.total_revenue,
        }))
      ),
      "Top Shops"
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
        title="Product Analytics"
        description={`${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`}
        stats={[
          {
            label: "Revenue",
            value: overviewLoading ? "…" : `$${(overview?.revenue ?? 0).toFixed(0)}`,
            accent: true,
          },
          {
            label: "Invoices",
            value: overviewLoading ? "…" : String(overview?.invoice_count ?? 0),
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Units sold"
          value={overviewLoading ? "…" : String(overview?.units_sold ?? 0)}
          icon={Package}
        />
        <StatsCard
          title="Unique shops"
          value={overviewLoading ? "…" : String(overview?.unique_shops ?? 0)}
          icon={ShoppingBag}
        />
        <StatsCard
          title="Avg invoice"
          value={overviewLoading ? "…" : `$${(overview?.average_invoice ?? 0).toFixed(2)}`}
          icon={FileText}
        />
        <StatsCard
          title="Collected $"
          value={overviewLoading ? "…" : `$${(overview?.collected ?? 0).toFixed(2)}`}
          icon={DollarSign}
          accent
        />
      </div>

      <Card className="overflow-hidden border-primary/10">
        <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.07] to-transparent pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Percent className="h-4 w-4 text-primary" />
            Payment mix
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            <div className="bg-primary" style={{ width: `${paidPct}%` }} />
            <div className="bg-primary/45" style={{ width: `${partialPct}%` }} />
            <div className="bg-muted-foreground/35" style={{ width: `${unpaidPct}%` }} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-primary">{overview?.paid_count ?? 0}</span> paid
            </span>
            <span>
              <span className="font-semibold text-foreground">{overview?.partial_count ?? 0}</span> partial
            </span>
            <span>
              <span className="font-semibold text-foreground">{overview?.unpaid_count ?? 0}</span> unpaid
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-base">Daily revenue</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {dailyLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#D95D4E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-primary/10">
          <CardHeader>
            <CardTitle className="text-base">Revenue by category</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {catLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChart}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={2}
                  >
                    {categoryChart.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
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
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProducts.map((p, i) => (
                      <TableRow key={`${p.product_name}-${i}`}>
                        <TableCell>
                          <span
                            className={
                              i < 3
                                ? "inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary"
                                : "text-muted-foreground"
                            }
                          >
                            {i + 1}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{p.product_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.total_quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${Number(p.total_revenue).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10">
          <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.05] to-transparent">
            <CardTitle className="text-base">Top shops</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {shopsLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topShops.map((s, i) => (
                      <TableRow key={`${s.shop_name}-${i}`}>
                        <TableCell>
                          <span
                            className={
                              i < 3
                                ? "inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary"
                                : "text-muted-foreground"
                            }
                          >
                            {i + 1}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{s.shop_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.invoice_count}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          ${Number(s.total_revenue).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductAnalytics;
