import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Package, ShoppingBag, FileText, Users, LayoutDashboard, BarChart3, TrendingUp, Menu, LifeBuoy } from "lucide-react";
import mrFogLogo from "@/assets/mr-fog-logo.jpg";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { LocationTracker } from "@/components/location/LocationTracker";
import { AiChatDrawer } from "@/components/ai/AiChatDrawer";
import { InvoiceSyncRunner } from "@/lib/invoiceSyncRunner";

export const DashboardLayout = ({ children }: { children?: React.ReactNode }) => {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const userRole = user?.role || null;
  const isSalesLike = userRole === "sales" || userRole === "srour";

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const allNavItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" },
    { icon: Package, label: "Products", path: "/products" },
    { icon: BarChart3, label: "Analytics", path: "/analytics", adminOnly: true },
    { icon: ShoppingBag, label: "Shops", path: "/shops" },
    { icon: FileText, label: "Invoices", path: "/invoices" },
    { icon: LifeBuoy, label: "Support", path: "/support" },
    { icon: TrendingUp, label: "Sales Performance", path: "/sales-performance", adminOnly: true },
    { icon: Users, label: "Users", path: "/users", adminOnly: true },
  ];

  const navItems = allNavItems.filter((item) => !item.adminOnly || userRole === "admin");

  const handleNavigation = (path: string) => {
    navigate(path);
    setMobileMenuOpen(false);
  };

  const isActiveRoute = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background safe-area-inset">
      <InvoiceSyncRunner />
      {isSalesLike && <LocationTracker />}
      <header className="border-b bg-card/95 backdrop-blur sticky top-0 z-50 supports-[backdrop-filter]:bg-card/90">
        <div className="container mx-auto flex h-14 md:h-16 items-center justify-between px-3 sm:px-4">
          <div className="flex items-center gap-2 md:gap-8 min-w-0">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 touch-target">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(100vw-3rem,20rem)] p-0">
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-3 p-4 border-b">
                    <img src={mrFogLogo} alt="MR FOG" className="h-8 object-contain" />
                    <span className="text-sm font-medium text-muted-foreground">Sales Manager</span>
                  </div>
                  <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {navItems.map((item) => (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNavigation(item.path)}
                        className={cn(
                          "flex items-center gap-3 w-full px-3 py-3.5 text-sm rounded-lg transition-colors touch-target",
                          isActiveRoute(item.path)
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-5 w-5 shrink-0" />
                        {item.label}
                      </button>
                    ))}
                  </nav>
                  <div className="p-4 border-t safe-area-inset">
                    <p className="text-xs text-muted-foreground mb-3 truncate">{user?.email}</p>
                    <Button variant="outline" className="w-full h-11" onClick={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <div
              className="flex items-center gap-2 min-w-0 cursor-pointer"
              onClick={() => navigate("/dashboard")}
            >
              <img src={mrFogLogo} alt="MR FOG" className="h-8 md:h-10 object-contain shrink-0" />
              <span className="hidden sm:inline text-sm font-medium text-muted-foreground truncate">
                Sales Manager
              </span>
            </div>

            <nav className="hidden md:flex items-center gap-1 flex-wrap">
              {navItems.map((item) => (
                <Button
                  key={item.path}
                  variant={isActiveRoute(item.path) ? "default" : "ghost"}
                  size="sm"
                  onClick={() => handleNavigation(item.path)}
                  className={cn("gap-2", isActiveRoute(item.path) && "shadow-sm shadow-primary/25")}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Button>
              ))}
            </nav>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <span className="text-sm text-muted-foreground truncate max-w-[180px]">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-3 py-4 sm:px-4 md:p-6 pb-24 md:pb-6">
        {children ?? <Outlet />}
      </main>
      <MobileBottomNav />
      <AiChatDrawer />
    </div>
  );
};
