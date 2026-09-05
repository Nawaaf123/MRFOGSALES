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
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { Navigate } from "react-router-dom";

type Period = "today" | "week" | "month" | "custom";

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
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

const SalesPerformance = () => {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
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
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Sales Performance</h1>
          <p className="text-muted-foreground">
            Salesperson revenue and commission for the selected period
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={period === p.id ? "default" : "outline"}
                  onClick={() => setPeriod(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            {period === "custom" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    type="date"
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
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
              />
            </div>

            {range && (
              <p className="text-sm text-muted-foreground">
                {format(range.from, "MMM d, yyyy")} – {format(range.to, "MMM d, yyyy")} ·{" "}
                {rate}% commission
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salespeople</CardTitle>
          </CardHeader>
          <CardContent>
            {!qs ? (
              <p className="text-sm text-muted-foreground">Select a valid custom date range</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                        <TableCell colSpan={7}>Loading...</TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>No salespeople found</TableCell>
                      </TableRow>
                    ) : (
                      <>
                        {rows.map((row) => (
                          <TableRow key={row.user_id}>
                            <TableCell className="font-medium">{row.full_name}</TableCell>
                            <TableCell>{row.email}</TableCell>
                            <TableCell className="text-right">{row.invoice_count}</TableCell>
                            <TableCell className="text-right">{row.unique_shops}</TableCell>
                            <TableCell className="text-right">
                              ${Number(row.total_revenue).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              ${Number(row.average_invoice).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              ${Number(row.commission).toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-muted/50 font-semibold">
                          <TableCell colSpan={2}>Total</TableCell>
                          <TableCell className="text-right">{totals.invoices}</TableCell>
                          <TableCell />
                          <TableCell className="text-right">
                            ${totals.revenue.toFixed(2)}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right">
                            ${totals.commission.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default SalesPerformance;
