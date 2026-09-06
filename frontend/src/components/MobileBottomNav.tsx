import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, ShoppingBag, FileText, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const items = [
  { icon: LayoutDashboard, label: "Home", path: "/dashboard", prefetch: "dashboard" as const },
  { icon: ShoppingBag, label: "Shops", path: "/shops", prefetch: "shops" as const },
  { icon: FileText, label: "Invoices", path: "/invoices", prefetch: "invoices" as const },
  { icon: Package, label: "Products", path: "/products", prefetch: "products" as const },
];

export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const prefetch = (kind: (typeof items)[number]["prefetch"]) => {
    if (kind === "dashboard") {
      void queryClient.prefetchQuery({
        queryKey: ["dashboard-stats"],
        queryFn: () => api("/dashboard/stats"),
      });
      void queryClient.prefetchQuery({
        queryKey: ["pending-payments"],
        queryFn: () => api("/dashboard/pending-payments"),
      });
    } else if (kind === "shops") {
      void queryClient.prefetchQuery({
        queryKey: ["shops", "include_frozen", "prefetch"],
        queryFn: () =>
          api("/shops?include_frozen=true&page=1&page_size=50"),
      });
    } else if (kind === "invoices") {
      void queryClient.prefetchQuery({
        queryKey: ["invoices", "?page=1&page_size=50"],
        queryFn: () => api("/invoices?page=1&page_size=50"),
      });
      void queryClient.prefetchQuery({
        queryKey: ["shops", "catalog"],
        queryFn: () => api("/shops?page=1&page_size=50"),
      });
    } else if (kind === "products") {
      void queryClient.prefetchQuery({
        queryKey: ["products", "prefetch"],
        queryFn: () => api("/products?page=1&page_size=1"),
      });
    }
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90 safe-area-inset"
      aria-label="Primary"
    >
      <div className="grid grid-cols-4 h-14 min-h-[3.5rem]">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              onPointerDown={() => prefetch(item.prefetch)}
              onClick={() => navigate(item.path)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors touch-manipulation",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              {active && (
                <span className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-primary" />
              )}
              <item.icon className={cn("h-5 w-5", active && "stroke-[2.5px]")} />
              <span className={cn(active && "font-semibold")}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
