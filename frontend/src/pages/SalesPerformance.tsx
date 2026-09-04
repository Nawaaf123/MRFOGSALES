import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SalesPerformance = () => (
  <DashboardLayout>
    <Card>
      <CardHeader>
        <CardTitle>Sales Performance</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Placeholder page. Performance reports will use server-side SQL aggregates instead of
        client-side invoice scans.
      </CardContent>
    </Card>
  </DashboardLayout>
);

export default SalesPerformance;
