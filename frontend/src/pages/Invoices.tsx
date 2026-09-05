import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import {
  clearInvoiceCreateDraft,
  draftHasWork,
  isNetworkApiError,
  loadInvoiceCreateDraft,
  newClientRequestId,
  saveInvoiceCreateDraft,
  type InvoiceCreateDraft,
} from "@/lib/invoiceCreateDraft";
import { useToast } from "@/hooks/use-toast";
import { generateInvoicePDF, saveInvoicePDF } from "@/lib/pdfGenerator";
import { CreditDialog } from "@/components/invoices/CreditDialog";
import { DistributePaymentDialog } from "@/components/invoices/DistributePaymentDialog";
import { ShopInvoiceGroup } from "@/components/invoices/ShopInvoiceGroup";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Plus, Trash2 } from "lucide-react";

type Shop = {
  id: string;
  name: string;
  is_frozen?: boolean;
};

type Product = {
  id: string;
  name: string;
  sku?: string | null;
  price: number;
  is_active: boolean;
  category: string;
  subcategory?: string | null;
};

type UserProfile = {
  id: string;
  full_name: string;
};

type PaymentMethod = "cash" | "check" | "credit";
type PaymentStatus = "paid" | "partial" | "unpaid";

type InvoicePayment = {
  id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date: string;
};

type InvoiceItem = {
  id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type InvoiceShop = {
  id: string;
  name: string;
  owner_name?: string | null;
  street_address?: string | null;
  street_address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  phone?: string | null;
  email?: string | null;
};

type Invoice = {
  id: string;
  invoice_number: string;
  shop_id: string;
  created_by?: string | null;
  total_amount: number;
  discount_amount: number;
  payment_status: PaymentStatus;
  notes: string | null;
  warehouse: "A" | "B" | null;
  created_at: string;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
  shop: InvoiceShop | null;
  amount_paid: number;
};

function toPdfInvoice(invoice: Invoice) {
  const shop = invoice.shop;
  return {
    ...invoice,
    notes: invoice.notes || undefined,
    shops: shop
      ? {
          name: shop.name,
          owner_name: shop.owner_name || undefined,
          street_address: shop.street_address || undefined,
          street_address_line_2: shop.street_address_line_2 || undefined,
          city: shop.city || undefined,
          state: shop.state || undefined,
          zip_code: shop.zip_code || undefined,
          phone: shop.phone || undefined,
          email: shop.email || undefined,
        }
      : { name: "Unknown shop" },
  };
}

async function downloadInvoicePdf(invoice: Invoice) {
  const paid = Number(invoice.amount_paid || 0);
  const remaining = Math.max(0, Number(invoice.total_amount) - paid);
  await saveInvoicePDF(toPdfInvoice(invoice), paid, remaining);
}

function pdfDocToBase64(doc: { output: (type: string) => string }): string {
  const dataUri = doc.output("datauristring");
  const comma = dataUri.indexOf(",");
  return comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
}

type LineItemDraft = {
  product_id: string;
  product_name: string;
  product_sku?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

function skuSortKey(sku: string | null | undefined) {
  return (sku || "").trim().toLowerCase();
}

const statusBadgeVariant = (status: PaymentStatus): "default" | "secondary" | "destructive" => {
  if (status === "paid") return "default";
  if (status === "partial") return "secondary";
  return "destructive";
};

const Invoices = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canCreate = user?.role === "admin" || user?.role === "sales" || user?.role === "srour";
  const canPickWarehouse = user?.role === "admin" || user?.role === "srour";
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [shopFilter, setShopFilter] = useState("all");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const [createOpen, setCreateOpen] = useState(false);
  const clientRequestIdRef = useRef(newClientRequestId());
  const skipNextDraftPersistRef = useRef(false);
  const [shopId, setShopId] = useState("");
  const [notes, setNotes] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [warehouse, setWarehouse] = useState<"A" | "B">(user?.assigned_warehouse || "A");
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [createCategoryFilter, setCreateCategoryFilter] = useState("all");
  const [createSubcategoryFilter, setCreateSubcategoryFilter] = useState("all");
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [createSubcategoryOpen, setCreateSubcategoryOpen] = useState(false);
  const [cashAmount, setCashAmount] = useState("");
  const [checkAmount, setCheckAmount] = useState("");
  const [creditAmount, setCreditAmount] = useState("");

  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payCheckNumber, setPayCheckNumber] = useState("");
  const [payNotes, setPayNotes] = useState("");

  const [creditInvoice, setCreditInvoice] = useState<Invoice | null>(null);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [deleteInvoice, setDeleteInvoice] = useState<Invoice | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);

  const [distributeTarget, setDistributeTarget] = useState<{
    shopId: string;
    shopName: string;
    invoices: Invoice[];
    totalPending: number;
  } | null>(null);

  const invoiceQueryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("payment_status", statusFilter);
    if (shopFilter !== "all") params.set("shop_id", shopFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [debouncedSearch, statusFilter, shopFilter]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", invoiceQueryParams],
    queryFn: () => api<Invoice[]>(`/invoices${invoiceQueryParams}`),
  });

  const { data: shops = [] } = useQuery({
    queryKey: ["shops"],
    queryFn: () => api<Shop[]>("/shops"),
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products", "active", "brief"],
    queryFn: () => api<Product[]>("/products?active_only=true&brief=true"),
    enabled: createOpen,
  });

  const createCategories = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [products]);

  const createSubcategories = useMemo(() => {
    const pool =
      createCategoryFilter === "all"
        ? products
        : products.filter((p) => p.category === createCategoryFilter);
    return Array.from(
      new Set(pool.map((p) => p.subcategory).filter((s): s is string => Boolean(s)))
    ).sort((a, b) => a.localeCompare(b));
  }, [products, createCategoryFilter]);

  const canShowProductList =
    createCategoryFilter !== "all" || productSearch.trim().length >= 2;

  const filteredCreateProducts = useMemo(() => {
    if (!canShowProductList) return [];
    const q = productSearch.trim().toLowerCase();
    const rows = products.filter((p) => {
      if (createCategoryFilter !== "all" && p.category !== createCategoryFilter) return false;
      if (
        createSubcategoryFilter !== "all" &&
        (p.subcategory || "") !== createSubcategoryFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.subcategory || "").toLowerCase().includes(q)
      );
    });
    return [...rows].sort((a, b) => {
      const sa = skuSortKey(a.sku);
      const sb = skuSortKey(b.sku);
      if (!sa && !sb) return a.name.localeCompare(b.name);
      if (!sa) return 1;
      if (!sb) return -1;
      const cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  }, [
    products,
    productSearch,
    createCategoryFilter,
    createSubcategoryFilter,
    canShowProductList,
  ]);

  const itemQtyByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      map.set(item.product_id, (map.get(item.product_id) || 0) + item.quantity);
    }
    return map;
  }, [items]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["users", "profiles-for-invoices"],
    queryFn: () => api<UserProfile[]>("/users"),
    enabled: isAdmin,
  });

  const profilesForNames = useMemo(() => {
    if (isAdmin) return profiles;
    if (user) return [{ id: user.id, full_name: user.full_name }];
    return [];
  }, [isAdmin, profiles, user]);

  const shopGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        shopId: string;
        shopName: string;
        shopLocation: string;
        invoices: Invoice[];
      }
    >();

    for (const invoice of invoices) {
      const sid = invoice.shop_id || invoice.shop?.id || "unknown";
      const shop = invoice.shop;
      const location = shop
        ? [shop.street_address, shop.city, shop.state].filter(Boolean).join(", ") || "—"
        : "—";
      const existing = map.get(sid);
      if (existing) {
        existing.invoices.push(invoice);
      } else {
        map.set(sid, {
          shopId: sid,
          shopName: shop?.name || "Unknown shop",
          shopLocation: location,
          invoices: [invoice],
        });
      }
    }

    return Array.from(map.values())
      .map((g) => ({
        ...g,
        invoices: [...g.invoices].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
        pending: g.invoices.reduce(
          (sum, inv) =>
            sum + Math.max(0, Number(inv.total_amount) - Number(inv.amount_paid || 0)),
          0
        ),
      }))
      .sort((a, b) => b.pending - a.pending || a.shopName.localeCompare(b.shopName));
  }, [invoices]);

  const refetchInvoices = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["pending-payments"] });
  };

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Number(discountAmount) || 0;
  const totalAmount = Math.max(0, subtotal - discount);
  const createPaymentsTotal =
    (Number(cashAmount) || 0) + (Number(checkAmount) || 0) + (Number(creditAmount) || 0);

  const resetCreateForm = (opts?: { clearDraft?: boolean }) => {
    skipNextDraftPersistRef.current = true;
    clientRequestIdRef.current = newClientRequestId();
    setShopId("");
    setNotes("");
    setDiscountAmount("");
    setWarehouse(user?.assigned_warehouse || "A");
    setItems([]);
    setProductSearch("");
    setCreateCategoryFilter("all");
    setCreateSubcategoryFilter("all");
    setCashAmount("");
    setCheckAmount("");
    setCreditAmount("");
    if (opts?.clearDraft !== false && user?.id) {
      clearInvoiceCreateDraft(user.id);
    }
  };

  const applyDraft = (draft: InvoiceCreateDraft) => {
    skipNextDraftPersistRef.current = true;
    clientRequestIdRef.current = draft.client_request_id;
    setShopId(draft.shop_id || "");
    setNotes(draft.notes || "");
    setDiscountAmount(draft.discount_amount || "");
    setWarehouse(draft.warehouse === "B" ? "B" : "A");
    setItems(Array.isArray(draft.items) ? draft.items : []);
    setProductSearch("");
    setCreateCategoryFilter("all");
    setCreateSubcategoryFilter("all");
    setCashAmount(draft.cash_amount || "");
    setCheckAmount(draft.check_amount || "");
    setCreditAmount(draft.credit_amount || "");
  };

  const openCreateInvoice = () => {
    if (user?.id) {
      const draft = loadInvoiceCreateDraft(user.id);
      if (draftHasWork(draft)) {
        applyDraft(draft!);
        setCreateOpen(true);
        toast({
          title: "Draft restored",
          description: "Your unsaved invoice was loaded. Create when you’re back online.",
        });
        return;
      }
    }
    resetCreateForm({ clearDraft: true });
    setCreateOpen(true);
  };

  // Keep draft on device while sales build the invoice (survives refresh / weak signal).
  useEffect(() => {
    if (!user?.id) return;
    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false;
      return;
    }
    if (!createOpen && !shopId && items.length === 0 && !notes.trim()) return;

    const timer = window.setTimeout(() => {
      if (!user.id) return;
      const draft: InvoiceCreateDraft = {
        version: 1,
        client_request_id: clientRequestIdRef.current,
        shop_id: shopId,
        notes,
        discount_amount: discountAmount,
        warehouse,
        items,
        cash_amount: cashAmount,
        check_amount: checkAmount,
        credit_amount: creditAmount,
        updated_at: new Date().toISOString(),
      };
      if (draftHasWork(draft)) saveInvoiceCreateDraft(user.id, draft);
      else clearInvoiceCreateDraft(user.id);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    user?.id,
    createOpen,
    shopId,
    notes,
    discountAmount,
    warehouse,
    items,
    cashAmount,
    checkAmount,
    creditAmount,
  ]);

  const addProductQuick = (product: Product) => {
    setItems((prev) => {
      const existing = prev.findIndex((i) => i.product_id === product.id);
      if (existing >= 0) {
        const next = [...prev];
        const qty = next[existing].quantity + 1;
        next[existing] = {
          ...next[existing],
          quantity: qty,
          subtotal: qty * next[existing].unit_price,
        };
        return next;
      }
      const price = Number(product.price) || 0;
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku || null,
          quantity: 1,
          unit_price: price,
          subtotal: price,
        },
      ];
    });
  };

  const updateLine = (index: number, field: "quantity" | "unit_price", value: number) => {
    const next = [...items];
    const safe = Number.isFinite(value) && value >= 0 ? value : 0;
    next[index] = {
      ...next[index],
      [field]: field === "quantity" ? Math.max(1, Math.floor(safe) || 1) : safe,
    };
    next[index].subtotal = next[index].quantity * next[index].unit_price;
    setItems(next);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!shopId) throw { message: "Select a shop" } satisfies ApiError;
      if (items.length === 0) throw { message: "Add at least one product" } satisfies ApiError;
      if (createPaymentsTotal > totalAmount + 0.01) {
        throw { message: "Payments cannot exceed invoice total" } satisfies ApiError;
      }

      const payments: Array<{ amount: number; payment_method: PaymentMethod }> = [];
      const cash = Number(cashAmount) || 0;
      const check = Number(checkAmount) || 0;
      const credit = Number(creditAmount) || 0;
      if (cash > 0) payments.push({ amount: cash, payment_method: "cash" });
      if (check > 0) payments.push({ amount: check, payment_method: "check" });
      if (credit > 0) payments.push({ amount: credit, payment_method: "credit" });

      // Persist immediately before network call so a crash mid-request still restores.
      if (user?.id) {
        saveInvoiceCreateDraft(user.id, {
          version: 1,
          client_request_id: clientRequestIdRef.current,
          shop_id: shopId,
          notes,
          discount_amount: discountAmount,
          warehouse,
          items,
          cash_amount: cashAmount,
          check_amount: checkAmount,
          credit_amount: creditAmount,
          updated_at: new Date().toISOString(),
        });
      }

      const body = JSON.stringify({
        client_request_id: clientRequestIdRef.current,
        shop_id: shopId,
        items: items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
        })),
        discount_amount: discount,
        notes: notes.trim() || null,
        warehouse,
        payments,
      });

      const maxAttempts = 4;
      let lastError: ApiError = { message: "Create failed" };
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          return await api<Invoice>("/invoices", { method: "POST", body });
        } catch (err) {
          lastError = err as ApiError;
          if (!isNetworkApiError(lastError) || attempt === maxAttempts - 1) throw lastError;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      throw lastError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setCreateOpen(false);
      resetCreateForm({ clearDraft: true });
      toast({ title: "Invoice created" });
    },
    onError: (error: ApiError) => {
      if (isNetworkApiError(error)) {
        toast({
          title: "No network — draft saved",
          description: "Your invoice is kept on this phone. Tap Create again when you’re online (won’t double).",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: () => {
      if (!paymentInvoice) throw { message: "No invoice selected" } satisfies ApiError;
      const amount = Number(payAmount);
      const remaining = Math.max(
        0,
        Number(paymentInvoice.total_amount) - Number(paymentInvoice.amount_paid || 0)
      );
      if (!amount || amount <= 0) throw { message: "Enter a valid amount" } satisfies ApiError;
      if (amount > remaining + 0.01) {
        throw { message: "Amount cannot exceed remaining balance" } satisfies ApiError;
      }
      return api("/payments", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: paymentInvoice.id,
          amount,
          payment_method: payMethod,
          payment_date: new Date().toISOString().slice(0, 10),
          check_number: payMethod === "check" ? payCheckNumber.trim() || null : null,
          notes: payNotes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      refetchInvoices();
      setPaymentInvoice(null);
      setPayAmount("");
      setPayMethod("cash");
      setPayCheckNumber("");
      setPayNotes("");
      toast({ title: "Payment recorded" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (invoice: Invoice) =>
      api(`/invoices/${invoice.id}`, { method: "DELETE" }),
    onSuccess: () => {
      refetchInvoices();
      setDeleteInvoice(null);
      toast({ title: "Invoice deleted" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const remainingForPayment = paymentInvoice
    ? Math.max(0, Number(paymentInvoice.total_amount) - Number(paymentInvoice.amount_paid || 0))
    : 0;

  const creditRemaining = creditInvoice
    ? Math.max(0, Number(creditInvoice.total_amount) - Number(creditInvoice.amount_paid || 0))
    : 0;

  const openPayment = (invoice: Invoice) => {
    const remaining = Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid || 0));
    setPaymentInvoice(invoice);
    setPayAmount(remaining.toFixed(2));
    setPayMethod("cash");
    setPayCheckNumber("");
    setPayNotes("");
  };

  const exportPdf = async (invoice: Invoice) => {
    try {
      const full = await api<Invoice>(`/invoices/${invoice.id}`);
      await downloadInvoicePdf(full);
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as ApiError).message)
          : "Could not generate PDF";
      toast({ title: "PDF failed", description: message, variant: "destructive" });
    }
  };

  const emailInvoice = async (invoice: Invoice) => {
    setEmailingId(invoice.id);
    try {
      const full = await api<Invoice>(`/invoices/${invoice.id}`);
      let to = full.shop?.email?.trim() || "";
      if (!to) {
        const prompted = window.prompt(
          `No email on file for ${full.shop?.name || "this shop"}. Enter recipient email:`
        );
        if (!prompted?.trim()) {
          toast({ title: "Email cancelled", description: "No recipient email provided" });
          return;
        }
        to = prompted.trim();
      }

      const paid = Number(full.amount_paid || 0);
      const remaining = Math.max(0, Number(full.total_amount) - paid);
      const doc = await generateInvoicePDF(toPdfInvoice(full), paid, remaining);
      const pdf_base64 = pdfDocToBase64(doc);

      await api(`/invoices/${full.id}/email`, {
        method: "POST",
        body: JSON.stringify({ to, pdf_base64 }),
      });

      toast({
        title: "Invoice emailed",
        description: `Sent to ${to}`,
      });
    } catch (error: unknown) {
      const apiError = error as ApiError;
      if (apiError?.status === 503) {
        toast({
          title: "Email unavailable",
          description:
            "Email sending is not configured on the server. Ask an admin to set RESEND_API_KEY.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Email failed",
          description: apiError?.message || "Could not email invoice",
          variant: "destructive",
        });
      }
    } finally {
      setEmailingId(null);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Invoices</h1>
            <p className="text-muted-foreground">Create invoices, track balances, and record payments</p>
          </div>
          {canCreate && (
            <Button
              className="w-full sm:w-auto h-11"
              onClick={openCreateInvoice}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Invoice
            </Button>
          )}
        </div>

        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Invoice #, shop, city..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Shop</Label>
              <Select value={shopFilter} onValueChange={setShopFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shops</SelectItem>
                  {shops.map((shop) => (
                    <SelectItem key={shop.id} value={shop.id}>
                      {shop.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        <div className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : shopGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No invoices found</p>
          ) : (
            shopGroups.map((group) => (
              <ShopInvoiceGroup
                key={group.shopId}
                shopId={group.shopId}
                shopName={group.shopName}
                shopLocation={group.shopLocation}
                invoices={group.invoices.map((inv) => ({
                  id: inv.id,
                  invoice_number: inv.invoice_number,
                  shop_id: inv.shop_id,
                  created_by: inv.created_by ?? null,
                  total_amount: inv.total_amount,
                  payment_status: inv.payment_status,
                  created_at: inv.created_at,
                  amount_paid: inv.amount_paid,
                }))}
                onViewInvoice={(inv) => {
                  void (async () => {
                    try {
                      const full = await api<Invoice>(`/invoices/${inv.id}`);
                      setViewInvoice(full);
                    } catch (error: unknown) {
                      const message =
                        error && typeof error === "object" && "message" in error
                          ? String((error as ApiError).message)
                          : "Could not load invoice";
                      toast({ title: "Error", description: message, variant: "destructive" });
                    }
                  })();
                }}
                onRecordPayment={(inv) => {
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) openPayment(row);
                }}
                onExportPDF={(inv) => {
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) void exportPdf(row);
                }}
                onSendEmail={(inv) => {
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) void emailInvoice(row);
                }}
                sendingEmailId={emailingId}
                onDeleteInvoice={(inv) => {
                  const row = invoices.find((i) => i.id === inv.id) || null;
                  setDeleteInvoice(row);
                }}
                onDistributePayment={(shopId, shopName, pendingInvs, totalPending) => {
                  const fullInvoices = pendingInvs
                    .map((p) => invoices.find((i) => i.id === p.id))
                    .filter((i): i is Invoice => !!i);
                  setDistributeTarget({
                    shopId,
                    shopName,
                    invoices: fullInvoices,
                    totalPending,
                  });
                }}
                canManage={canCreate}
                isAdmin={isAdmin}
                profiles={profilesForNames}
                onRefetch={refetchInvoices}
              />
            ))
          )}
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          // Closing keeps the on-device draft; only success / explicit new form clears it.
        }}
      >
        <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] sm:w-full max-h-[90dvh] overflow-x-hidden overflow-y-auto p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 min-w-0 overflow-x-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2 min-w-0">
                <Label>Shop *</Label>
                <Select value={shopId} onValueChange={setShopId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select shop" />
                  </SelectTrigger>
                  <SelectContent>
                    {shops.map((shop) => (
                      <SelectItem key={shop.id} value={shop.id}>
                        {shop.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Warehouse</Label>
                <Select
                  value={warehouse}
                  onValueChange={(v) => setWarehouse(v as "A" | "B")}
                  disabled={!canPickWarehouse}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Warehouse A</SelectItem>
                    <SelectItem value="B">Warehouse B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-3 min-w-0">
              <div className="flex flex-col gap-0.5">
                <Label className="text-base">Products</Label>
                <span className="text-xs text-muted-foreground">Tap a product to add · change qty below</span>
              </div>

              <div className="grid grid-cols-1 gap-2 min-w-0">
                <Input
                  placeholder="Search SKU or flavor..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full min-w-0"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                <Popover open={createCategoryOpen} onOpenChange={setCreateCategoryOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full min-w-0 justify-between h-10 font-normal"
                    >
                      <span className="truncate">
                        {createCategoryFilter === "all" ? "All categories" : createCategoryFilter}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[110] p-0 w-[min(100vw-2rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)]"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Search categories..." />
                      <CommandList>
                        <CommandEmpty>No category found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all categories"
                            onSelect={() => {
                              setCreateCategoryFilter("all");
                              setCreateSubcategoryFilter("all");
                              setCreateCategoryOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                createCategoryFilter === "all" ? "opacity-100" : "opacity-0"
                              )}
                            />
                            All categories
                          </CommandItem>
                          {createCategories.map((category) => (
                            <CommandItem
                              key={category}
                              value={category}
                              onSelect={() => {
                                setCreateCategoryFilter(category);
                                setCreateSubcategoryFilter("all");
                                setCreateCategoryOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  createCategoryFilter === category ? "opacity-100" : "opacity-0"
                                )}
                              />
                              {category}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <Popover open={createSubcategoryOpen} onOpenChange={setCreateSubcategoryOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full min-w-0 justify-between h-10 font-normal"
                    >
                      <span className="truncate">
                        {createSubcategoryFilter === "all"
                          ? "All subcategories"
                          : createSubcategoryFilter}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[110] p-0 w-[min(100vw-2rem,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)]"
                    align="start"
                  >
                    <Command>
                      <CommandInput placeholder="Search subcategories..." />
                      <CommandList>
                        <CommandEmpty>No subcategory found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="all subcategories"
                            onSelect={() => {
                              setCreateSubcategoryFilter("all");
                              setCreateSubcategoryOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                createSubcategoryFilter === "all" ? "opacity-100" : "opacity-0"
                              )}
                            />
                            All subcategories
                          </CommandItem>
                          {createSubcategories.map((subcategory) => (
                            <CommandItem
                              key={subcategory}
                              value={subcategory}
                              onSelect={() => {
                                setCreateSubcategoryFilter(subcategory);
                                setCreateSubcategoryOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  createSubcategoryFilter === subcategory
                                    ? "opacity-100"
                                    : "opacity-0"
                                )}
                              />
                              {subcategory}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto overflow-x-hidden rounded-md border divide-y overscroll-contain min-w-0">
                {!canShowProductList ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">
                    Pick a category or type at least 2 characters to list products
                  </p>
                ) : productsLoading ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">Loading products...</p>
                ) : filteredCreateProducts.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground text-center">No products match</p>
                ) : (
                  filteredCreateProducts.map((product) => {
                    const qty = itemQtyByProduct.get(product.id) || 0;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProductQuick(product)}
                        className={cn(
                          "w-full max-w-full text-left px-3 py-2.5 min-h-11 flex items-center gap-2 hover:bg-muted/80 active:bg-muted transition-colors",
                          qty > 0 && "bg-primary/5"
                        )}
                      >
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                            <span className="font-mono text-sm font-semibold shrink-0">
                              {product.sku || "—"}
                            </span>
                            <span className="truncate text-sm">{product.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {product.category}
                            {product.subcategory ? ` · ${product.subcategory}` : ""}
                            {` · $${Number(product.price).toFixed(2)}`}
                          </p>
                        </div>
                        {qty > 0 ? (
                          <Badge className="shrink-0">{qty}</Badge>
                        ) : (
                          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {items.length > 0 && (
              <>
                {/* Mobile line items — no horizontal scroll */}
                <div className="md:hidden space-y-2 min-w-0">
                  {items.map((item, index) => (
                    <div key={`${item.product_id}-${index}`} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold">{item.product_sku || "—"}</p>
                          <p className="text-sm truncate">{item.product_name}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 h-9 w-9 p-0"
                          onClick={() => setItems(items.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Qty</Label>
                          <Input
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={item.quantity}
                            onChange={(e) => updateLine(index, "quantity", Number(e.target.value))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Price</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={item.unit_price}
                            onChange={(e) => updateLine(index, "unit_price", Number(e.target.value))}
                          />
                        </div>
                      </div>
                      <p className="text-sm text-right font-medium">
                        Subtotal ${item.subtotal.toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Flavor</TableHead>
                        <TableHead className="w-24">Qty</TableHead>
                        <TableHead className="w-28">Price</TableHead>
                        <TableHead className="w-28">Subtotal</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, index) => (
                        <TableRow key={`${item.product_id}-${index}`}>
                          <TableCell className="font-mono text-sm">
                            {item.product_sku || "-"}
                          </TableCell>
                          <TableCell>{item.product_name}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={item.quantity}
                              onChange={(e) => updateLine(index, "quantity", Number(e.target.value))}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={item.unit_price}
                              onChange={(e) =>
                                updateLine(index, "unit_price", Number(e.target.value))
                              }
                            />
                          </TableCell>
                          <TableCell>${item.subtotal.toFixed(2)}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setItems(items.filter((_, i) => i !== index))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <Label>Discount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3 min-w-0">
              <p className="text-sm font-medium">Optional payments on create</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Cash</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Check</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={checkAmount}
                    onChange={(e) => setCheckAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Credit</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm border-t pt-3">
              <div className="space-y-1 text-muted-foreground">
                <div>Subtotal: ${subtotal.toFixed(2)}</div>
                <div>Payments: ${createPaymentsTotal.toFixed(2)}</div>
              </div>
              <div className="sm:text-right">
                <div className="text-muted-foreground">Invoice total</div>
                <div className="text-2xl font-bold">${totalAmount.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-background pt-2 pb-1">
              {(shopId || items.length > 0 || notes.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto h-11 text-destructive"
                  disabled={createMutation.isPending}
                  onClick={() => {
                    resetCreateForm({ clearDraft: true });
                    toast({ title: "Draft discarded" });
                  }}
                >
                  Discard draft
                </Button>
              )}
              <Button variant="outline" className="w-full sm:w-auto h-11" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                className="w-full sm:w-auto h-11"
                disabled={!shopId || items.length === 0 || createMutation.isPending}
                onClick={() => {
                  if (createMutation.isPending) return;
                  createMutation.mutate();
                }}
              >
                {createMutation.isPending ? "Creating..." : "Create Invoice"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentInvoice} onOpenChange={(open) => !open && setPaymentInvoice(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {paymentInvoice?.invoice_number} · {paymentInvoice?.shop?.name}
              </p>
              <p className="text-2xl font-bold mt-1">${remainingForPayment.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Remaining balance</p>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payMethod === "check" && (
              <div className="space-y-2">
                <Label>Check number</Label>
                <Input
                  value={payCheckNumber}
                  onChange={(e) => setPayCheckNumber(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="outline" className="w-full sm:w-auto h-11" onClick={() => setPaymentInvoice(null)}>
                Cancel
              </Button>
              <Button
                className="w-full sm:w-auto h-11"
                disabled={paymentMutation.isPending}
                onClick={() => paymentMutation.mutate()}
              >
                {paymentMutation.isPending ? "Saving..." : "Save Payment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {creditInvoice && (
        <CreditDialog
          open={!!creditInvoice}
          onOpenChange={(open) => !open && setCreditInvoice(null)}
          invoice={creditInvoice}
          remainingAmount={creditRemaining}
        />
      )}

      <Dialog open={!!viewInvoice} onOpenChange={(open) => !open && setViewInvoice(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          {viewInvoice && (
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{viewInvoice.shop?.name || "Unknown shop"}</p>
                  <p className="text-muted-foreground">
                    {new Date(viewInvoice.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant={statusBadgeVariant(viewInvoice.payment_status)} className="capitalize">
                  {viewInvoice.payment_status}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Total</p>
                  <p className="font-semibold">${Number(viewInvoice.total_amount).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Paid</p>
                  <p className="font-semibold">${Number(viewInvoice.amount_paid || 0).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Pending</p>
                  <p className="font-semibold text-orange-600">
                    $
                    {Math.max(
                      0,
                      Number(viewInvoice.total_amount) - Number(viewInvoice.amount_paid || 0)
                    ).toFixed(2)}
                  </p>
                </div>
              </div>
              {(viewInvoice.items || []).length > 0 && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(viewInvoice.items || []).map((item, idx) => (
                        <TableRow key={item.id || `${item.product_id}-${idx}`}>
                          <TableCell>{item.product_name}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            ${Number(item.subtotal).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {(viewInvoice.payments || []).length > 0 && (
                <div>
                  <p className="font-medium mb-2">Payments</p>
                  <div className="space-y-1">
                    {(viewInvoice.payments || []).map((p) => (
                      <div key={p.id} className="flex justify-between text-muted-foreground">
                        <span>
                          {p.payment_method} · {p.payment_date}
                        </span>
                        <span className="text-foreground font-medium">
                          ${Number(p.amount).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {viewInvoice.notes && (
                <p className="text-muted-foreground whitespace-pre-wrap">{viewInvoice.notes}</p>
              )}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                {canCreate &&
                  Math.max(
                    0,
                    Number(viewInvoice.total_amount) - Number(viewInvoice.amount_paid || 0)
                  ) > 0.01 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCreditInvoice(viewInvoice);
                          setViewInvoice(null);
                        }}
                      >
                        Credit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          openPayment(viewInvoice);
                          setViewInvoice(null);
                        }}
                      >
                        Pay
                      </Button>
                    </>
                  )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteInvoice} onOpenChange={(open) => !open && setDeleteInvoice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes {deleteInvoice?.invoice_number} and its payments. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending || !deleteInvoice}
              onClick={() => deleteInvoice && deleteMutation.mutate(deleteInvoice)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {distributeTarget && (
        <DistributePaymentDialog
          open={!!distributeTarget}
          onOpenChange={(open) => !open && setDistributeTarget(null)}
          shopId={distributeTarget.shopId}
          shopName={distributeTarget.shopName}
          invoices={distributeTarget.invoices}
          totalPending={distributeTarget.totalPending}
          onRefetch={refetchInvoices}
        />
      )}
    </>
  );
};

export default Invoices;
