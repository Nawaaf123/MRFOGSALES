import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ProductAnalytics = () => (
  <DashboardLayout>
    <Card>
      <CardHeader>
        <CardTitle>Product Analytics</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        API foundation is ready. Full charts/export UI from the Lovable app will be ported onto
        FastAPI aggregation endpoints next.
      </CardContent>
    </Card>
  </DashboardLayout>
);

export default ProductAnalytics;
