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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";

interface DistributePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopName: string;
  invoices: any[];
  totalPending: number;
  onRefetch: () => void;
}

export const DistributePaymentDialog = ({
  open,
  onOpenChange,
  shopName,
  invoices,
  totalPending,
  onRefetch,
}: DistributePaymentDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "check">("cash");
  const [checkNumber, setCheckNumber] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const paymentAmount = parseFloat(amount);
      
      if (!paymentAmount || paymentAmount <= 0) {
        throw new Error("Please enter a valid amount");
      }
      
      if (paymentAmount > totalPending) {
        throw new Error("Payment amount cannot exceed total pending balance");
      }

      // Sort invoices: unpaid first, then partial, then by oldest
      const sortedInvoices = [...invoices].sort((a, b) => {
        if (a.payment_status === "unpaid" && b.payment_status !== "unpaid") return -1;
        if (a.payment_status !== "unpaid" && b.payment_status === "unpaid") return 1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      let remainingPayment = paymentAmount;

      // Distribute payment across invoices
      for (const invoice of sortedInvoices) {
        if (remainingPayment <= 0) break;

        // Get existing payments for this invoice
        const { data: existingPayments } = await supabase
          .from("payments")
          .select("amount")
          .eq("invoice_id", invoice.id);

        const totalPaid = (existingPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        const invoicePending = Number(invoice.total_amount) - totalPaid;

        if (invoicePending <= 0) continue;

        // Calculate how much to apply to this invoice
        const amountToApply = Math.min(remainingPayment, invoicePending);

        // Insert payment record
        const { error: paymentError } = await supabase
          .from("payments")
          .insert({
            invoice_id: invoice.id,
            amount: amountToApply,
            payment_method: paymentMethod,
            check_number: paymentMethod === "check" ? checkNumber : null,
            notes: notes || null,
            created_by: user?.id,
          });

        if (paymentError) throw paymentError;

        // Update invoice status
        const newTotalPaid = totalPaid + amountToApply;
        let newStatus: "paid" | "partial" | "unpaid";
        
        if (newTotalPaid >= Number(invoice.total_amount)) {
          newStatus = "paid";
        } else if (newTotalPaid > 0) {
          newStatus = "partial";
        } else {
          newStatus = "unpaid";
        }

        const { error: statusError } = await supabase
          .from("invoices")
          .update({ payment_status: newStatus })
          .eq("id", invoice.id);

        if (statusError) throw statusError;

        remainingPayment -= amountToApply;
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Payment distributed successfully across invoices",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-invoice-payments"] });
      onRefetch();
      onOpenChange(false);
      setAmount("");
      setCheckNumber("");
      setNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record payment",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <div className="text-2xl font-bold text-orange-600">
              ${totalPending.toFixed(2)}
            </div>
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
            <Select value={paymentMethod} onValueChange={(value: "cash" | "check") => setPaymentMethod(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="check">Check</SelectItem>
              </SelectContent>
            </Select>
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
              {invoices.slice(0, 3).map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-xs">
                  <span>{inv.invoice_number}</span>
                  <Badge variant={inv.payment_status === "unpaid" ? "destructive" : "secondary"} className="text-xs">
                    {inv.payment_status}
                  </Badge>
                </div>
              ))}
              {invoices.length > 3 && (
                <p className="text-xs text-muted-foreground">
                  ...and {invoices.length - 3} more
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Processing..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
