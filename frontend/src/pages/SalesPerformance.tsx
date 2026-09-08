import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { StatsCard } from "@/components/dashboard/StatsCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DollarSign, FileText, TrendingUp, Users } from "lucide-react";

type Period = "all" | "today" | "week" | "month" | "custom";

type SalesPersonRow = {
  user_id: string;
  full_name: string;
  email: string;
  invoice_count: number;
  total_revenue: number;
  unique_shops: number;
  average_invoice: number;
  commission: number;
};

function rangeForPeriod(
  period: Period,
  customFrom: string,
  customTo: string
): { from: Date; to: Date } | null {
  const now = new Date();
  switch (period) {
    case "all":
      return { from: new Date("2020-01-01T00:00:00"), to: endOfDay(now) };
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "week":
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "custom": {
      if (!customFrom || !customTo) return null;
      const from = startOfDay(new Date(customFrom + "T00:00:00"));
      const to = endOfDay(new Date(customTo + "T00:00:00"));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
      return { from, to };
    }
  }
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

const SalesPerformance = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("all");
  const [commissionRate, setCommissionRate] = useState("10");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(
    () => rangeForPeriod(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const rate = Math.min(100, Math.max(0, Number(commissionRate) || 0));

  const qs = useMemo(() => {
    if (!range) return null;
    const params = new URLSearchParams({
      date_from: range.from.toISOString(),
      date_to: range.to.toISOString(),
      commission_rate: String(rate),
    });
    return params.toString();
  }, [range, rate]);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sales-performance", qs],
    queryFn: () => api<SalesPersonRow[]>(`/analytics/sales-performance?${qs}`),
    enabled: !!qs && user?.role === "admin",
  });

  if (user && user.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const totals = rows.reduce(
    (acc, row) => ({
      invoices: acc.invoices + row.invoice_count,
      revenue: acc.revenue + Number(row.total_revenue),
      commission: acc.commission + Number(row.commission),
    }),
    { invoices: 0, revenue: 0, commission: 0 }
  );

  return (
    <div className="space-y-6">
      <PageHero
        icon={TrendingUp}
        title="Sales Performance"
        description={
          range
            ? period === "all"
              ? `All time · ${rate}% commission`
              : `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")} · ${rate}% commission`
            : "Pick a period to rank salesperson revenue and commission"
        }
        stats={[
          { label: "Revenue", value: `$${totals.revenue.toFixed(0)}`, accent: true },
          { label: "Invoices", value: totals.invoices },
          { label: "Commission", value: `$${totals.commission.toFixed(0)}` },
        ]}
      />

      <FilterChips
        value={period}
        onChange={(id) => setPeriod(id as Period)}
        items={PERIODS.map((p) => ({ id: p.id, label: p.label }))}
      />

      <div className="rounded-xl border border-primary/10 bg-card p-4">
        {period === "custom" && (
          <div className="mb-4 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>From</Label>
              <Input
                type="date"
                className="h-11"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Input
                type="date"
                className="h-11"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="max-w-xs space-y-2">
          <Label>Commission rate (%)</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            className="h-11"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatsCard title="Team revenue" value={`$${totals.revenue.toFixed(2)}`} icon={DollarSign} accent />
        <StatsCard title="Invoices" value={totals.invoices} icon={FileText} />
        <StatsCard title="Commission" value={`$${totals.commission.toFixed(2)}`} icon={TrendingUp} />
      </div>

      {!qs ? (
        <EmptyState
          icon={Users}
          title="Select a date range"
          description="Choose custom From and To dates to load performance"
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {isLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon={Users} title="No salespeople found" />
            ) : (
              rows.map((row, i) => (
                <article
                  key={row.user_id}
                  className={cn(
                    "relative overflow-hidden rounded-xl border bg-card p-4 pl-5",
                    i < 3 ? "border-primary/25" : "border-border"
                  )}
                >
                  <div className={cn("absolute inset-y-0 left-0 w-1", i < 3 ? "bg-primary" : "bg-muted")} />
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {i < 3 && (
                          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary">
                            {i + 1}
                          </span>
                        )}
                        {row.full_name}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.email}</p>
                    </div>
                    <p className="text-lg font-bold tabular-nums text-primary">
                      ${Number(row.total_revenue).toFixed(0)}
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="font-semibold text-foreground">{row.invoice_count}</p>
                      Invoices
                    </div>
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="font-semibold text-foreground">{row.unique_shops}</p>
                      Shops
                    </div>
                    <div className="rounded-lg bg-muted/60 py-2">
                      <p className="font-semibold text-foreground">
                        ${Number(row.commission).toFixed(0)}
                      </p>
                      Comm.
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          <Card className="hidden overflow-hidden border-primary/10 md:block">
            <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.07] to-transparent">
              <CardTitle className="text-base">Salespeople</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Shops</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Avg Invoice</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8}>Loading…</TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8}>No salespeople found</TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {rows.map((row, i) => (
                          <TableRow key={row.user_id}>
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
                            <TableCell className="font-medium">{row.full_name}</TableCell>
                            <TableCell>{row.email}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.invoice_count}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.unique_shops}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              ${Number(row.total_revenue).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              ${Number(row.average_invoice).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium text-primary">
                              ${Number(row.commission).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-semibold">
                          <TableCell colSpan={3}>Total</TableCell>
                          <TableCell className="text-right">{totals.invoices}</TableCell>
                          <TableCell />
                          <TableCell className="text-right">${totals.revenue.toFixed(2)}</TableCell>
                          <TableCell />
                          <TableCell className="text-right text-primary">
                            ${totals.commission.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default SalesPerformance;
