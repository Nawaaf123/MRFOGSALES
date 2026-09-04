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
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { generateInvoicePDF, saveInvoicePDF } from "@/lib/pdfGenerator";
import { CreditDialog } from "@/components/invoices/CreditDialog";
import { AddOldBalanceDialog } from "@/components/invoices/AddOldBalanceDialog";
import { DistributePaymentDialog } from "@/components/invoices/DistributePaymentDialog";
import { DollarSign, Download, Gift, Mail, Plus, SplitSquareVertical, Trash2 } from "lucide-react";

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

  const [oldBalanceOpen, setOldBalanceOpen] = useState(false);
  const [creditInvoice, setCreditInvoice] = useState<Invoice | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);

  const [shopPickerOpen, setShopPickerOpen] = useState(false);
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

  const { data: pendingInvoices = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["invoices", "pending-for-distribute"],
    queryFn: async () => {
      const [unpaid, partial] = await Promise.all([
        api<Invoice[]>("/invoices?payment_status=unpaid"),
        api<Invoice[]>("/invoices?payment_status=partial"),
      ]);
      return [...unpaid, ...partial];
    },
    enabled: shopPickerOpen || !!distributeTarget,
  });

  const shopsWithPending = useMemo(() => {
    const map = new Map<
      string,
      { shopId: string; shopName: string; invoices: Invoice[]; totalPending: number }
    >();
    for (const invoice of pendingInvoices) {
      const shopId = invoice.shop_id || invoice.shop?.id;
      if (!shopId) continue;
      const remaining = Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid || 0));
      if (remaining <= 0.01) continue;
      const existing = map.get(shopId);
      if (existing) {
        existing.invoices.push(invoice);
        existing.totalPending += remaining;
      } else {
        map.set(shopId, {
          shopId,
          shopName: invoice.shop?.name || "Unknown shop",
          invoices: [invoice],
          totalPending: remaining,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalPending - a.totalPending);
  }, [pendingInvoices]);

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
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["pending-payments"] });
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

  const remainingForPayment = paymentInvoice
    ? Math.max(0, Number(paymentInvoice.total_amount) - Number(paymentInvoice.amount_paid || 0))
    : 0;

  const creditRemaining = creditInvoice
    ? Math.max(0, Number(creditInvoice.total_amount) - Number(creditInvoice.amount_paid || 0))
    : 0;

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
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setShopPickerOpen(true)}>
                <SplitSquareVertical className="h-4 w-4 mr-2" />
                Distribute by Shop
              </Button>
              <Button variant="outline" onClick={() => setOldBalanceOpen(true)}>
                Old Balance
              </Button>
              <Button
                onClick={() => {
                  resetCreateForm();
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Invoice
              </Button>
            </div>
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

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8}>Loading...</TableCell>
                </TableRow>
              ) : invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>No invoices found</TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => {
                  const paid = Number(invoice.amount_paid || 0);
                  const remaining = Math.max(0, Number(invoice.total_amount) - paid);
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell>{invoice.shop?.name || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(invoice.payment_status)} className="capitalize">
                          {invoice.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell>${Number(invoice.total_amount).toFixed(2)}</TableCell>
                      <TableCell>${paid.toFixed(2)}</TableCell>
                      <TableCell className={remaining > 0 ? "font-semibold" : undefined}>
                        ${remaining.toFixed(2)}
                      </TableCell>
                      <TableCell>{new Date(invoice.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                const full = await api<Invoice>(`/invoices/${invoice.id}`);
                                await downloadInvoicePdf(full);
                              } catch (error: unknown) {
                                const message =
                                  error && typeof error === "object" && "message" in error
                                    ? String((error as ApiError).message)
                                    : "Could not generate PDF";
                                toast({
                                  title: "PDF failed",
                                  description: message,
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            PDF
                          </Button>
                          {canCreate && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={emailingId === invoice.id}
                              onClick={() => emailInvoice(invoice)}
                            >
                              <Mail className="h-4 w-4 mr-1" />
                              {emailingId === invoice.id ? "Sending..." : "Email"}
                            </Button>
                          )}
                          {canCreate && remaining > 0.01 && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCreditInvoice(invoice)}
                              >
                                <Gift className="h-4 w-4 mr-1" />
                                Credit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPaymentInvoice(invoice);
                                  setPayAmount(remaining.toFixed(2));
                                  setPayMethod("cash");
                                  setPayCheckNumber("");
                                  setPayNotes("");
                                }}
                              >
                                <DollarSign className="h-4 w-4 mr-1" />
                                Pay
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
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

      <AddOldBalanceDialog open={oldBalanceOpen} onOpenChange={setOldBalanceOpen} />

      {creditInvoice && (
        <CreditDialog
          open={!!creditInvoice}
          onOpenChange={(open) => !open && setCreditInvoice(null)}
          invoice={creditInvoice}
          remainingAmount={creditRemaining}
        />
      )}

      <Dialog open={shopPickerOpen} onOpenChange={setShopPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Distribute by Shop</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {pendingLoading ? (
              <p className="text-sm text-muted-foreground">Loading pending balances...</p>
            ) : shopsWithPending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shops with unpaid invoices</p>
            ) : (
              shopsWithPending.map((shop) => (
                <button
                  key={shop.shopId}
                  type="button"
                  className="w-full text-left rounded-md border p-3 hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    setShopPickerOpen(false);
                    setDistributeTarget(shop);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{shop.shopName}</p>
                      <p className="text-xs text-muted-foreground">
                        {shop.invoices.length} unpaid/partial invoice
                        {shop.invoices.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="font-semibold text-orange-600">
                      ${shop.totalPending.toFixed(2)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {distributeTarget && (
        <DistributePaymentDialog
          open={!!distributeTarget}
          onOpenChange={(open) => !open && setDistributeTarget(null)}
          shopId={distributeTarget.shopId}
          shopName={distributeTarget.shopName}
          invoices={distributeTarget.invoices}
          totalPending={distributeTarget.totalPending}
          onRefetch={() => {
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
          }}
        />
      )}
    </DashboardLayout>
  );
};

export default Invoices;
