import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface QuickAddProductProps {
  categoryFilter: string;
  subcategoryFilter: string;
  subSubcategoryFilter: string;
}

export const QuickAddProduct = ({
  categoryFilter,
  subcategoryFilter,
  subSubcategoryFilter,
}: QuickAddProductProps) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const productData = {
        name: name.trim(),
        price: parseFloat(price) || 0,
        stock_quantity: parseInt(stock) || 0,
        category: categoryFilter !== "all" ? categoryFilter : "Uncategorized",
        subcategory: subcategoryFilter !== "all" ? subcategoryFilter : null,
        sub_subcategory: subSubcategoryFilter !== "all" ? subSubcategoryFilter : null,
      };

      const { error } = await supabase.from("products").insert(productData);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Product added",
        description: `${name} has been added successfully`,
      });
      setName("");
      setPrice("");
      setStock("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["allProducts"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add product",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Product name is required",
        variant: "destructive",
      });
      return;
    }
    if (!price || parseFloat(price) <= 0) {
      toast({
        title: "Error",
        description: "Price must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    mutation.mutate();
  };

  const categoryLabel = subSubcategoryFilter !== "all" 
    ? subSubcategoryFilter 
    : subcategoryFilter !== "all" 
      ? subcategoryFilter 
      : categoryFilter !== "all" 
        ? categoryFilter 
        : "Uncategorized";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 bg-muted/50 rounded-lg border">
      <span className="text-sm text-muted-foreground hidden sm:block whitespace-nowrap">
        Quick add to <span className="font-medium text-foreground">{categoryLabel}</span>:
      </span>
      <Input
        placeholder="Product name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 min-w-[150px]"
      />
      <Input
        type="number"
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        step="0.01"
        min="0"
        className="w-full sm:w-24"
      />
      <Input
        type="number"
        placeholder="Stock"
        value={stock}
        onChange={(e) => setStock(e.target.value)}
        min="0"
        className="w-full sm:w-24"
      />
      <Button type="submit" size="sm" disabled={mutation.isPending} className="whitespace-nowrap">
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </form>
  );
};
