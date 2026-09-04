import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus } from "lucide-react";

interface InventoryDialogProps {
  product: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const InventoryDialog = ({ product, open, onOpenChange }: InventoryDialogProps) => {
  const [quantity, setQuantity] = useState(0);
  const [warehouse, setWarehouse] = useState<"A" | "B">("A");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const adjustInventoryMutation = useMutation({
    mutationFn: async ({ add }: { add: boolean }) => {
      const delta = add ? quantity : -quantity;
      const { error } = await supabase.rpc("update_product_stock" as any, {
        p_product_id: product.id,
        p_quantity: delta,
        p_warehouse: warehouse,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-products"] });
      toast({ title: "Success", description: `Warehouse ${warehouse} inventory updated` });
      setQuantity(0);
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update inventory", variant: "destructive" });
    },
  });

  if (!product) return null;

  const currentA = product.stock_quantity ?? 0;
  const currentB = product.stock_quantity_b ?? 0;
  const displayed = warehouse === "A" ? currentA : currentB;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Inventory - {product.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Warehouse A</p>
              <p className="text-2xl font-bold">{currentA}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">Warehouse B</p>
              <p className="text-2xl font-bold">{currentB}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Adjust which warehouse?</Label>
            <RadioGroup value={warehouse} onValueChange={(v) => setWarehouse(v as "A" | "B")} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="A" id="wh-a" />
                <Label htmlFor="wh-a" className="font-normal cursor-pointer">Warehouse A</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="B" id="wh-b" />
                <Label htmlFor="wh-b" className="font-normal cursor-pointer">Warehouse B</Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">Current in Warehouse {warehouse}: {displayed}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="Enter quantity"
            />
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => adjustInventoryMutation.mutate({ add: true })}
              disabled={quantity === 0 || adjustInventoryMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Stock
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              onClick={() => adjustInventoryMutation.mutate({ add: false })}
              disabled={quantity === 0 || adjustInventoryMutation.isPending}
            >
              <Minus className="mr-2 h-4 w-4" /> Remove Stock
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
