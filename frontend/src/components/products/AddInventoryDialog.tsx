import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api";
import { fetchAllPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, PackagePlus, Plus, Trash2 } from "lucide-react";

type CatalogProduct = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category: string;
  subcategory?: string | null;
  price: number;
  stock_quantity?: number;
  stock_quantity_b?: number;
};

type Line = {
  product_id: string;
  product_name: string;
  product_sku: string | null;
  quantity: number;
};

type AddInventoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddInventoryDialog({ open, onOpenChange }: AddInventoryDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [warehouse, setWarehouse] = useState<"A" | "B">("A");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [subcategoryOpen, setSubcategoryOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setWarehouse("A");
      setSearch("");
      setDebouncedSearch("");
      setCategoryFilter("all");
      setSubcategoryFilter("all");
      setLines([]);
    }
  }, [open]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", "active", "brief", "catalog", "inventory"],
    queryFn: () =>
      fetchAllPages<CatalogProduct>("/products", {
        pageSize: 200,
        extraParams: { active_only: true, brief: true },
        timeoutMs: 30_000,
      }),
    enabled: open,
  });

  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [products]
  );

  const subcategories = useMemo(() => {
    const pool =
      categoryFilter === "all"
        ? products
        : products.filter((p) => p.category === categoryFilter);
    return Array.from(
      new Set(pool.map((p) => p.subcategory).filter((s): s is string => Boolean(s)))
    ).sort((a, b) => a.localeCompare(b));
  }, [products, categoryFilter]);

  const canShowList = categoryFilter !== "all" || debouncedSearch.length >= 2;

  const filtered = useMemo(() => {
    if (!canShowList) return [];
    const q = debouncedSearch.toLowerCase();
    return products
      .filter((p) => {
        if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
        if (subcategoryFilter !== "all" && (p.subcategory || "") !== subcategoryFilter) {
          return false;
        }
        if (!q) return true;
        const hay = `${p.name} ${p.sku || ""} ${p.barcode || ""} ${p.category} ${
          p.subcategory || ""
        }`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 80);
  }, [products, canShowList, categoryFilter, subcategoryFilter, debouncedSearch]);

  const qtyOnList = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) {
      map.set(line.product_id, (map.get(line.product_id) || 0) + line.quantity);
    }
    return map;
  }, [lines]);

  const stockOf = (product: CatalogProduct) =>
    warehouse === "B"
      ? Number(product.stock_quantity_b ?? 0)
      : Number(product.stock_quantity ?? 0);

  const addProduct = (product: CatalogProduct) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku || null,
          quantity: 1,
        },
      ];
    });
  };

  const setLineQty = (index: number, quantity: number) => {
    const qty = Math.max(1, Math.floor(quantity) || 1);
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: qty };
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api("/products/stock-adjust", {
        method: "POST",
        body: JSON.stringify({
          warehouse,
          items: lines.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
          })),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast({
        title: "Inventory updated",
        description: `Added stock to warehouse ${warehouse} for ${lines.length} product${
          lines.length === 1 ? "" : "s"
        }.`,
      });
      onOpenChange(false);
    },
    onError: (error: ApiError) => {
      toast({
        title: "Could not add inventory",
        description: error.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const totalUnits = lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5" />
            Add Inventory
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Warehouse</Label>
            <Select value={warehouse} onValueChange={(v) => setWarehouse(v as "A" | "B")}>
              <SelectTrigger className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="A">Warehouse A</SelectItem>
                <SelectItem value="B">Warehouse B</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Search</Label>
              <Input
                placeholder="Name, SKU, barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between font-normal">
                    <span className="truncate">
                      {categoryFilter === "all" ? "All categories" : categoryFilter}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search categories..." />
                    <CommandList>
                      <CommandEmpty>No category found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all categories"
                          onSelect={() => {
                            setCategoryFilter("all");
                            setSubcategoryFilter("all");
                            setCategoryOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              categoryFilter === "all" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          All categories
                        </CommandItem>
                        {categories.map((category) => (
                          <CommandItem
                            key={category}
                            value={category}
                            onSelect={() => {
                              setCategoryFilter(category);
                              setSubcategoryFilter("all");
                              setCategoryOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                categoryFilter === category ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {category}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Subcategory</Label>
              <Popover open={subcategoryOpen} onOpenChange={setSubcategoryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-between font-normal"
                    disabled={subcategories.length === 0}
                  >
                    <span className="truncate">
                      {subcategoryFilter === "all" ? "All subcategories" : subcategoryFilter}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search subcategories..." />
                    <CommandList>
                      <CommandEmpty>No subcategory found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="all subcategories"
                          onSelect={() => {
                            setSubcategoryFilter("all");
                            setSubcategoryOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              subcategoryFilter === "all" ? "opacity-100" : "opacity-0"
                            )}
                          />
                          All subcategories
                        </CommandItem>
                        {subcategories.map((subcategory) => (
                          <CommandItem
                            key={subcategory}
                            value={subcategory}
                            onSelect={() => {
                              setSubcategoryFilter(subcategory);
                              setSubcategoryOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                subcategoryFilter === subcategory ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {subcategory}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
            {!canShowList ? (
              <p className="p-3 text-center text-sm text-muted-foreground">
                Pick a category or type at least 2 characters
              </p>
            ) : isLoading ? (
              <p className="p-3 text-center text-sm text-muted-foreground">Loading products…</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">No products match</p>
            ) : (
              filtered.map((product) => {
                const onList = qtyOnList.get(product.id) || 0;
                const stock = stockOf(product);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/80",
                      onList > 0 && "bg-primary/5"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                        <span className="shrink-0 font-mono text-sm font-semibold">
                          {product.sku || "—"}
                        </span>
                        <span className="truncate text-sm">{product.name}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {product.category}
                        {product.subcategory ? ` · ${product.subcategory}` : ""}
                        {` · Now ${stock}`}
                        {onList > 0 ? ` · After +${onList} → ${stock + onList}` : ""}
                      </p>
                    </div>
                    {onList > 0 ? (
                      <Badge className="shrink-0">+{onList}</Badge>
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {lines.length > 0 && (
            <div className="space-y-2">
              <Label>
                To add · {lines.length} flavor{lines.length === 1 ? "" : "s"} · {totalUnits} unit
                {totalUnits === 1 ? "" : "s"}
              </Label>
              <div className="space-y-2 rounded-md border p-2">
                {lines.map((line, index) => {
                  const product = products.find((p) => p.id === line.product_id);
                  const current = product ? stockOf(product) : 0;
                  return (
                  <div
                    key={line.product_id}
                    className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{line.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {line.product_sku || "—"} · now {current} → {current + line.quantity}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="h-10 w-20"
                      value={line.quantity}
                      onChange={(e) => setLineQty(index, Number(e.target.value))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={lines.length === 0 || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : `Add to warehouse ${warehouse}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
