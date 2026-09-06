import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeroStat = {
  label: string;
  value: string | number;
  accent?: boolean;
};

type PageHeroProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  stats?: PageHeroStat[];
  className?: string;
};

export function PageHero({
  icon: Icon,
  title,
  description,
  action,
  stats,
  className,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-primary/15",
        "bg-gradient-to-br from-primary/[0.12] via-white to-white",
        "px-4 py-5 sm:px-6 sm:py-6",
        className
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-16 right-16 h-36 w-36 rounded-full bg-primary/10 blur-2xl"
      />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            {description && (
              <p className="mt-1 max-w-lg text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div
          className={cn(
            "relative mt-5 grid gap-3",
            stats.length === 1 && "sm:max-w-xs",
            stats.length === 2 && "grid-cols-2 sm:max-w-md",
            stats.length >= 3 && "grid-cols-2 sm:grid-cols-3 sm:max-w-2xl"
          )}
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={cn(
                "rounded-xl border bg-white/80 px-3 py-3 backdrop-blur-sm",
                stat.accent ? "border-primary/15" : "border-border"
              )}
            >
              <p
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  stat.accent ? "text-primary" : "text-muted-foreground"
                )}
              >
                {stat.label}
              </p>
              <p className="mt-1 truncate text-2xl font-bold tabular-nums text-foreground">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
