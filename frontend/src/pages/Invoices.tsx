import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
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
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { generateInvoicePDF, saveInvoicePDF } from "@/lib/pdfGenerator";
import { CreditDialog } from "@/components/invoices/CreditDialog";
import { DistributePaymentDialog } from "@/components/invoices/DistributePaymentDialog";
import { ShopInvoiceGroup } from "@/components/invoices/ShopInvoiceGroup";
import { Plus } from "lucide-react";

type Shop = {
  id: string;
  name: string;
  is_frozen?: boolean;
};

type Product = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  category: string;
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
  items: InvoiceItem[];
  payments: InvoicePayment[];
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
  quantity: number;
  unit_price: number;
  subtotal: number;
};

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
  const [statusFilter, setStatusFilter] = useState("all");
  const [shopFilter, setShopFilter] = useState("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [shopId, setShopId] = useState("");
  const [notes, setNotes] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [warehouse, setWarehouse] = useState<"A" | "B">(user?.assigned_warehouse || "A");
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [productToAdd, setProductToAdd] = useState("");
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
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter !== "all") params.set("payment_status", statusFilter);
    if (shopFilter !== "all") params.set("shop_id", shopFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [search, statusFilter, shopFilter]);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices", invoiceQueryParams],
    queryFn: () => api<Invoice[]>(`/invoices${invoiceQueryParams}`),
  });

  const { data: shops = [] } = useQuery({
    queryKey: ["shops"],
    queryFn: () => api<Shop[]>("/shops"),
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active"],
    queryFn: () => api<Product[]>("/products?active_only=true"),
    enabled: createOpen,
  });

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

  const resetCreateForm = () => {
    setShopId("");
    setNotes("");
    setDiscountAmount("");
    setWarehouse(user?.assigned_warehouse || "A");
    setItems([]);
    setProductToAdd("");
    setCashAmount("");
    setCheckAmount("");
    setCreditAmount("");
  };

  const addProductLine = () => {
    const product = products.find((p) => p.id === productToAdd);
    if (!product) return;
    const existing = items.findIndex((i) => i.product_id === product.id);
    if (existing >= 0) {
      const next = [...items];
      next[existing] = {
        ...next[existing],
        quantity: next[existing].quantity + 1,
        subtotal: (next[existing].quantity + 1) * next[existing].unit_price,
      };
      setItems(next);
    } else {
      const price = Number(product.price) || 0;
      setItems([
        ...items,
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: price,
          subtotal: price,
        },
      ]);
    }
    setProductToAdd("");
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
    mutationFn: () => {
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

      return api<Invoice>("/invoices", {
        method: "POST",
        body: JSON.stringify({
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
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: "Invoice created" });
    },
    onError: (error: ApiError) => {
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
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Invoices</h1>
            <p className="text-muted-foreground">Create invoices, track balances, and record payments</p>
          </div>
          {canCreate && (
            <Button
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
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
                  const full = invoices.find((i) => i.id === inv.id) || null;
                  setViewInvoice(full);
                }}
                onRecordPayment={(inv) => {
                  const full = invoices.find((i) => i.id === inv.id);
                  if (full) openPayment(full);
                }}
                onExportPDF={(inv) => {
                  const full = invoices.find((i) => i.id === inv.id);
                  if (full) void exportPdf(full);
                }}
                onSendEmail={(inv) => {
                  const full = invoices.find((i) => i.id === inv.id);
                  if (full) void emailInvoice(full);
                }}
                sendingEmailId={emailingId}
                onDeleteInvoice={(inv) => {
                  const full = invoices.find((i) => i.id === inv.id) || null;
                  setDeleteInvoice(full);
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
          if (!next) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Shop *</Label>
                <Select value={shopId} onValueChange={setShopId}>
                  <SelectTrigger>
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
              <div className="space-y-2">
                <Label>Warehouse</Label>
                <Select
                  value={warehouse}
                  onValueChange={(v) => setWarehouse(v as "A" | "B")}
                  disabled={!canPickWarehouse}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Warehouse A</SelectItem>
                    <SelectItem value="B">Warehouse B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Add product</Label>
              <div className="flex gap-2">
                <Select value={productToAdd} onValueChange={setProductToAdd}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} — ${Number(product.price).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={addProductLine} disabled={!productToAdd}>
                  Add
                </Button>
              </div>
            </div>

            {items.length > 0 && (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="w-24">Qty</TableHead>
                      <TableHead className="w-28">Price</TableHead>
                      <TableHead className="w-28">Subtotal</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={`${item.product_id}-${index}`}>
                        <TableCell>{item.product_name}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateLine(index, "quantity", Number(e.target.value))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => updateLine(index, "unit_price", Number(e.target.value))}
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
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Discount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Optional payments on create</p>
              <div className="grid grid-cols-3 gap-3">
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

            <div className="flex items-center justify-between text-sm border-t pt-3">
              <div className="space-y-1 text-muted-foreground">
                <div>Subtotal: ${subtotal.toFixed(2)}</div>
                <div>Payments: ${createPaymentsTotal.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">Invoice total</div>
                <div className="text-2xl font-bold">${totalAmount.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!shopId || items.length === 0 || createMutation.isPending}
                onClick={() => createMutation.mutate()}
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPaymentInvoice(null)}>
                Cancel
              </Button>
              <Button disabled={paymentMutation.isPending} onClick={() => paymentMutation.mutate()}>
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
                      {viewInvoice.items.map((item, idx) => (
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
                    {viewInvoice.payments.map((p) => (
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
    </DashboardLayout>
  );
};

export default Invoices;
