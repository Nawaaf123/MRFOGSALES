import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, Edit, DollarSign, Download, Trash2, Mail, Loader2, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ShopInvoiceGroup } from "./ShopInvoiceGroup";
import { DistributePaymentDialog } from "./DistributePaymentDialog";
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
import { Label } from "@/components/ui/label";
import { PaymentDialog } from "./PaymentDialog";
import { CreditDialog } from "./CreditDialog";
import { generateInvoicePDF, saveInvoicePDF } from "@/lib/pdfGenerator";
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

interface InvoiceTableProps {
  invoices: any[];
  onEdit: (invoice: any) => void;
  isAdmin: boolean;
  onRefetch: () => void;
  profiles?: { id: string; full_name: string }[];
}

export const InvoiceTable = ({ invoices, onEdit, isAdmin, onRefetch, profiles }: InvoiceTableProps) => {
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [distributeDialogOpen, setDistributeDialogOpen] = useState(false);
  const [selectedShopInvoices, setSelectedShopInvoices] = useState<any[]>([]);
  const [selectedShopName, setSelectedShopName] = useState("");
  const [selectedShopPending, setSelectedShopPending] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch payments for the invoices currently shown. We chunk the invoice IDs so the
  // request URL stays short, and page through results so we are never capped by the
  // 1000-row PostgREST limit (which previously made recent payments look missing).
  const invoiceIds = (invoices || []).map((inv: any) => inv.id);
  const { data: allPayments } = useQuery({
    queryKey: ["all-invoice-payments", invoiceIds],
    queryFn: async () => {
      const results: { invoice_id: string; amount: number }[] = [];
      const CHUNK = 100;
      for (let i = 0; i < invoiceIds.length; i += CHUNK) {
        const chunk = invoiceIds.slice(i, i + CHUNK);
        let from = 0;
        const PAGE = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("payments")
            .select("invoice_id, amount")
            .in("invoice_id", chunk)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          results.push(...((data || []) as any));
          if (!data || data.length < PAGE) break;
          from += PAGE;
        }
      }
      return results;
    },
    enabled: invoiceIds.length > 0,
  });


  // Calculate pending amount for an invoice
  const getPendingAmount = (invoiceId: string, totalAmount: number) => {
    const invoicePayments = allPayments?.filter(p => p.invoice_id === invoiceId) || [];
    const totalPaid = invoicePayments.reduce((sum, p) => sum + Number(p.amount), 0);
    return totalAmount - totalPaid;
  };

  const { data: payments } = useQuery({
    queryKey: ["payments", selectedInvoice?.id],
    queryFn: async () => {
      if (!selectedInvoice?.id) return [];
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", selectedInvoice.id)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedInvoice?.id && viewDialogOpen,
  });

  const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
  const remainingAmount = selectedInvoice ? Number(selectedInvoice.total_amount) - totalPaid : 0;

  const updatePaymentMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "paid" | "partial" | "unpaid" }) => {
      const { error } = await supabase
        .from("invoices")
        .update({ payment_status: status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Success",
        description: "Payment status updated successfully",
      });
      setPaymentDialogOpen(false);
      onRefetch();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update payment status",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await supabase
        .from("invoices")
        .delete()
        .eq("id", invoiceId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("You don't have permission to delete this invoice.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Success",
        description: "Invoice deleted successfully",
      });
      setDeleteDialogOpen(false);
      setSelectedInvoice(null);
      onRefetch();
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to delete invoice",
        variant: "destructive",
      });
    },
  });

  const handleViewInvoice = async (invoice: any) => {
    const { data: items } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", invoice.id);

    setSelectedInvoice({ ...invoice, items });
    setViewDialogOpen(true);
  };

  const handleRecordPayment = (invoice: any) => {
    setSelectedInvoice(invoice);
    setPaymentDialogOpen(true);
  };

  const handleUpdateStatus = (invoice: any) => {
    setSelectedInvoice(invoice);
    setPaymentStatus(invoice.payment_status);
    setStatusDialogOpen(true);
  };

  const handleExportPDF = async (invoice: any) => {
    try {
      // Fetch invoice items
      const { data: items } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      // Fetch payments
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("payment_date", { ascending: false });

      const totalPaid = paymentsData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      const remainingAmount = Number(invoice.total_amount) - totalPaid;

      saveInvoicePDF(
        {
          ...invoice,
          items: items || [],
          payments: paymentsData || [],
        },
        totalPaid,
        remainingAmount
      );

      toast({
        title: "Success",
        description: "Invoice PDF downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate PDF",
        variant: "destructive",
      });
    }
  };

  const handleSendEmail = async (invoice: any) => {
    // Check if shop has email
    if (!invoice.shops?.email) {
      toast({
        title: "No Email",
        description: "This shop doesn't have an email address",
        variant: "destructive",
      });
      return;
    }

    setSendingEmailId(invoice.id);
    
    try {
      // Fetch invoice items
      const { data: items } = await supabase
        .from("invoice_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      // Fetch payments
      const { data: paymentsData } = await supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", invoice.id)
        .order("payment_date", { ascending: false });

      const totalPaid = paymentsData?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      const remainingAmount = Number(invoice.total_amount) - totalPaid;

      // Generate PDF
      const doc = generateInvoicePDF(
        {
          ...invoice,
          items: items || [],
          payments: paymentsData || [],
        },
        totalPaid,
        remainingAmount
      );

      // Convert to base64
      const pdfDoc = await doc;
      const pdfBase64 = pdfDoc.output('datauristring').split(',')[1];

      // Send email via edge function
      const { data, error } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          to: invoice.shops.email,
          invoiceNumber: invoice.invoice_number,
          shopName: invoice.shops.name,
          totalAmount: Number(invoice.total_amount),
          pdfBase64,
        },
      });

      if (error) throw error;

      toast({
        title: "Email Sent",
        description: `Invoice sent to ${invoice.shops.email}`,
      });
    } catch (error: any) {
      console.error("Error sending email:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to send email",
        variant: "destructive",
      });
    } finally {
      setSendingEmailId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      paid: "default",
      partial: "secondary",
      unpaid: "destructive",
    };

    const className =
      status === "paid"
        ? "border-transparent bg-green-600 text-white hover:bg-green-600/80"
        : "";

    return (
      <Badge variant={variants[status] || "default"} className={className}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  // Group invoices by shop
  const groupedInvoices = invoices.reduce((acc, invoice) => {
    const shopId = invoice.shop_id;
    if (!acc[shopId]) {
      acc[shopId] = {
        shopName: invoice.shops?.name || "Unknown Shop",
        shopLocation: [
          invoice.shops?.city,
          invoice.shops?.state,
          invoice.shops?.zip_code,
        ].filter(Boolean).join(", ") || "N/A",
        invoices: [],
      };
    }
    acc[shopId].invoices.push(invoice);
    return acc;
  }, {} as Record<string, { shopName: string; shopLocation: string; invoices: any[] }>);

  const handleDistributePayment = (shopName: string, invoices: any[], totalPending: number) => {
    setSelectedShopName(shopName);
    setSelectedShopInvoices(invoices);
    setSelectedShopPending(totalPending);
    setDistributeDialogOpen(true);
  };

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No invoices found</p>
        <p className="text-sm text-muted-foreground mt-1">
          Create your first invoice to get started
        </p>
      </div>
    );
  }

  type GroupData = { shopName: string; shopLocation: string; invoices: any[] };

  return (
    <>
      <div className="space-y-4">
        {(Object.entries(groupedInvoices) as [string, GroupData][]).map(([shopId, groupData]) => {
          const { shopName, shopLocation, invoices: shopInvoices } = groupData;
          return (
            <ShopInvoiceGroup
              key={shopId}
              shopId={shopId}
              shopName={shopName}
              shopLocation={shopLocation}
              invoices={shopInvoices}
              allPayments={allPayments || []}
              onViewInvoice={handleViewInvoice}
              onRecordPayment={handleRecordPayment}
              onUpdateStatus={handleUpdateStatus}
              onEditInvoice={onEdit}
              onExportPDF={handleExportPDF}
              onSendEmail={handleSendEmail}
              sendingEmailId={sendingEmailId}
              onDeleteInvoice={(invoice) => {
                setSelectedInvoice(invoice);
                setDeleteDialogOpen(true);
              }}
              onDistributePayment={handleDistributePayment}
              isAdmin={isAdmin}
              profiles={profiles}
              onRefetch={onRefetch}
            />
          );
        })}
      </div>

      {/* View Invoice Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Invoice Details - {selectedInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Shop</p>
                  <p className="font-medium text-sm sm:text-base">{selectedInvoice.shops?.name}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Date</p>
                  <p className="font-medium text-sm sm:text-base">
                    {new Date(selectedInvoice.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {(() => {
                const discountAmt = Number(selectedInvoice.discount_amount || 0);
                const creditAmt = (payments || [])
                  .filter((p: any) => p.payment_method === 'credit')
                  .reduce((s: number, p: any) => s + Number(p.amount), 0);
                const subtotal = Number(selectedInvoice.total_amount) + discountAmt;
                return (
                  <div className="p-3 sm:p-4 bg-muted rounded-lg mb-4 space-y-3">
                    <div className="grid grid-cols-3 gap-2 sm:gap-4">
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Total</p>
                        <p className="text-base sm:text-xl font-bold">${Number(selectedInvoice.total_amount).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Paid</p>
                        <p className="text-base sm:text-xl font-bold text-green-600">${totalPaid.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs sm:text-sm text-muted-foreground">Due</p>
                        <p className="text-base sm:text-xl font-bold text-orange-600">${remainingAmount.toFixed(2)}</p>
                      </div>
                    </div>
                    {(discountAmt > 0 || creditAmt > 0) && (
                      <div className="pt-3 border-t space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-medium">${subtotal.toFixed(2)}</span>
                        </div>
                        {discountAmt > 0 && (
                          <div className="flex justify-between text-blue-600">
                            <span>Discount</span>
                            <span className="font-medium">- ${discountAmt.toFixed(2)}</span>
                          </div>
                        )}
                        {creditAmt > 0 && (
                          <div className="flex justify-between text-orange-600">
                            <span className="flex items-center gap-1"><Gift className="h-3.5 w-3.5" /> Credit Given</span>
                            <span className="font-medium">${creditAmt.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <p className="text-sm text-muted-foreground mb-2">Items</p>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Unit Price</TableHead>
                        <TableHead>Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedInvoice.items?.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.product_name}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>${parseFloat(item.unit_price).toFixed(2)}</TableCell>
                          <TableCell>${parseFloat(item.subtotal).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {payments && payments.length > 0 && (
                <>
                  {/* Payment Method Breakdown - Admin Only */}
                  {isAdmin && (
                    <div className="mb-4">
                      <p className="text-xs sm:text-sm text-muted-foreground mb-2">Payment Breakdown</p>
                      <div className="grid grid-cols-3 gap-2 sm:gap-4">
                        <div className="border rounded-lg p-2 sm:p-4 bg-muted/50">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <span className="text-xs sm:text-sm font-medium">Cash</span>
                            <Badge variant="outline" className="text-xs w-fit">
                              {payments.filter(p => p.payment_method === 'cash').length}
                            </Badge>
                          </div>
                          <p className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2 text-green-600">
                            ${payments
                              .filter(p => p.payment_method === 'cash')
                              .reduce((sum, p) => sum + Number(p.amount), 0)
                              .toFixed(2)}
                          </p>
                        </div>
                        <div className="border rounded-lg p-2 sm:p-4 bg-muted/50">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <span className="text-xs sm:text-sm font-medium">Check</span>
                            <Badge variant="outline" className="text-xs w-fit">
                              {payments.filter(p => p.payment_method === 'check').length}
                            </Badge>
                          </div>
                          <p className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2 text-blue-600">
                            ${payments
                              .filter(p => p.payment_method === 'check')
                              .reduce((sum, p) => sum + Number(p.amount), 0)
                              .toFixed(2)}
                          </p>
                        </div>
                        <div className="border rounded-lg p-2 sm:p-4 bg-muted/50">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <span className="text-xs sm:text-sm font-medium">Credit</span>
                            <Badge variant="outline" className="text-xs w-fit">
                              {payments.filter(p => p.payment_method === 'credit').length}
                            </Badge>
                          </div>
                          <p className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2 text-orange-600">
                            ${payments
                              .filter(p => p.payment_method === 'credit')
                              .reduce((sum, p) => sum + Number(p.amount), 0)
                              .toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Mobile Payment History */}
                  <div className="mb-4">
                    <p className="text-xs sm:text-sm text-muted-foreground mb-2">Payment History</p>
                    
                    {/* Mobile: Card view */}
                    <div className="sm:hidden space-y-2">
                      {payments.map((payment) => (
                        <div key={payment.id} className="border rounded-lg p-3 bg-muted/30">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold">${Number(payment.amount).toFixed(2)}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(payment.payment_date), "MMM d, yyyy")}
                              </p>
                            </div>
                            <Badge variant="outline" className="capitalize text-xs">
                              {payment.payment_method}
                            </Badge>
                          </div>
                          {payment.check_number && (
                            <p className="text-xs text-muted-foreground mt-1">Check #{payment.check_number}</p>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Desktop: Table view */}
                    <div className="hidden sm:block border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Method</TableHead>
                            <TableHead>Check #</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.map((payment) => (
                            <TableRow key={payment.id}>
                              <TableCell>
                                {format(new Date(payment.payment_date), "MMM d, yyyy h:mm a")}
                              </TableCell>
                              <TableCell className="font-semibold">
                                ${Number(payment.amount).toFixed(2)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">
                                  {payment.payment_method}
                                </Badge>
                              </TableCell>
                              <TableCell>{payment.check_number || "-"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {payment.notes || "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}

              {selectedInvoice.notes && (
                <div>
                  <p className="text-sm text-muted-foreground">Notes</p>
                  <p className="text-sm">{selectedInvoice.notes}</p>
                </div>
              )}

              {remainingAmount > 0 && (
                <div className="flex flex-col sm:flex-row justify-center sm:justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCreditDialogOpen(true)}
                    className="w-full sm:w-auto"
                  >
                    <Gift className="h-4 w-4 mr-2" />
                    Give Credit
                  </Button>
                  <Button onClick={() => handleRecordPayment(selectedInvoice)} className="w-full sm:w-auto">
                    <DollarSign className="h-4 w-4 mr-2" />
                    Record Payment
                  </Button>
                </div>
              )}

              <div className="flex justify-between items-center p-3 sm:p-4 bg-muted rounded-lg mt-4">
                <span className="font-semibold text-sm sm:text-base">Total Amount:</span>
                <span className="text-lg sm:text-xl font-bold text-primary">
                  ${parseFloat(selectedInvoice.total_amount).toFixed(2)}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-2 mt-4 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => handleExportPDF(selectedInvoice)}
                  className="w-full sm:w-auto"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Update Payment Status Dialog - Admin Only */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Payment Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Payment Status</Label>
              <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setStatusDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  updatePaymentMutation.mutate({
                    id: selectedInvoice.id,
                    status: paymentStatus as "paid" | "partial" | "unpaid",
                  })
                }
                disabled={updatePaymentMutation.isPending}
              >
                {updatePaymentMutation.isPending ? "Updating..." : "Update Status"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      {selectedInvoice && (
        <PaymentDialog
          open={paymentDialogOpen}
          onOpenChange={(open) => {
            setPaymentDialogOpen(open);
            if (!open) {
              queryClient.invalidateQueries({ queryKey: ["payments"] });
              onRefetch();
            }
          }}
          invoice={selectedInvoice}
          remainingAmount={remainingAmount}
        />
      )}

      {/* Give Credit Dialog */}
      {selectedInvoice && (
        <CreditDialog
          open={creditDialogOpen}
          onOpenChange={(open) => {
            setCreditDialogOpen(open);
            if (!open) {
              queryClient.invalidateQueries({ queryKey: ["payments"] });
              onRefetch();
            }
          }}
          invoice={selectedInvoice}
          remainingAmount={remainingAmount}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete invoice {selectedInvoice?.invoice_number}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedInvoice && deleteMutation.mutate(selectedInvoice.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Distribute Payment Dialog */}
      <DistributePaymentDialog
        open={distributeDialogOpen}
        onOpenChange={setDistributeDialogOpen}
        shopName={selectedShopName}
        invoices={selectedShopInvoices}
        totalPending={selectedShopPending}
        onRefetch={onRefetch}
      />
    </>
  );
};
