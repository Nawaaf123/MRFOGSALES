import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(100, "Name must be less than 100 characters"),
  price: z.coerce.number().min(0.01, "Price must be greater than 0"),
  category: z.string().trim().min(1, "Category is required").max(50, "Category must be less than 50 characters"),
  subcategory: z.string().trim().min(1, "Subcategory is required").max(50, "Subcategory must be less than 50 characters"),
  sub_subcategory: z.string().trim().max(50, "Sub-subcategory must be less than 50 characters").optional().or(z.literal("")),
  stock_quantity: z.coerce.number().int().min(0, "Stock must be 0 or greater"),
  low_stock_threshold: z.coerce.number().int().min(0, "Threshold must be 0 or greater"),
  image_url: z.string().url("Invalid URL").optional().or(z.literal("")),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductFormProps {
  product?: any;
  prefillCategories?: {
    category?: string;
    subcategory?: string;
    sub_subcategory?: string;
  } | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ProductForm = ({ product, prefillCategories, onSuccess, onCancel }: ProductFormProps) => {
  const { toast } = useToast();
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [subcategoryOpen, setSubcategoryOpen] = useState(false);
  const [subSubcategoryOpen, setSubSubcategoryOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [subcategorySearch, setSubcategorySearch] = useState("");
  const [subSubcategorySearch, setSubSubcategorySearch] = useState("");

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || "",
      price: product?.price || 0,
      category: product?.category || prefillCategories?.category || "",
      subcategory: product?.subcategory || prefillCategories?.subcategory || "",
      sub_subcategory: product?.sub_subcategory || prefillCategories?.sub_subcategory || "",
      stock_quantity: product?.stock_quantity || 0,
      low_stock_threshold: product?.low_stock_threshold || 10,
      image_url: product?.image_url || "",
    },
  });

  const selectedCategory = form.watch("category");
  const selectedSubcategory = form.watch("subcategory");

  // Fetch all existing categories data
  const { data: allProducts } = useQuery({
    queryKey: ["allProductCategories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category, subcategory, sub_subcategory");
      if (error) throw error;
      return data;
    },
  });

  // Get unique categories
  const categories = Array.from(
    new Set(allProducts?.map(p => p.category).filter(Boolean) || [])
  ).sort();

  // Get subcategories for selected category
  const subcategories = selectedCategory
    ? Array.from(
        new Set(
          allProducts
            ?.filter(p => p.category === selectedCategory)
            .map(p => p.subcategory)
            .filter(Boolean) || []
        )
      ).sort()
    : [];

  // Get sub-subcategories for selected subcategory
  const subSubcategories = selectedCategory && selectedSubcategory
    ? Array.from(
        new Set(
          allProducts
            ?.filter(p => p.category === selectedCategory && p.subcategory === selectedSubcategory)
            .map(p => p.sub_subcategory)
            .filter(Boolean) || []
        )
      ).sort()
    : [];

  // Reset subcategory when category changes
  useEffect(() => {
    if (!product && selectedCategory) {
      const currentSubcategory = form.getValues("subcategory");
      const validSubcategories = allProducts
        ?.filter(p => p.category === selectedCategory)
        .map(p => p.subcategory)
        .filter(Boolean) || [];
      
      if (currentSubcategory && !validSubcategories.includes(currentSubcategory)) {
        form.setValue("subcategory", "");
        form.setValue("sub_subcategory", "");
      }
    }
  }, [selectedCategory, allProducts]);

  const mutation = useMutation({
    mutationFn: async (values: ProductFormValues) => {
      const productData = {
        name: values.name,
        price: values.price,
        category: values.category,
        subcategory: values.subcategory,
        sub_subcategory: values.sub_subcategory || null,
        stock_quantity: values.stock_quantity,
        low_stock_threshold: values.low_stock_threshold,
        image_url: values.image_url || null,
      };

      if (product) {
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("id", product.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(productData);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: `Product ${product ? "updated" : "created"} successfully`,
      });
      onSuccess();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save product",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: ProductFormValues) => {
    mutation.mutate(values);
  };

  const filteredCategories = categories.filter(cat =>
    cat.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const filteredSubcategories = subcategories.filter(sub =>
    sub.toLowerCase().includes(subcategorySearch.toLowerCase())
  );

  const filteredSubSubcategories = subSubcategories.filter(sub =>
    sub.toLowerCase().includes(subSubcategorySearch.toLowerCase())
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Name</FormLabel>
              <FormControl>
                <Input placeholder="Enter product name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Price</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Category Combobox */}
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Category</FormLabel>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={categoryOpen}
                      className="w-full justify-between font-normal"
                    >
                      {field.value || "Select or type category..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or add category..."
                      value={categorySearch}
                      onValueChange={setCategorySearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {categorySearch && (
                          <CommandItem
                            onSelect={() => {
                              field.onChange(categorySearch);
                              setCategoryOpen(false);
                              setCategorySearch("");
                            }}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add "{categorySearch}"
                          </CommandItem>
                        )}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredCategories.map((category) => (
                          <CommandItem
                            key={category}
                            value={category}
                            onSelect={() => {
                              field.onChange(category);
                              setCategoryOpen(false);
                              setCategorySearch("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                field.value === category ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {category}
                          </CommandItem>
                        ))}
                        {categorySearch && !filteredCategories.includes(categorySearch) && filteredCategories.length > 0 && (
                          <CommandItem
                            onSelect={() => {
                              field.onChange(categorySearch);
                              setCategoryOpen(false);
                              setCategorySearch("");
                            }}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add "{categorySearch}"
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Subcategory Combobox */}
        <FormField
          control={form.control}
          name="subcategory"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Subcategory</FormLabel>
              <Popover open={subcategoryOpen} onOpenChange={setSubcategoryOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={subcategoryOpen}
                      className="w-full justify-between font-normal"
                    >
                      {field.value || "Select or type subcategory..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or add subcategory..."
                      value={subcategorySearch}
                      onValueChange={setSubcategorySearch}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {subcategorySearch && (
                          <CommandItem
                            onSelect={() => {
                              field.onChange(subcategorySearch);
                              setSubcategoryOpen(false);
                              setSubcategorySearch("");
                            }}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add "{subcategorySearch}"
                          </CommandItem>
                        )}
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredSubcategories.map((subcategory) => (
                          <CommandItem
                            key={subcategory}
                            value={subcategory}
                            onSelect={() => {
                              field.onChange(subcategory);
                              setSubcategoryOpen(false);
                              setSubcategorySearch("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                field.value === subcategory ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {subcategory}
                          </CommandItem>
                        ))}
                        {subcategorySearch && !filteredSubcategories.includes(subcategorySearch) && filteredSubcategories.length > 0 && (
                          <CommandItem
                            onSelect={() => {
                              field.onChange(subcategorySearch);
                              setSubcategoryOpen(false);
                              setSubcategorySearch("");
                            }}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add "{subcategorySearch}"
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Sub-subcategory Combobox */}
        <FormField
          control={form.control}
          name="sub_subcategory"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Sub-subcategory (Optional)</FormLabel>
              <Popover open={subSubcategoryOpen} onOpenChange={setSubSubcategoryOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={subSubcategoryOpen}
                      className="w-full justify-between font-normal"
                    >
                      {field.value || "Select or type sub-subcategory..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or add sub-subcategory..."
                      value={subSubcategorySearch}
                      onValueChange={setSubSubcategorySearch}
                    />
                    <CommandList>
                      <CommandEmpty>No sub-subcategory found.</CommandEmpty>
                      <CommandGroup>
                        {subSubcategorySearch && !filteredSubSubcategories.includes(subSubcategorySearch) && (
                          <CommandItem
                            onSelect={() => {
                              field.onChange(subSubcategorySearch);
                              setSubSubcategoryOpen(false);
                              setSubSubcategorySearch("");
                            }}
                            className="cursor-pointer"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add "{subSubcategorySearch}"
                          </CommandItem>
                        )}
                        {filteredSubSubcategories.map((subSub) => (
                          <CommandItem
                            key={subSub}
                            value={subSub}
                            onSelect={() => {
                              field.onChange(subSub);
                              setSubSubcategoryOpen(false);
                              setSubSubcategorySearch("");
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                field.value === subSub ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {subSub}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="stock_quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stock Quantity</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="0" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="low_stock_threshold"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Low Stock Alert</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="image_url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Image URL (Optional)</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com/image.jpg" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : product ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
};
