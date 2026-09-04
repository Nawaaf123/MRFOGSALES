import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface AddLegacyBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  shopName: string;
  onSuccess?: () => void;
}

export const AddLegacyBalanceDialog = ({
  open,
  onOpenChange,
  shopId,
  shopName,
  onSuccess,
}: AddLegacyBalanceDialogProps) => {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const createLegacyBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("User not authenticated");
      if (!amount || parseFloat(amount) <= 0) throw new Error("Please enter a valid amount");

      // Generate invoice number
      const { data: invoiceNumber, error: invoiceNumberError } = await supabase
        .rpc("generate_invoice_number");
      
      if (invoiceNumberError) throw invoiceNumberError;

      // Create the legacy balance invoice (no invoice items needed for legacy balance)
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          shop_id: shopId,
          created_by: user.id,
          invoice_number: invoiceNumber,
          total_amount: parseFloat(amount),
          payment_status: "unpaid",
          notes: notes ? `[LEGACY BALANCE] ${notes}` : "[LEGACY BALANCE] Opening balance from previous records",
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Success",
        description: "Legacy balance added successfully",
      });
      setAmount("");
      setNotes("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add legacy balance",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLegacyBalanceMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Legacy Balance</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div>
              <Label className="text-sm text-muted-foreground">Shop</Label>
              <p className="font-medium">{shopName}</p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="amount">Old Balance Amount ($)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter old balance amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Enter the total old/legacy balance that this shop owes from previous records
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes about this old balance..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createLegacyBalanceMutation.isPending || !amount}
            >
              {createLegacyBalanceMutation.isPending ? "Adding..." : "Add Legacy Balance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
