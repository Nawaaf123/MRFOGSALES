import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface AddOldBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export const AddOldBalanceDialog = ({
  open,
  onOpenChange,
  onSuccess,
}: AddOldBalanceDialogProps) => {
  const [selectedShopId, setSelectedShopId] = useState("");
  const [shopOpen, setShopOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: shops } = useQuery({
    queryKey: ["shops-for-balance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, city, state")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const selectedShop = shops?.find((s) => s.id === selectedShopId);

  const createOldBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("User not authenticated");
      if (!selectedShopId) throw new Error("Please select a shop");
      if (!amount || parseFloat(amount) <= 0) throw new Error("Please enter a valid amount");

      // Generate invoice number
      const { data: invoiceNumber, error: invoiceNumberError } = await supabase
        .rpc("generate_invoice_number");
      
      if (invoiceNumberError) throw invoiceNumberError;

      // Create the old balance invoice (no invoice items needed)
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          shop_id: selectedShopId,
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
        description: `Old balance of $${parseFloat(amount).toFixed(2)} added for ${selectedShop?.name}`,
      });
      setSelectedShopId("");
      setAmount("");
      setNotes("");
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add old balance",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createOldBalanceMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Old Balance</DialogTitle>
          <DialogDescription>
            Add an old/legacy balance for a shop from previous records
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Select Shop</Label>
              <Popover open={shopOpen} onOpenChange={setShopOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={shopOpen}
                    className="w-full justify-between"
                  >
                    {selectedShop
                      ? `${selectedShop.name}${selectedShop.city ? ` - ${selectedShop.city}` : ""}`
                      : "Search and select a shop..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search shops..." />
                    <CommandList>
                      <CommandEmpty>No shop found.</CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-auto">
                        {shops?.map((shop) => (
                          <CommandItem
                            key={shop.id}
                            value={`${shop.name} ${shop.city || ""} ${shop.state || ""}`}
                            onSelect={() => {
                              setSelectedShopId(shop.id);
                              setShopOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedShopId === shop.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{shop.name}</span>
                              {(shop.city || shop.state) && (
                                <span className="text-xs text-muted-foreground">
                                  {[shop.city, shop.state].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="balance-amount">Old Balance Amount ($)</Label>
              <Input
                id="balance-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Enter old balance amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                This is the amount the shop owes from previous records before using this system
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="balance-notes">Notes (optional)</Label>
              <Textarea
                id="balance-notes"
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
              disabled={createOldBalanceMutation.isPending || !selectedShopId || !amount}
            >
              {createOldBalanceMutation.isPending ? "Adding..." : "Add Old Balance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
