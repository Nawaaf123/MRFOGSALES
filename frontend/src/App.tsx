import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { InstallPromptBanner } from "@/components/InstallPromptBanner";
import { DashboardLayout } from "@/components/DashboardLayout";

// Eager: sales day-to-day paths
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Shops from "./pages/Shops";
import Invoices from "./pages/Invoices";
import NotFound from "./pages/NotFound";

// Lazy: heavier admin pages
const ProductAnalytics = lazy(() => import("./pages/ProductAnalytics"));
const Users = lazy(() => import("./pages/Users"));
const SalesPerformance = lazy(() => import("./pages/SalesPerformance"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const AdminPageFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
    Loading…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <InstallPromptBanner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/shops" element={<Shops />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route
                path="/analytics"
                element={
                  <Suspense fallback={<AdminPageFallback />}>
                    <ProductAnalytics />
                  </Suspense>
                }
              />
              <Route
                path="/users"
                element={
                  <Suspense fallback={<AdminPageFallback />}>
                    <Users />
                  </Suspense>
                }
              />
              <Route
                path="/sales-performance"
                element={
                  <Suspense fallback={<AdminPageFallback />}>
                    <SalesPerformance />
                  </Suspense>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
