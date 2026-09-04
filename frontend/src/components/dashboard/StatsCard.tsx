import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  href?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export const StatsCard = ({ title, value, icon: Icon, description, href, trend }: StatsCardProps) => {
  const navigate = useNavigate();

  return (
    <Card
      className={href ? "cursor-pointer transition-colors hover:bg-accent/50" : ""}
      onClick={href ? () => navigate(href) : undefined}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
        <CardTitle className="text-xs md:text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className="text-xl md:text-2xl font-bold truncate">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 hidden sm:block">{description}</p>
        )}
        {trend && (
          <p className={`text-xs mt-1 ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% from last month
          </p>
        )}
      </CardContent>
    </Card>
  );
};
