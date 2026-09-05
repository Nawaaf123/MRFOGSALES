import { useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingBag, FileText, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { icon: LayoutDashboard, label: "Home", path: "/dashboard" },
  { icon: ShoppingBag, label: "Shops", path: "/shops" },
  { icon: FileText, label: "Invoices", path: "/invoices" },
  { icon: Package, label: "Products", path: "/products" },
];

export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

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
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors touch-manipulation",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className={cn("h-5 w-5", active && "stroke-[2.5px]")} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
