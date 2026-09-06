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
  buildPageParams,
  DEFAULT_PAGE_SIZE,
  fetchAllPages,
  type Paginated,
} from "@/lib/pagination";
import { ListPaginationBar } from "@/components/ui/ListPaginationBar";
import {
  clearInvoiceCreateDraft,
  draftHasWork,
  isNetworkApiError,
  isValidUuid,
  loadInvoiceCreateDraft,
  newClientRequestId,
  saveInvoiceCreateDraft,
  type InvoiceCreateDraft,
} from "@/lib/invoiceCreateDraft";
import {
  buildSyncQueueItem,
  invoiceSyncQueueQueryKey,
  loadInvoiceSyncQueue,
  removeInvoiceSyncQueueItem,
  upsertInvoiceSyncQueueItem,
} from "@/lib/invoiceSyncQueue";
import {
  loadOfflineProductsCache,
  loadOfflineShopsCache,
  saveOfflineProductsCache,
  saveOfflineShopsCache,
} from "@/lib/offlineCatalogCache";
import {
  queueItemAsLocalInvoice,
  syncInvoiceQueueNow,
  useInvoiceSyncQueue,
} from "@/lib/invoiceSyncRunner";
import { useToast } from "@/hooks/use-toast";
import { generateInvoicePDF, saveInvoicePDF } from "@/lib/pdfGenerator";
import { CreditDialog } from "@/components/invoices/CreditDialog";
import { DistributePaymentDialog } from "@/components/invoices/DistributePaymentDialog";
import { ShopInvoiceGroup } from "@/components/invoices/ShopInvoiceGroup";
import { PageHero } from "@/components/ui/PageHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, CloudOff, FileText, Plus, RefreshCw, ScanLine, Sparkles, Trash2 } from "lucide-react";

type Shop = {
  id: string;
  name: string;
  is_frozen?: boolean;
};

type Product = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
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
  local_sync?: "pending" | "syncing" | "failed";
  local_sync_error?: string | null;
  client_request_id?: string;
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

/** Same calendar day in America/Chicago (matches API same-day edit rule). */
function isSameBusinessDay(iso: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(iso)) === fmt.format(new Date());
}

const Invoices = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canCreate = user?.role === "admin" || user?.role === "sales" || user?.role === "srour";
  const canPickWarehouse = user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const canDeleteInvoice = user?.role === "admin" || user?.role === "srour";
  const canEditSameDay = canCreate;

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [shopFilter, setShopFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, shopFilter]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [editingInvoiceNumber, setEditingInvoiceNumber] = useState<string | null>(null);
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
  const [gunScannerOn, setGunScannerOn] = useState(false);
  const gunScanBufferRef = useRef("");
  const gunScanLastKeyAtRef = useRef(0);
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

  const invoiceQueryParams = useMemo(
    () =>
      buildPageParams({
        search: debouncedSearch || undefined,
        payment_status: statusFilter !== "all" ? statusFilter : undefined,
        shop_id: shopFilter !== "all" ? shopFilter : undefined,
        page,
        page_size: pageSize,
      }),
    [debouncedSearch, statusFilter, shopFilter, page, pageSize]
  );

  const { data: invoicePage, isLoading } = useQuery({
    queryKey: ["invoices", invoiceQueryParams],
    queryFn: async () => {
      try {
        return await api<Paginated<Invoice>>(`/invoices${invoiceQueryParams}`);
      } catch (err) {
        if (isNetworkApiError(err as ApiError)) {
          return { items: [] as Invoice[], total: 0, page, page_size: pageSize };
        }
        throw err;
      }
    },
  });

  const invoices = invoicePage?.items ?? [];
  const invoiceTotal = invoicePage?.total ?? 0;

  useInvoiceSyncQueue(user?.id);
  const { data: syncQueue = [] } = useQuery({
    queryKey: user?.id ? invoiceSyncQueueQueryKey(user.id) : ["invoice-sync-queue", "anon"],
    queryFn: () => (user?.id ? loadInvoiceSyncQueue(user.id) : []),
    enabled: Boolean(user?.id),
    staleTime: Infinity,
  });

  const localPendingInvoices = useMemo(
    () => syncQueue.map((item) => queueItemAsLocalInvoice(item) as Invoice),
    [syncQueue]
  );

  const { data: shops = [] } = useQuery({
    queryKey: ["shops", "catalog"],
    queryFn: async () => {
      try {
        const data = await fetchAllPages<Shop>("/shops");
        if (user?.id) saveOfflineShopsCache(user.id, data);
        return data;
      } catch (err) {
        if (user?.id && isNetworkApiError(err as ApiError)) {
          const cached = loadOfflineShopsCache<Shop>(user.id);
          if (cached?.length) return cached;
        }
        throw err;
      }
    },
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products", "active", "brief", "catalog"],
    queryFn: async () => {
      try {
        const data = await fetchAllPages<Product>("/products", {
          extraParams: { active_only: true, brief: true },
        });
        if (user?.id) saveOfflineProductsCache(user.id, data);
        return data;
      } catch (err) {
        if (user?.id && isNetworkApiError(err as ApiError)) {
          const cached = loadOfflineProductsCache<Product>(user.id);
          if (cached?.length) return cached;
        }
        throw err;
      }
    },
    enabled: createOpen || Boolean(editingInvoiceId),
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
        (p.barcode || "").toLowerCase().includes(q) ||
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
    queryKey: ["users", "names-for-invoices"],
    queryFn: () => api<UserProfile[]>("/users/names"),
    enabled: canCreate,
  });

  const profilesForNames = useMemo(() => {
    if (profiles.length) return profiles;
    if (user) return [{ id: user.id, full_name: user.full_name }];
    return [];
  }, [profiles, user]);

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

    const mergeRow = (invoice: Invoice) => {
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
    };

    for (const invoice of invoices) mergeRow(invoice);

    // Local pending creates (this device only) — filter by shop if shop filter set
    for (const local of localPendingInvoices) {
      if (shopFilter !== "all" && local.shop_id !== shopFilter) continue;
      if (statusFilter !== "all" && local.payment_status !== statusFilter) continue;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const hay = `${local.invoice_number} ${local.shop?.name || ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      mergeRow(local);
    }

    return Array.from(map.values())
      .map((g) => ({
        ...g,
        invoices: [...g.invoices].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
        pending: g.invoices.reduce(
          (sum, inv) =>
            inv.local_sync
              ? sum
              : sum + Math.max(0, Number(inv.total_amount) - Number(inv.amount_paid || 0)),
          0
        ),
      }))
      .sort((a, b) => b.pending - a.pending || a.shopName.localeCompare(b.shopName));
  }, [invoices, localPendingInvoices, shopFilter, statusFilter, debouncedSearch]);

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
    setEditingInvoiceId(null);
    setEditingInvoiceNumber(null);
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
    clientRequestIdRef.current = isValidUuid(draft.client_request_id)
      ? draft.client_request_id
      : newClientRequestId();
    setShopId(isValidUuid(draft.shop_id) ? draft.shop_id : "");
    setNotes(draft.notes || "");
    setDiscountAmount(draft.discount_amount || "");
    setWarehouse(draft.warehouse === "B" ? "B" : "A");
    setItems(
      Array.isArray(draft.items)
        ? draft.items.filter((item) => isValidUuid(item.product_id))
        : []
    );
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
        setEditingInvoiceId(null);
        setEditingInvoiceNumber(null);
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

  const canEditInvoiceRow = (inv: { local_sync?: string; created_at: string; invoice_number?: string }) => {
    if (!canEditSameDay) return false;
    if (inv.local_sync) return false;
    // Legacy opening-balance invoices have no editable product lines.
    if (inv.invoice_number?.startsWith("LEGACY") || inv.invoice_number?.includes("LEGACY")) return false;
    if (isAdmin) return true;
    return isSameBusinessDay(inv.created_at);
  };

  const openEditInvoice = async (inv: { id: string; local_sync?: string; created_at: string; invoice_number: string }) => {
    if (!canEditInvoiceRow(inv)) {
      toast({
        title: "Cannot edit",
        description: isAdmin
          ? "This invoice cannot be edited."
          : "Only invoices created today can be edited.",
        variant: "destructive",
      });
      return;
    }
    try {
      const full = await api<Invoice>(`/invoices/${inv.id}`);
      if (!full.items?.length) {
        toast({
          title: "Cannot edit",
          description: "This invoice has no line items to edit.",
          variant: "destructive",
        });
        return;
      }
      skipNextDraftPersistRef.current = true;
      setEditingInvoiceId(full.id);
      setEditingInvoiceNumber(full.invoice_number);
      setShopId(full.shop_id);
      setNotes(full.notes || "");
      setDiscountAmount(full.discount_amount ? String(full.discount_amount) : "");
      setWarehouse((full.warehouse as "A" | "B") || user?.assigned_warehouse || "A");
      setItems(
        full.items.map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          product_sku: null,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.subtotal),
        }))
      );
      setCashAmount("");
      setCheckAmount("");
      setCreditAmount("");
      setProductSearch("");
      setCreateCategoryFilter("all");
      setCreateSubcategoryFilter("all");
      setCreateOpen(true);
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as ApiError).message)
          : "Could not load invoice";
      toast({ title: "Error", description: message, variant: "destructive" });
    }
  };

  // Keep draft on device while sales build the invoice (survives refresh / weak signal).
  useEffect(() => {
    if (!user?.id) return;
    if (editingInvoiceId) return;
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
    editingInvoiceId,
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

  const findProductByCode = (raw: string) => {
    const code = raw.trim().toLowerCase();
    if (!code) return null;
    const byBarcode = products.find((p) => (p.barcode || "").trim().toLowerCase() === code);
    if (byBarcode) return byBarcode;
    return products.find((p) => (p.sku || "").trim().toLowerCase() === code) || null;
  };

  const applyScannedCode = (raw: string) => {
    const product = findProductByCode(raw);
    if (!product) {
      toast({
        title: "No product found",
        description: `No barcode/SKU match for “${raw.trim()}”`,
        variant: "destructive",
      });
      return;
    }
    addProductQuick(product);
    setProductSearch("");
    toast({ title: "Added", description: product.name });
  };

  const applyScannedCodeRef = useRef(applyScannedCode);
  applyScannedCodeRef.current = applyScannedCode;

  // Bluetooth gun scanner mode: capture keystrokes page-wide (works while scrolling).
  useEffect(() => {
    if (!createOpen) {
      setGunScannerOn(false);
      gunScanBufferRef.current = "";
    }
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen || !gunScannerOn) return;

    const isTypingField = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      if (tag === "INPUT") {
        const type = ((target as HTMLInputElement).type || "text").toLowerCase();
        return !["button", "checkbox", "radio", "submit", "reset", "file", "hidden"].includes(type);
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Let normal typing in notes / amounts / search work; gun works everywhere else (incl. scroll).
      if (isTypingField(e.target)) return;

      const now = Date.now();
      // Scanners burst keys quickly; slow gaps start a new code.
      if (now - gunScanLastKeyAtRef.current > 80) {
        gunScanBufferRef.current = "";
      }
      gunScanLastKeyAtRef.current = now;

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const code = gunScanBufferRef.current.trim();
        gunScanBufferRef.current = "";
        if (code) applyScannedCodeRef.current(code);
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();
        gunScanBufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [createOpen, gunScannerOn]);

  const toggleGunScanner = () => {
    setGunScannerOn((on) => {
      const next = !on;
      if (next) {
        gunScanBufferRef.current = "";
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }
      return next;
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

  const enqueueCurrentCreate = () => {
    if (!user?.id) throw { message: "Not signed in" } satisfies ApiError;
    if (!isValidUuid(shopId)) throw { message: "Select a shop" } satisfies ApiError;
    if (items.length === 0) throw { message: "Add at least one product" } satisfies ApiError;
    if (!isValidUuid(clientRequestIdRef.current)) {
      clientRequestIdRef.current = newClientRequestId();
    }

    const payments: Array<{ amount: number; payment_method: PaymentMethod }> = [];
    const cash = Number(cashAmount) || 0;
    const check = Number(checkAmount) || 0;
    const credit = Number(creditAmount) || 0;
    if (cash > 0) payments.push({ amount: cash, payment_method: "cash" });
    if (check > 0) payments.push({ amount: check, payment_method: "check" });
    if (credit > 0) payments.push({ amount: credit, payment_method: "credit" });

    const shopName = shops.find((s) => s.id === shopId)?.name || "Unknown shop";
    const queueItem = buildSyncQueueItem({
      userId: user.id,
      clientRequestId: clientRequestIdRef.current,
      shopId,
      shopName,
      notes: notes.trim() || null,
      discountAmount: discount,
      warehouse,
      items: items
        .filter((item) => isValidUuid(item.product_id))
        .map((item) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
        })),
      payments,
    });
    upsertInvoiceSyncQueueItem(user.id, queueItem);
    queryClient.setQueryData(invoiceSyncQueueQueryKey(user.id), loadInvoiceSyncQueue(user.id));
  };

  const createMutation = useMutation({
    // Default RQ networkMode is "online" — mutations pause forever when the browser
    // reports offline, so Create never queues. Always run so we can save locally.
    networkMode: "always",
    mutationFn: async (): Promise<{ mode: "created"; invoice: Invoice } | { mode: "queued" }> => {
      if (!isValidUuid(shopId)) throw { message: "Select a shop" } satisfies ApiError;
      if (items.length === 0) throw { message: "Add at least one product" } satisfies ApiError;
      if (createPaymentsTotal > totalAmount + 0.01) {
        throw { message: "Payments cannot exceed invoice total" } satisfies ApiError;
      }
      if (!isValidUuid(clientRequestIdRef.current)) {
        clientRequestIdRef.current = newClientRequestId();
      }
      if (!user?.id) throw { message: "Not signed in" } satisfies ApiError;

      const payments: Array<{ amount: number; payment_method: PaymentMethod }> = [];
      const cash = Number(cashAmount) || 0;
      const check = Number(checkAmount) || 0;
      const credit = Number(creditAmount) || 0;
      if (cash > 0) payments.push({ amount: cash, payment_method: "cash" });
      if (check > 0) payments.push({ amount: check, payment_method: "check" });
      if (credit > 0) payments.push({ amount: credit, payment_method: "credit" });

      // Persist working draft, then always enqueue first (safe with client_request_id).
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
      enqueueCurrentCreate();

      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline) {
        return { mode: "queued" };
      }

      const body = JSON.stringify({
        client_request_id: clientRequestIdRef.current,
        shop_id: shopId,
        items: items
          .filter((item) => isValidUuid(item.product_id))
          .map((item) => ({
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

      const requestId = clientRequestIdRef.current;
      const hardTimeoutMs = 2500;
      const abort = new AbortController();
      const wallClock = new Promise<never>((_, reject) => {
        window.setTimeout(() => {
          abort.abort();
          reject({ message: "Request timed out", status: 0 } satisfies ApiError);
        }, hardTimeoutMs);
      });

      try {
        const invoice = await Promise.race([
          api<Invoice>("/invoices", {
            method: "POST",
            body,
            timeoutMs: hardTimeoutMs,
            signal: abort.signal,
          }),
          wallClock,
        ]);
        removeInvoiceSyncQueueItem(user.id, requestId);
        queryClient.setQueryData(invoiceSyncQueueQueryKey(user.id), loadInvoiceSyncQueue(user.id));
        return { mode: "created", invoice };
      } catch (err) {
        const error = err as ApiError;
        if (isNetworkApiError(error)) {
          return { mode: "queued" };
        }
        // Real validation/business error — don't leave a fake pending row.
        removeInvoiceSyncQueueItem(user.id, requestId);
        queryClient.setQueryData(invoiceSyncQueueQueryKey(user.id), loadInvoiceSyncQueue(user.id));
        throw error;
      }
    },
    onSuccess: (result) => {
      if (result.mode === "queued") {
        setCreateOpen(false);
        resetCreateForm({ clearDraft: true });
        toast({
          title: "Saved offline — pending sync",
          description: "It appears on Invoices as Pending sync and uploads when you’re back online.",
        });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setCreateOpen(false);
      resetCreateForm({ clearDraft: true });
      toast({ title: "Invoice created" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingInvoiceId) throw { message: "No invoice selected" } satisfies ApiError;
      if (items.length === 0) throw { message: "Add at least one product" } satisfies ApiError;
      return api<Invoice>(`/invoices/${editingInvoiceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          items: items
            .filter((item) => isValidUuid(item.product_id))
            .map((item) => ({
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.subtotal,
            })),
          discount_amount: discount,
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setCreateOpen(false);
      resetCreateForm({ clearDraft: false });
      toast({ title: "Invoice updated" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [syncNowBusy, setSyncNowBusy] = useState(false);

  const handleSyncNow = async () => {
    if (!user?.id) return;
    setSyncNowBusy(true);
    try {
      const result = await syncInvoiceQueueNow(user.id);
      queryClient.setQueryData(invoiceSyncQueueQueryKey(user.id), loadInvoiceSyncQueue(user.id));
      if (result.synced > 0) {
        refetchInvoices();
        queryClient.invalidateQueries({ queryKey: ["products"] });
        toast({
          title: result.synced === 1 ? "Invoice synced" : `${result.synced} invoices synced`,
        });
      } else if (result.failed > 0) {
        toast({
          title: "Some invoices failed to sync",
          description: "Check the Pending sync rows for details.",
          variant: "destructive",
        });
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        toast({
          title: "Still offline",
          description: "Pending invoices will sync when the network returns.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Nothing to sync" });
      }
    } finally {
      setSyncNowBusy(false);
    }
  };

  const handleRetryLocalSync = async (inv: { client_request_id?: string }) => {
    if (!user?.id || !inv.client_request_id) return;
    await handleSyncNow();
  };

  const handleDiscardLocalSync = (inv: { client_request_id?: string }) => {
    if (!user?.id || !inv.client_request_id) return;
    removeInvoiceSyncQueueItem(user.id, inv.client_request_id);
    queryClient.setQueryData(invoiceSyncQueueQueryKey(user.id), loadInvoiceSyncQueue(user.id));
    toast({ title: "Removed from sync queue" });
  };

  const suggestOrderMutation = useMutation({
    mutationFn: () => {
      if (!shopId) throw { message: "Select a shop first" } satisfies ApiError;
      return api<{
        items: Array<{
          product_id: string;
          product_name: string;
          sku?: string | null;
          quantity: number;
          unit_price: number;
          reason?: string | null;
        }>;
        note?: string | null;
      }>("/ai/suggest-order", {
        method: "POST",
        body: JSON.stringify({ shop_id: shopId, limit: 10 }),
      });
    },
    onSuccess: (data) => {
      if (!data.items?.length) {
        toast({
          title: "No suggestion",
          description: data.note || "No prior invoices for this shop.",
        });
        return;
      }
      setItems((prev) => {
        const next = [...prev];
        for (const sug of data.items) {
          const idx = next.findIndex((i) => i.product_id === sug.product_id);
          const qty = Math.max(1, Math.floor(Number(sug.quantity) || 1));
          const price = Number(sug.unit_price) || 0;
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              quantity: qty,
              unit_price: price,
              subtotal: qty * price,
            };
          } else {
            next.push({
              product_id: sug.product_id,
              product_name: sug.product_name,
              product_sku: sug.sku || null,
              quantity: qty,
              unit_price: price,
              subtotal: qty * price,
            });
          }
        }
        return next;
      });
      toast({
        title: "Suggested order added",
        description: `${data.items.length} products from this shop’s history. Edit before creating.`,
      });
    },
    onError: (error: ApiError) => {
      toast({
        title: error.status === 503 ? "AI not configured" : "Suggest failed",
        description: error.message,
        variant: "destructive",
      });
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
        <PageHero
          icon={FileText}
          title="Invoices"
          description="Create invoices, track balances, and record payments"
          stats={[
            {
              label: "Total",
              value: isLoading ? "…" : invoiceTotal + localPendingInvoices.length,
              accent: true,
            },
            {
              label: "Pending sync",
              value: String(localPendingInvoices.length),
            },
            {
              label: "On page",
              value: isLoading ? "…" : invoices.length,
            },
            {
              label: "Open $",
              value: isLoading
                ? "…"
                : `$${invoices
                    .reduce(
                      (sum, i) =>
                        sum + Math.max(0, Number(i.total_amount) - Number(i.amount_paid || 0)),
                      0
                    )
                    .toFixed(0)}`,
            },
          ]}
          action={
            canCreate ? (
              <Button className="h-11 w-full shadow-sm shadow-primary/25 sm:w-auto" onClick={openCreateInvoice}>
                <Plus className="mr-2 h-4 w-4" />
                New Invoice
              </Button>
            ) : undefined
          }
        />

        {syncQueue.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-200">
                  <CloudOff className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {syncQueue.length} invoice{syncQueue.length === 1 ? "" : "s"} waiting to sync
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Saved on this device only. They upload automatically when you’re online. PDF/email
                    unlock after sync.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                className="h-11 w-full sm:w-auto"
                disabled={syncNowBusy}
                onClick={() => void handleSyncNow()}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncNowBusy ? "animate-spin" : ""}`} />
                {syncNowBusy ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          </Card>
        )}

        <Card className="border-primary/10 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                className="h-11"
                placeholder="Invoice #, shop, city..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11">
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
                <SelectTrigger className="h-11">
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
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-muted/60" />
              ))}
            </div>
          ) : shopGroups.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No invoices found"
              description="Try another search or status, or create a new invoice"
              action={
                canCreate ? (
                  <Button className="h-11" onClick={openCreateInvoice}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Invoice
                  </Button>
                ) : undefined
              }
            />
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
                  local_sync: inv.local_sync,
                  local_sync_error: inv.local_sync_error,
                  client_request_id: inv.client_request_id,
                }))}
                onViewInvoice={(inv) => {
                  if (inv.local_sync) {
                    const local = localPendingInvoices.find((i) => i.id === inv.id);
                    if (local) setViewInvoice(local);
                    return;
                  }
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
                  if (inv.local_sync) {
                    toast({
                      title: "Not synced yet",
                      description: "Record payments after this invoice uploads.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) openPayment(row);
                }}
                onExportPDF={(inv) => {
                  if (inv.local_sync) {
                    toast({
                      title: "PDF after sync",
                      description: "Official PDF is available once the invoice is on the server.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) void exportPdf(row);
                }}
                onSendEmail={(inv) => {
                  if (inv.local_sync) {
                    toast({
                      title: "Email after sync",
                      description: "Email is available once the invoice is on the server.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const row = invoices.find((i) => i.id === inv.id);
                  if (row) void emailInvoice(row);
                }}
                sendingEmailId={emailingId}
                onDeleteInvoice={(inv) => {
                  if (inv.local_sync) {
                    handleDiscardLocalSync(inv);
                    return;
                  }
                  const row = invoices.find((i) => i.id === inv.id) || null;
                  setDeleteInvoice(row);
                }}
                onEditInvoice={(inv) => {
                  void openEditInvoice(inv);
                }}
                onRetryLocalSync={(inv) => void handleRetryLocalSync(inv)}
                onDiscardLocalSync={handleDiscardLocalSync}
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
                canDelete={canDeleteInvoice}
                canEditInvoice={(inv) => canEditInvoiceRow(inv)}
                profiles={profilesForNames}
                onRefetch={refetchInvoices}
              />
            ))
          )}
          <ListPaginationBar
            page={page}
            pageSize={pageSize}
            total={invoiceTotal}
            onPageChange={setPage}
            className="pt-2"
          />
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next && editingInvoiceId) {
            setEditingInvoiceId(null);
            setEditingInvoiceNumber(null);
          }
          // Closing keeps the on-device draft; only success / explicit new form clears it.
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-1rem)] max-w-2xl overflow-x-hidden overflow-y-auto p-0 sm:w-full">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-3 py-4 sm:px-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <FileText className="h-5 w-5 text-primary" />
                {editingInvoiceId
                  ? `Edit Invoice${editingInvoiceNumber ? ` · ${editingInvoiceNumber}` : ""}`
                  : "Create Invoice"}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="min-w-0 space-y-4 overflow-x-hidden p-3 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2 min-w-0">
                <Label>Shop *</Label>
                <Select value={shopId} onValueChange={setShopId} disabled={Boolean(editingInvoiceId)}>
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
                  disabled={!canPickWarehouse || Boolean(editingInvoiceId)}
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

            {!editingInvoiceId && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto h-11"
                disabled={!shopId || suggestOrderMutation.isPending}
                onClick={() => suggestOrderMutation.mutate()}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {suggestOrderMutation.isPending ? "Suggesting..." : "Suggest order"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Uses this shop’s recent invoices to prefill products (you can edit).
              </p>
            </div>
            )}

            <div className="space-y-3 rounded-md border p-3 min-w-0">
              <div className="flex flex-col gap-0.5">
                <Label className="text-base">Products</Label>
                <span className="text-xs text-muted-foreground">
                  Tap a product to add · change qty below
                </span>
              </div>

              {gunScannerOn && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">Scanner on</p>
                    <p className="text-xs text-muted-foreground">
                      Scan anytime — scroll is OK. Soft keyboard stays closed.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 shrink-0"
                    onClick={toggleGunScanner}
                  >
                    Stop
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 min-w-0">
                <div className="flex gap-2 min-w-0">
                  <Input
                    placeholder="Search SKU, barcode, or flavor…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const code = productSearch.trim();
                      if (!code) return;
                      // Fallback when gun mode is off: scanner typed into this box
                      if (findProductByCode(code)) {
                        e.preventDefault();
                        applyScannedCode(code);
                      }
                    }}
                    className="w-full min-w-0 h-11 font-mono"
                  />
                  <Button
                    type="button"
                    variant={gunScannerOn ? "default" : "outline"}
                    className={cn(
                      "h-11 shrink-0 px-3",
                      !gunScannerOn && "border-primary/30"
                    )}
                    title={gunScannerOn ? "Stop Bluetooth scanner mode" : "Bluetooth scanner mode"}
                    disabled={productsLoading || products.length === 0}
                    onClick={toggleGunScanner}
                  >
                    <ScanLine className="h-5 w-5" />
                  </Button>
                </div>
                {!gunScannerOn && (
                  <p className="text-xs text-muted-foreground">
                    External gun: tap the scan button (no soft keyboard). Scroll while scanning is OK.
                  </p>
                )}

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

            {!editingInvoiceId && (
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
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm border-t pt-3">
              <div className="space-y-1 text-muted-foreground">
                <div>Subtotal: ${subtotal.toFixed(2)}</div>
                {!editingInvoiceId && <div>Payments: ${createPaymentsTotal.toFixed(2)}</div>}
              </div>
              <div className="sm:text-right">
                <div className="text-muted-foreground">Invoice total</div>
                <div className="text-2xl font-bold">${totalAmount.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sticky bottom-0 bg-background pt-2 pb-1">
              {!editingInvoiceId && (shopId || items.length > 0 || notes.trim()) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full sm:w-auto h-11 text-destructive"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    resetCreateForm({ clearDraft: true });
                    toast({ title: "Draft discarded" });
                  }}
                >
                  Discard draft
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full sm:w-auto h-11"
                onClick={() => setCreateOpen(false)}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="w-full sm:w-auto h-11"
                disabled={
                  !shopId ||
                  items.length === 0 ||
                  createMutation.isPending ||
                  updateMutation.isPending
                }
                onClick={() => {
                  if (editingInvoiceId) {
                    if (updateMutation.isPending) return;
                    updateMutation.mutate();
                    return;
                  }
                  if (createMutation.isPending) return;
                  createMutation.mutate();
                }}
              >
                {editingInvoiceId
                  ? updateMutation.isPending
                    ? "Saving…"
                    : "Update Invoice"
                  : createMutation.isPending
                    ? "Saving…"
                    : "Create Invoice"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentInvoice} onOpenChange={(open) => !open && setPaymentInvoice(null)}>
        <DialogContent className="max-w-md overflow-hidden p-0">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-4">
            <DialogHeader>
              <DialogTitle>Record Payment</DialogTitle>
            </DialogHeader>
          </div>
          <div className="space-y-4 p-6">
            <div>
              <p className="text-sm text-muted-foreground">
                {paymentInvoice?.invoice_number} · {paymentInvoice?.shop?.name}
              </p>
              <p className="mt-1 text-2xl font-bold text-primary">${remainingForPayment.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Remaining balance</p>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                className="h-11"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger className="h-11">
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
                  className="h-11"
                  value={payCheckNumber}
                  onChange={(e) => setPayCheckNumber(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setPaymentInvoice(null)}>
                Cancel
              </Button>
              <Button
                className="h-11 w-full sm:w-auto"
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
        <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
          <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-4">
            <DialogHeader>
              <DialogTitle className="text-xl">{viewInvoice?.invoice_number}</DialogTitle>
            </DialogHeader>
          </div>
          {viewInvoice && (
            <div className="max-h-[calc(85vh-5rem)] space-y-4 overflow-y-auto p-6 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{viewInvoice.shop?.name || "Unknown shop"}</p>
                  <p className="text-muted-foreground">
                    {new Date(viewInvoice.created_at).toLocaleString()}
                  </p>
                </div>
                {viewInvoice.local_sync ? (
                  <Badge
                    variant={viewInvoice.local_sync === "failed" ? "destructive" : "secondary"}
                    className="capitalize"
                  >
                    {viewInvoice.local_sync === "failed"
                      ? "Sync failed"
                      : viewInvoice.local_sync === "syncing"
                        ? "Syncing…"
                        : "Pending sync"}
                  </Badge>
                ) : (
                  <Badge variant={statusBadgeVariant(viewInvoice.payment_status)} className="capitalize">
                    {viewInvoice.payment_status}
                  </Badge>
                )}
              </div>
              {viewInvoice.local_sync && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                  {viewInvoice.local_sync_error ||
                    "Saved on this device only. It will upload when you’re online. PDF/email after sync."}
                </p>
              )}
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
                  !viewInvoice.local_sync &&
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
                {canCreate && viewInvoice.local_sync && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleDiscardLocalSync(viewInvoice);
                        setViewInvoice(null);
                      }}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      disabled={syncNowBusy || viewInvoice.local_sync === "syncing"}
                      onClick={() => void handleRetryLocalSync(viewInvoice)}
                    >
                      Sync now
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
