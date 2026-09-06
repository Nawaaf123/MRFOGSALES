import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  href?: string;
  accent?: boolean;
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
}

export const StatsCard = ({
  title,
  value,
  icon: Icon,
  description,
  href,
  accent,
  trend,
}: StatsCardProps) => {
  const navigate = useNavigate();

  return (
    <Card
      className={cn(
        "border-primary/10 transition-all duration-200",
        href && "cursor-pointer hover:border-primary/35 hover:shadow-md hover:shadow-primary/10",
        accent && "border-primary/25 bg-gradient-to-br from-primary/[0.06] to-transparent"
      )}
      onClick={href ? () => navigate(href) : undefined}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-2 md:p-5 md:pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground md:text-sm">
          {title}
        </CardTitle>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            accent ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-5 md:pt-0">
        <div className="truncate text-xl font-bold tabular-nums md:text-2xl">{value}</div>
        {description && (
          <p className="mt-1 hidden text-xs text-muted-foreground sm:block">{description}</p>
        )}
        {trend && (
          <p
            className={cn(
              "mt-1 text-xs",
              trend.isPositive ? "text-primary" : "text-destructive"
            )}
          >
            {trend.isPositive ? "↑" : "↓"} {Math.abs(trend.value).toFixed(0)}%{" "}
            {trend.label || "vs prior period"}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
