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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface CreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
  remainingAmount: number;
}

export const CreditDialog = ({
  open,
  onOpenChange,
  invoice,
  remainingAmount,
}: CreditDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const creditAmount = parseFloat(amount);

      if (!creditAmount || creditAmount <= 0) {
        throw new Error("Please enter a valid credit amount");
      }

      if (creditAmount > remainingAmount) {
        throw new Error("Credit cannot exceed remaining balance");
      }

      const { error: paymentError } = await supabase
        .from("payments")
        .insert({
          invoice_id: invoice.id,
          amount: creditAmount,
          payment_method: "credit" as any,
          notes: notes || null,
          created_by: user?.id,
        });

      if (paymentError) throw paymentError;

      const { data: payments } = await supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", invoice.id);

      const totalPaid = (payments || []).reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );

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
        title: "Credit applied",
        description: "Credit has been recorded on the invoice",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["all-invoice-payments"] });
      onOpenChange(false);
      setAmount("");
      setNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to apply credit",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Give Credit</DialogTitle>
          <DialogDescription>
            Credit reduces the remaining balance without recording a cash or
            check payment.
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
            <Label>Remaining Balance</Label>
            <div className="text-2xl font-bold text-primary">
              ${remainingAmount.toFixed(2)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="creditAmount">Credit Amount *</Label>
            <Input
              id="creditAmount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter credit amount"
              required
            />
            <p className="text-sm text-muted-foreground">
              Maximum: ${remainingAmount.toFixed(2)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="creditNotes">Reason / Notes</Label>
            <Textarea
              id="creditNotes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this credit being given?"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Applying..." : "Apply Credit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
