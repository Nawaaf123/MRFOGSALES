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

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
  remainingAmount: number;
}

export const PaymentDialog = ({
  open,
  onOpenChange,
  invoice,
  remainingAmount,
}: PaymentDialogProps) => {
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
      
      if (paymentAmount > remainingAmount) {
        throw new Error("Payment amount cannot exceed remaining balance");
      }

      // Insert payment record
      const { error: paymentError } = await supabase
        .from("payments")
        .insert({
          invoice_id: invoice.id,
          amount: paymentAmount,
          payment_method: paymentMethod,
          check_number: paymentMethod === "check" ? checkNumber : null,
          notes: notes || null,
          created_by: user?.id,
        });

      if (paymentError) throw paymentError;

      // Calculate total paid (including the payment we just inserted)
      const { data: payments } = await supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", invoice.id);

      const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      
      // Determine status: partial until full amount is paid
      let newStatus: "paid" | "partial" | "unpaid";
      if (totalPaid >= Number(invoice.total_amount)) {
        newStatus = "paid";
      } else if (totalPaid > 0) {
        newStatus = "partial";
      } else {
        newStatus = "unpaid";
      }

      const { error: statusError } = await supabase
        .from("invoices")
        .update({ payment_status: newStatus })
        .eq("id", invoice.id);

      if (statusError) throw statusError;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Payment recorded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-invoice-payments"] });
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
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Remaining Balance</Label>
            <div className="text-2xl font-bold text-primary">
              ${remainingAmount.toFixed(2)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Payment Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              required
            />
            <p className="text-sm text-muted-foreground">
              Maximum: ${remainingAmount.toFixed(2)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="method">Payment Method *</Label>
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
              <Label htmlFor="checkNumber">Check Number</Label>
              <Input
                id="checkNumber"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
                placeholder="Enter check number"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
