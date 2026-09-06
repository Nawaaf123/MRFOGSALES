import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  DollarSign,
  Plus,
  Eye,
  Download,
  Trash2,
  Mail,
  Loader2,
  RefreshCw,
} from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { AddLegacyBalanceDialog } from "./AddLegacyBalanceDialog";

export type ShopGroupInvoice = {
  id: string;
  invoice_number: string;
  shop_id: string;
  created_by: string | null;
  total_amount: number;
  payment_status: "paid" | "partial" | "unpaid";
  created_at: string;
  amount_paid: number;
  /** Present when this row is a local offline create waiting to upload. */
  local_sync?: "pending" | "syncing" | "failed";
  local_sync_error?: string | null;
  client_request_id?: string;
};

interface ShopInvoiceGroupProps {
  shopId: string;
  shopName: string;
  shopLocation: string;
  invoices: ShopGroupInvoice[];
  onViewInvoice: (invoice: ShopGroupInvoice) => void;
  onRecordPayment: (invoice: ShopGroupInvoice) => void;
  onExportPDF: (invoice: ShopGroupInvoice) => void;
  onSendEmail: (invoice: ShopGroupInvoice) => void;
  sendingEmailId: string | null;
  onDeleteInvoice: (invoice: ShopGroupInvoice) => void;
  onRetryLocalSync?: (invoice: ShopGroupInvoice) => void;
  onDiscardLocalSync?: (invoice: ShopGroupInvoice) => void;
  onDistributePayment: (
    shopId: string,
    shopName: string,
    invoices: ShopGroupInvoice[],
    totalPending: number
  ) => void;
  canManage: boolean;
  isAdmin: boolean;
  profiles?: { id: string; full_name: string }[];
  onRefetch?: () => void;
}

function pendingOf(invoice: ShopGroupInvoice) {
  return Math.max(0, Number(invoice.total_amount) - Number(invoice.amount_paid || 0));
}

export const ShopInvoiceGroup = ({
  shopId,
  shopName,
  shopLocation,
  invoices,
  onViewInvoice,
  onRecordPayment,
  onExportPDF,
  onSendEmail,
  sendingEmailId,
  onDeleteInvoice,
  onRetryLocalSync,
  onDiscardLocalSync,
  onDistributePayment,
  canManage,
  isAdmin,
  profiles,
  onRefetch,
}: ShopInvoiceGroupProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [legacyBalanceDialogOpen, setLegacyBalanceDialogOpen] = useState(false);

  const getStatusBadge = (invoice: ShopGroupInvoice) => {
    if (invoice.local_sync === "failed") {
      return <Badge variant="destructive">Sync failed</Badge>;
    }
    if (invoice.local_sync === "syncing") {
      return (
        <Badge className="border-transparent bg-primary/15 text-primary hover:bg-primary/15">
          Syncing…
        </Badge>
      );
    }
    if (invoice.local_sync === "pending") {
      return (
        <Badge className="border-transparent bg-amber-500/15 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200">
          Pending sync
        </Badge>
      );
    }
    if (invoice.payment_status === "paid") {
      return (
        <Badge className="border-transparent bg-primary/15 text-primary hover:bg-primary/15 capitalize">
          Paid
        </Badge>
      );
    }
    if (invoice.payment_status === "partial") {
      return (
        <Badge variant="secondary" className="capitalize">
          Partial
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="capitalize">
        Unpaid
      </Badge>
    );
  };

  const serverInvoices = invoices.filter((inv) => !inv.local_sync);
  const totalAmount = invoices.reduce((sum, inv) => sum + Number(inv.total_amount), 0);
  const totalPending = serverInvoices.reduce((sum, inv) => sum + pendingOf(inv), 0);
  const invoicesWithPending = serverInvoices.filter((inv) => pendingOf(inv) > 0.01);

  const creatorName = (createdBy: string | null) => {
    if (!createdBy) return "Unknown";
    return profiles?.find((p) => p.id === createdBy)?.full_name ?? "Unknown";
  };

  const actionButtons = (invoice: ShopGroupInvoice, outline: boolean) => {
    const variant = outline ? "outline" : "ghost";
    const pending = pendingOf(invoice);
    const btnClass = outline ? "h-10 min-w-10 flex-1 sm:flex-none" : "h-8 w-8 p-0";

    if (invoice.local_sync) {
      return (
        <>
          <Button variant={variant} size="sm" className={btnClass} onClick={() => onViewInvoice(invoice)} title="View">
            <Eye className="h-4 w-4" />
            {outline && <span className="ml-1 sm:hidden text-xs">View</span>}
          </Button>
          {canManage && (
            <Button
              variant={variant}
              size="sm"
              className={btnClass}
              onClick={() => onRetryLocalSync?.(invoice)}
              title="Retry sync"
              disabled={invoice.local_sync === "syncing"}
            >
              {invoice.local_sync === "syncing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {outline && <span className="ml-1 sm:hidden text-xs">Sync</span>}
            </Button>
          )}
          {canManage && (
            <Button
              variant={variant}
              size="sm"
              className={btnClass}
              onClick={() => onDiscardLocalSync?.(invoice)}
              title="Remove from queue"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
              {outline && <span className="ml-1 sm:hidden text-xs text-destructive">Remove</span>}
            </Button>
          )}
        </>
      );
    }

    return (
      <>
        <Button variant={variant} size="sm" className={btnClass} onClick={() => onViewInvoice(invoice)} title="View">
          <Eye className="h-4 w-4" />
          {outline && <span className="ml-1 sm:hidden text-xs">View</span>}
        </Button>
        {canManage && pending > 0.01 && (
          <Button
            variant={variant}
            size="sm"
            className={btnClass}
            onClick={() => onRecordPayment(invoice)}
            title="Record Payment"
          >
            <DollarSign className="h-4 w-4" />
            {outline && <span className="ml-1 sm:hidden text-xs">Pay</span>}
          </Button>
        )}
        <Button
          variant={variant}
          size="sm"
          className={btnClass}
          onClick={() => onExportPDF(invoice)}
          title="Export PDF"
        >
          <Download className="h-4 w-4" />
          {outline && <span className="ml-1 sm:hidden text-xs">PDF</span>}
        </Button>
        {canManage && (
          <Button
            variant={variant}
            size="sm"
            className={btnClass}
            onClick={() => onSendEmail(invoice)}
            title="Send Email"
            disabled={sendingEmailId === invoice.id}
          >
            {sendingEmailId === invoice.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {outline && <span className="ml-1 sm:hidden text-xs">Email</span>}
          </Button>
        )}
        {isAdmin && (
          <Button
            variant={variant}
            size="sm"
            className={btnClass}
            onClick={() => onDeleteInvoice(invoice)}
            title="Delete Invoice"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
            {outline && <span className="ml-1 sm:hidden text-xs text-destructive">Del</span>}
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-primary/15 bg-card shadow-sm shadow-primary/5">
      <div className="border-b border-primary/10 bg-gradient-to-r from-primary/[0.08] to-transparent p-3 md:p-4">
        <div className="flex items-start gap-2 md:gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-11 w-11 p-0 flex-shrink-0 touch-target"
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>

          <div className="flex-1 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-base md:text-lg truncate">{shopName}</h3>
                <p className="text-xs md:text-sm text-muted-foreground truncate">{shopLocation}</p>
                <Badge className="mt-1 bg-primary/15 text-primary hover:bg-primary/15" variant="secondary">
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
                  <p
                    className={`text-lg md:text-xl font-bold tabular-nums ${
                      totalPending > 0 ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    ${totalPending.toFixed(2)}
                  </p>
                </div>
                {canManage && (
                  <div className="flex w-full sm:w-auto gap-2">
                    <Button
                      onClick={() => setLegacyBalanceDialogOpen(true)}
                      size="sm"
                      variant="outline"
                      className="flex-1 sm:flex-none h-10"
                      title="Add old/legacy balance for this shop"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Old Balance</span>
                      <span className="sm:hidden">Balance</span>
                    </Button>
                    {totalPending > 0.01 && (
                      <Button
                        onClick={() =>
                          onDistributePayment(shopId, shopName, invoicesWithPending, totalPending)
                        }
                        size="sm"
                        className="h-10 flex-1 sm:flex-none bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <DollarSign className="h-4 w-4 mr-1" />
                        Pay
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          <div className="md:hidden p-3 space-y-3">
            {invoices.map((invoice) => {
              const pendingAmount = pendingOf(invoice);
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
                      {getStatusBadge(invoice)}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      <div>
                        <span className="text-muted-foreground">Amount</span>
                        <p className="font-semibold">${Number(invoice.total_amount).toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Pending</span>
                        <p
                          className={`font-semibold tabular-nums ${
                            pendingAmount > 0 ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          ${pendingAmount.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {invoice.local_sync_error && (
                      <p className="mb-2 text-xs text-destructive">{invoice.local_sync_error}</p>
                    )}

                    <div className="flex flex-wrap gap-1 border-t pt-2">
                      {actionButtons(invoice, true)}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
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
                  const pendingAmount = pendingOf(invoice);
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell>{new Date(invoice.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="font-semibold">
                        ${Number(invoice.total_amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-semibold ${
                            pendingAmount > 0 ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          ${pendingAmount.toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {getStatusBadge(invoice)}
                          {invoice.local_sync_error && (
                            <p className="max-w-[12rem] text-xs text-destructive">{invoice.local_sync_error}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{creatorName(invoice.created_by)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">{actionButtons(invoice, false)}</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {canManage && (
        <AddLegacyBalanceDialog
          open={legacyBalanceDialogOpen}
          onOpenChange={setLegacyBalanceDialogOpen}
          shopId={shopId}
          shopName={shopName}
          onSuccess={onRefetch}
        />
      )}
    </div>
  );
};
