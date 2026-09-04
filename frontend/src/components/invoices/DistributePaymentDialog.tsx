import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type PendingInvoice = {
  id: string;
  invoice_number: string;
  payment_status: string;
  created_at?: string;
};

interface DistributePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  shopName: string;
  invoices: PendingInvoice[];
  totalPending: number;
  onRefetch: () => void;
}

export const DistributePaymentDialog = ({
  open,
  onOpenChange,
  shopId,
  shopName,
  invoices,
  totalPending,
  onRefetch,
}: DistributePaymentDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "check">("cash");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [checkNumber, setCheckNumber] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setAmount("");
    setPaymentMethod("cash");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setCheckNumber("");
    setNotes("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const paymentAmount = parseFloat(amount);

      if (!paymentAmount || paymentAmount <= 0) {
        throw { message: "Please enter a valid amount" } satisfies ApiError;
      }

      if (paymentAmount > totalPending + 0.01) {
        throw { message: "Payment amount cannot exceed total pending balance" } satisfies ApiError;
      }

      if (!shopId) {
        throw { message: "Shop is required" } satisfies ApiError;
      }

      return api<{ payments_created: number; amount_applied: number }>("/payments/distribute", {
        method: "POST",
        body: JSON.stringify({
          shop_id: shopId,
          amount: paymentAmount,
          payment_method: paymentMethod,
          payment_date: paymentDate || null,
          check_number: paymentMethod === "check" ? checkNumber.trim() || null : null,
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: (result) => {
      toast({
        title: "Success",
        description: `Distributed $${Number(result.amount_applied).toFixed(2)} across ${result.payments_created} payment(s)`,
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["recent-invoices"] });
      onRefetch();
      onOpenChange(false);
      resetForm();
    },
    onError: (error: ApiError) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record payment",
        variant: "destructive",
      });
    },
  });

  const previewInvoices = [...invoices].sort((a, b) => {
    if (a.payment_status === "unpaid" && b.payment_status !== "unpaid") return -1;
    if (a.payment_status !== "unpaid" && b.payment_status === "unpaid") return 1;
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return aTime - bTime;
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Distribute Payment - {shopName}</DialogTitle>
          <DialogDescription>
            Payment will be distributed across {invoices.length} invoice(s) automatically,
            starting with unpaid invoices first.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Total Pending Amount</Label>
            <div className="text-2xl font-bold text-orange-600">${totalPending.toFixed(2)}</div>
          </div>

          <div className="space-y-2">
            <Label>Payment Amount</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select
              value={paymentMethod}
              onValueChange={(value: "cash" | "check") => setPaymentMethod(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="check">Check</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Payment Date</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          {paymentMethod === "check" && (
            <div className="space-y-2">
              <Label>Check Number</Label>
              <Input
                placeholder="Enter check number"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              placeholder="Add any notes about this payment"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="bg-muted p-3 rounded-lg space-y-2">
            <p className="text-sm font-medium">Payment Distribution Preview</p>
            <p className="text-xs text-muted-foreground">
              Payment will be applied to invoices in this order:
            </p>
            <div className="space-y-1">
              {previewInvoices.slice(0, 3).map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-xs">
                  <span>{inv.invoice_number}</span>
                  <Badge
                    variant={inv.payment_status === "unpaid" ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {inv.payment_status}
                  </Badge>
                </div>
              ))}
              {previewInvoices.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  ...and {previewInvoices.length - 3} more
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !shopId}>
              {mutation.isPending ? "Processing..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
