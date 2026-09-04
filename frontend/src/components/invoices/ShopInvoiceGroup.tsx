import { useState } from "react";
import { ChevronDown, ChevronRight, DollarSign, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, Edit, Download, Trash2, Mail, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AddLegacyBalanceDialog } from "./AddLegacyBalanceDialog";

interface ShopInvoiceGroupProps {
  shopId: string;
  shopName: string;
  shopLocation: string;
  invoices: any[];
  allPayments: any[];
  onViewInvoice: (invoice: any) => void;
  onRecordPayment: (invoice: any) => void;
  onUpdateStatus: (invoice: any) => void;
  onEditInvoice: (invoice: any) => void;
  onExportPDF: (invoice: any) => void;
  onSendEmail: (invoice: any) => void;
  sendingEmailId: string | null;
  onDeleteInvoice: (invoice: any) => void;
  onDistributePayment: (shopName: string, invoices: any[], totalPending: number) => void;
  isAdmin: boolean;
  profiles?: { id: string; full_name: string }[];
  onRefetch?: () => void;
}

export const ShopInvoiceGroup = ({
  shopId,
  shopName,
  shopLocation,
  invoices,
  allPayments,
  onViewInvoice,
  onRecordPayment,
  onUpdateStatus,
  onEditInvoice,
  onExportPDF,
  onSendEmail,
  sendingEmailId,
  onDeleteInvoice,
  onDistributePayment,
  isAdmin,
  profiles,
  onRefetch,
}: ShopInvoiceGroupProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [legacyBalanceDialogOpen, setLegacyBalanceDialogOpen] = useState(false);

  const getPendingAmount = (invoiceId: string, totalAmount: number) => {
    const invoicePayments = allPayments?.filter(p => p.invoice_id === invoiceId) || [];
    const totalPaid = invoicePayments.reduce((sum, p) => sum + Number(p.amount), 0);
    return totalAmount - totalPaid;
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

  // Calculate totals for this shop
  const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const totalPending = invoices.reduce((sum, inv) => {
    return sum + getPendingAmount(inv.id, Number(inv.total_amount));
  }, 0);
  
  // Filter for invoices with pending amounts
  const invoicesWithPending = invoices.filter(inv => 
    getPendingAmount(inv.id, Number(inv.total_amount)) > 0
  );

  return (
    <div className="border rounded-lg mb-4">
      {/* Shop Header */}
      <div className="bg-muted p-3 md:p-4">
        <div className="flex items-start gap-2 md:gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0 flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          
          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-base md:text-lg truncate">{shopName}</h3>
                <p className="text-xs md:text-sm text-muted-foreground truncate">{shopLocation}</p>
                <Badge variant="outline" className="mt-1">
                  {invoices.length} invoice(s)
                </Badge>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 md:gap-4">
                <div className="text-left sm:text-right">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-lg md:text-xl font-bold">${totalAmount.toFixed(2)}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-muted-foreground">Pending</p>
                  <p className={`text-lg md:text-xl font-bold ${totalPending > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                    ${totalPending.toFixed(2)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setLegacyBalanceDialogOpen(true)}
                    size="sm"
                    variant="outline"
                    className="w-full sm:w-auto"
                    title="Add old/legacy balance for this shop"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">Old Balance</span>
                    <span className="sm:hidden">Balance</span>
                  </Button>
                  {totalPending > 0 && (
                    <Button
                      onClick={() => onDistributePayment(shopName, invoicesWithPending, totalPending)}
                      size="sm"
                      className="w-full sm:w-auto"
                    >
                      <DollarSign className="h-4 w-4 mr-1" />
                      Pay
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoices - Mobile Cards */}
      {isExpanded && (
        <>
          <div className="md:hidden p-3 space-y-3">
            {invoices.map((invoice) => {
              const pendingAmount = getPendingAmount(invoice.id, Number(invoice.total_amount));
              return (
                <Card key={invoice.id}>
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-semibold">{invoice.invoice_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(invoice.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      {getStatusBadge(invoice.payment_status)}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      <div>
                        <span className="text-muted-foreground">Amount</span>
                        <p className="font-semibold">${parseFloat(invoice.total_amount).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Pending</span>
                        <p className={`font-semibold ${pendingAmount > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                          ${pendingAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-1 border-t pt-2">
                      <Button variant="outline" size="sm" onClick={() => onViewInvoice(invoice)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {invoice.payment_status !== "paid" && (
                        <Button variant="outline" size="sm" onClick={() => onRecordPayment(invoice)}>
                          <DollarSign className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => onEditInvoice(invoice)} title="Edit Invoice">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => onUpdateStatus(invoice)} title="Update Status">
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => onExportPDF(invoice)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => onSendEmail(invoice)}
                        disabled={sendingEmailId === invoice.id}
                      >
                        {sendingEmailId === invoice.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mail className="h-4 w-4" />
                        )}
                      </Button>
                      {isAdmin && (
                        <Button variant="outline" size="sm" onClick={() => onDeleteInvoice(invoice)} className="text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Invoices - Desktop Table */}
          <div className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Pending</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const pendingAmount = getPendingAmount(invoice.id, Number(invoice.total_amount));
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell>
                        {new Date(invoice.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-semibold">
                        ${parseFloat(invoice.total_amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <span className={`font-semibold ${pendingAmount > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                          ${pendingAmount.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(invoice.payment_status)}</TableCell>
                      <TableCell>
                        {profiles?.find((p) => p.id === invoice.created_by)?.full_name ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewInvoice(invoice)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {invoice.payment_status !== "paid" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onRecordPayment(invoice)}
                              title="Record Payment"
                            >
                              <DollarSign className="h-4 w-4" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditInvoice(invoice)}
                              title="Edit Invoice"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onUpdateStatus(invoice)}
                              title="Update Status"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onExportPDF(invoice)}
                            title="Export PDF"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSendEmail(invoice)}
                            title="Send Email"
                            disabled={sendingEmailId === invoice.id}
                          >
                            {sendingEmailId === invoice.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Mail className="h-4 w-4" />
                            )}
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onDeleteInvoice(invoice)}
                              title="Delete Invoice"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Legacy Balance Dialog */}
      <AddLegacyBalanceDialog
        open={legacyBalanceDialogOpen}
        onOpenChange={setLegacyBalanceDialogOpen}
        shopId={shopId}
        shopName={shopName}
        onSuccess={onRefetch}
      />
    </div>
  );
};
