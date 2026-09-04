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
import { DashboardLayout } from "@/components/DashboardLayout";
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
import { api } from "@/lib/api";
import {
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

const PIE_COLORS = ["#D95D4E", "#1F2937", "#64748B", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6", "#EC4899"];

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
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Product Analytics</h1>
            <p className="text-muted-foreground">
              {format(from, "MMM d, yyyy")} – {format(to, "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                size="sm"
                variant={preset === p.id ? "default" : "outline"}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={exportExcel}>
              <Download className="h-4 w-4 mr-2" />
              Export Excel
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Revenue"
            value={overviewLoading ? "..." : `$${(overview?.revenue ?? 0).toFixed(2)}`}
            icon={DollarSign}
          />
          <StatsCard
            title="Invoices"
            value={overviewLoading ? "..." : String(overview?.invoice_count ?? 0)}
            icon={FileText}
          />
          <StatsCard
            title="Units Sold"
            value={overviewLoading ? "..." : String(overview?.units_sold ?? 0)}
            icon={Package}
          />
          <StatsCard
            title="Collection Rate"
            value={overviewLoading ? "..." : `${(overview?.collection_rate ?? 0).toFixed(1)}%`}
            icon={Percent}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Collected"
            value={overviewLoading ? "..." : `$${(overview?.collected ?? 0).toFixed(2)}`}
            icon={DollarSign}
          />
          <StatsCard
            title="Unique Shops"
            value={overviewLoading ? "..." : String(overview?.unique_shops ?? 0)}
            icon={ShoppingBag}
          />
          <StatsCard
            title="Avg Invoice"
            value={overviewLoading ? "..." : `$${(overview?.average_invoice ?? 0).toFixed(2)}`}
            icon={FileText}
          />
          <StatsCard
            title="Paid / Partial / Unpaid"
            value={
              overviewLoading
                ? "..."
                : `${overview?.paid_count ?? 0} / ${overview?.partial_count ?? 0} / ${overview?.unpaid_count ?? 0}`
            }
            icon={FileText}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Revenue</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {dailyLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : dailyChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: number) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
                    />
                    <Bar dataKey="revenue" fill="#D95D4E" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue by Category</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
              {catLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : categoryChart.length === 0 ? (
                <p className="text-sm text-muted-foreground">No category data</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryChart}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, percent }) =>
                        `${name} (${((percent || 0) * 100).toFixed(0)}%)`
                      }
                    >
                      {categoryChart.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => `$${Number(value).toFixed(2)}`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productsLoading ? (
                      <TableRow>
                        <TableCell colSpan={4}>Loading...</TableCell>
                      </TableRow>
                    ) : topProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>No products sold</TableCell>
                      </TableRow>
                    ) : (
                      topProducts.map((p, i) => (
                        <TableRow key={`${p.product_name}-${i}`}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="font-medium">{p.product_name}</TableCell>
                          <TableCell className="text-right">{p.total_quantity}</TableCell>
                          <TableCell className="text-right">
                            ${Number(p.total_revenue).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Shops</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Shop</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shopsLoading ? (
                      <TableRow>
                        <TableCell colSpan={4}>Loading...</TableCell>
                      </TableRow>
                    ) : topShops.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4}>No shop sales</TableCell>
                      </TableRow>
                    ) : (
                      topShops.map((s, i) => (
                        <TableRow key={`${s.shop_name}-${i}`}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="font-medium">{s.shop_name}</TableCell>
                          <TableCell className="text-right">{s.invoice_count}</TableCell>
                          <TableCell className="text-right">
                            ${Number(s.total_revenue).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProductAnalytics;
