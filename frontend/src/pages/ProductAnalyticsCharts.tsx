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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";

type DailyPoint = { label: string; revenue: number; collected: number };
type CategoryPoint = { name: string; fullName: string; revenue: number };

type ProductAnalyticsChartsProps = {
  dailyChart: DailyPoint[];
  dailyLoading: boolean;
  categoryChart: CategoryPoint[];
  catLoading: boolean;
};

export default function ProductAnalyticsCharts({
  dailyChart,
  dailyLoading,
  categoryChart,
  catLoading,
}: ProductAnalyticsChartsProps) {
  return (
    <>
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
    </>
  );
}
