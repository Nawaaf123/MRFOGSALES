import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AddCategoryDialogProps {
  categories: string[];
  subcategoriesMap: Record<string, string[]>;
}

export const AddCategoryDialog = ({ categories, subcategoriesMap }: AddCategoryDialogProps) => {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"category" | "subcategory" | "sub_subcategory">("category");
  const [name, setName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubcategory, setSelectedSubcategory] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const subcategories = selectedCategory ? (subcategoriesMap[selectedCategory] || []) : [];

  const mutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name is required");

      // Create a placeholder product with the new category
      const productData: any = {
        name: `_placeholder_${Date.now()}`,
        price: 0,
        stock_quantity: 0,
        is_active: false,
      };

      if (type === "category") {
        productData.category = name.trim();
      } else if (type === "subcategory") {
        if (!selectedCategory) throw new Error("Please select a category");
        productData.category = selectedCategory;
        productData.subcategory = name.trim();
      } else {
        if (!selectedCategory) throw new Error("Please select a category");
        if (!selectedSubcategory) throw new Error("Please select a subcategory");
        productData.category = selectedCategory;
        productData.subcategory = selectedSubcategory;
        productData.sub_subcategory = name.trim();
      }

      const { error } = await supabase.from("products").insert(productData);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: `${type === "category" ? "Category" : type === "subcategory" ? "Subcategory" : "Sub-subcategory"} added successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["allProducts"] });
      queryClient.invalidateQueries({ queryKey: ["allProductCategories"] });
      setOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add category",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setType("category");
    setName("");
    setSelectedCategory("");
    setSelectedSubcategory("");
  };

  const handleTypeChange = (value: "category" | "subcategory" | "sub_subcategory") => {
    setType(value);
    setName("");
    if (value === "category") {
      setSelectedCategory("");
      setSelectedSubcategory("");
    } else if (value === "subcategory") {
      setSelectedSubcategory("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FolderPlus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Category</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Category</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="subcategory">Subcategory</SelectItem>
                <SelectItem value="sub_subcategory">Sub-subcategory</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(type === "subcategory" || type === "sub_subcategory") && (
            <div className="space-y-2">
              <Label>Parent Category</Label>
              <Select value={selectedCategory} onValueChange={(v) => { setSelectedCategory(v); setSelectedSubcategory(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "sub_subcategory" && selectedCategory && (
            <div className="space-y-2">
              <Label>Parent Subcategory</Label>
              <Select value={selectedSubcategory} onValueChange={setSelectedSubcategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {subcategories.map((sub) => (
                    <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>
              {type === "category" ? "Category" : type === "subcategory" ? "Subcategory" : "Sub-subcategory"} Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Enter ${type === "category" ? "category" : type === "subcategory" ? "subcategory" : "sub-subcategory"} name`}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
