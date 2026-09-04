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
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface CreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: { id: string };
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
      if (!user?.id) throw { message: "User not authenticated" } satisfies ApiError;

      const creditAmount = parseFloat(amount);
      if (!creditAmount || creditAmount <= 0) {
        throw { message: "Please enter a valid credit amount" } satisfies ApiError;
      }
      if (creditAmount > remainingAmount) {
        throw { message: "Credit cannot exceed remaining balance" } satisfies ApiError;
      }

      return api("/payments", {
        method: "POST",
        body: JSON.stringify({
          invoice_id: invoice.id,
          amount: creditAmount,
          payment_method: "credit",
          payment_date: new Date().toISOString().slice(0, 10),
          notes: notes.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Credit applied",
        description: "Credit has been recorded on the invoice",
      });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["pending-payments"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onOpenChange(false);
      setAmount("");
      setNotes("");
    },
    onError: (error: ApiError) => {
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
