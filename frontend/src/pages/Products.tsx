import { useMemo, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { BulkProductUploadDialog } from "@/components/products/BulkProductUploadDialog";
import { PageHero } from "@/components/ui/PageHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  ChevronsUpDown,
  Edit,
  Package,
  Plus,
  Power,
  Search,
} from "lucide-react";

type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
  price: number;
  stock_quantity: number;
  stock_quantity_b: number;
  low_stock_threshold: number;
  image_url: string | null;
  is_active: boolean;
};

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  category: string;
  subcategory: string;
  sub_subcategory: string;
  price: string;
  stock_quantity: string;
  stock_quantity_b: string;
  low_stock_threshold: string;
};

const emptyForm: ProductFormState = {
  name: "",
  sku: "",
  barcode: "",
  category: "General",
  subcategory: "",
  sub_subcategory: "",
  price: "0",
  stock_quantity: "0",
  stock_quantity_b: "0",
  low_stock_threshold: "10",
};

function toForm(product: Product): ProductFormState {
  return {
    name: product.name,
    sku: product.sku || "",
    barcode: product.barcode || "",
    category: product.category || "General",
    subcategory: product.subcategory || "",
    sub_subcategory: product.sub_subcategory || "",
    price: String(product.price ?? 0),
    stock_quantity: String(product.stock_quantity ?? 0),
    stock_quantity_b: String(product.stock_quantity_b ?? 0),
    low_stock_threshold: String(product.low_stock_threshold ?? 10),
  };
}

function formPayload(form: ProductFormState) {
  return {
    name: form.name.trim(),
    sku: form.sku.trim() || null,
    barcode: form.barcode.trim() || null,
    category: form.category.trim() || "General",
    subcategory: form.subcategory.trim() || null,
    sub_subcategory: form.sub_subcategory.trim() || null,
    price: Number(form.price) || 0,
    stock_quantity: Number(form.stock_quantity) || 0,
    stock_quantity_b: Number(form.stock_quantity_b) || 0,
    low_stock_threshold: Number(form.low_stock_threshold) || 0,
  };
}

function skuSortKey(sku: string | null | undefined) {
  return (sku || "").trim().toLowerCase();
}

const Products = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = user?.role === "admin" || user?.role === "sales";
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [skuSortAsc, setSkuSortAsc] = useState(true);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [subcategoryOpen, setSubcategoryOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: () => api<Product[]>("/products"),
    staleTime: 2 * 60_000,
  });

  const categories = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [products]);

  const subcategories = useMemo(() => {
    const pool =
      categoryFilter === "all"
        ? products
        : products.filter((p) => p.category === categoryFilter);
    return Array.from(
      new Set(pool.map((p) => p.subcategory).filter((s): s is string => Boolean(s)))
    ).sort((a, b) => a.localeCompare(b));
  }, [products, categoryFilter]);

  const canShowProductList = categoryFilter !== "all" || search.trim().length >= 2;

  const filtered = useMemo(() => {
    if (!canShowProductList) return [];
    const q = search.trim().toLowerCase();
    const rows = products.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (subcategoryFilter !== "all" && (p.subcategory || "") !== subcategoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.subcategory || "").toLowerCase().includes(q) ||
        (p.sub_subcategory || "").toLowerCase().includes(q)
      );
    });

    const dir = skuSortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      const sa = skuSortKey(a.sku);
      const sb = skuSortKey(b.sku);
      if (!sa && !sb) return a.name.localeCompare(b.name) * dir;
      if (!sa) return 1;
      if (!sb) return -1;
      const cmp = sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [products, search, categoryFilter, subcategoryFilter, skuSortAsc, canShowProductList]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = formPayload(form);
      if (!body.name) throw { message: "Product name is required" } satisfies ApiError;
      if (editing) {
        return api<Product>(`/products/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return api<Product>("/products", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast({ title: editing ? "Product updated" : "Product created" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api<void>(`/products/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setDeactivateId(null);
      toast({ title: "Product deactivated" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeactivateId(null);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api<Product>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !is_active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({ title: "Product status updated" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm(toForm(product));
    setOpen(true);
  };

  const onCategoryFilterChange = (value: string) => {
    setCategoryFilter(value);
    setSubcategoryFilter("all");
    setCategoryOpen(false);
  };

  const onSubcategoryFilterChange = (value: string) => {
    setSubcategoryFilter(value);
    setSubcategoryOpen(false);
  };

  const activeCount = products.filter((p) => p.is_active).length;
  const lowStockCount = products.filter((p) => {
    const total = Number(p.stock_quantity || 0) + Number(p.stock_quantity_b || 0);
    return p.is_active && total <= Number(p.low_stock_threshold || 0);
  }).length;

  return (
    <>
      <div className="space-y-4">
        <PageHero
          icon={Package}
          title="Products"
          description="Catalog, SKUs, and warehouse stock for A & B"
          stats={[
            { label: "Total", value: products.length, accent: true },
            { label: "Active", value: activeCount },
            { label: "Low stock", value: lowStockCount },
          ]}
          action={
            canManage ? (
              <div className="flex w-full flex-col flex-wrap gap-2 sm:w-auto sm:flex-row">
                <BulkProductUploadDialog
                  categoryFilter={categoryFilter}
                  subcategoryFilter={subcategoryFilter}
                />
                <Button className="h-11 w-full shadow-sm shadow-primary/25 sm:w-auto" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Product
                </Button>
              </div>
            ) : undefined
          }
        />

        <div className="grid grid-cols-1 items-end gap-3 rounded-xl border border-primary/10 bg-card p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[1fr_minmax(12rem,16rem)_minmax(12rem,16rem)_auto]">
          <div className="space-y-2">
            <Label htmlFor="product-search">Search</Label>
            <Input
              id="product-search"
              placeholder="Search by name, SKU, or category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={categoryOpen}
                  className="w-full justify-between h-11 font-normal"
                >
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
                      <CommandItem value="all categories" onSelect={() => onCategoryFilterChange("all")}>
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
                          onSelect={() => onCategoryFilterChange(category)}
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
                  role="combobox"
                  aria-expanded={subcategoryOpen}
                  className="w-full justify-between h-11 font-normal"
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
                        onSelect={() => onSubcategoryFilterChange("all")}
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
                          onSelect={() => onSubcategoryFilterChange(subcategory)}
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

          <Button
            type="button"
            variant="outline"
            className="h-11 w-full lg:w-auto"
            onClick={() => setSkuSortAsc((v) => !v)}
            title={
              skuSortAsc
                ? "SKU ascending (A→Z). Click for descending."
                : "SKU descending (Z→A). Click for ascending."
            }
          >
            {skuSortAsc ? (
              <ArrowDownAZ className="h-4 w-4 mr-2" />
            ) : (
              <ArrowUpAZ className="h-4 w-4 mr-2" />
            )}
            SKU {skuSortAsc ? "A→Z" : "Z→A"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {canShowProductList
            ? `Showing ${filtered.length} product${filtered.length === 1 ? "" : "s"}, sorted by SKU ${
                skuSortAsc ? "ascending" : "descending"
              }`
            : "Pick a category or type at least 2 characters to list products"}
        </p>

        {!canShowProductList ? (
          <EmptyState
            icon={Search}
            title="Narrow the catalog"
            description="Choose a category or type at least 2 characters to browse products faster"
          />
        ) : (
        <>
        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No products found</p>
          ) : (
            filtered.map((product) => {
              const lowStock =
                product.stock_quantity + product.stock_quantity_b <= product.low_stock_threshold;
              return (
                <div
                  key={product.id}
                  className={cn(
                    "relative space-y-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-all",
                    "hover:border-primary/30 hover:shadow-sm hover:shadow-primary/10",
                    !product.is_active && "opacity-60"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 w-1",
                      product.is_active ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{product.sku || "—"}</p>
                      {product.barcode && (
                        <p className="font-mono text-xs text-muted-foreground">{product.barcode}</p>
                      )}
                      <p className="font-medium leading-snug">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {product.category}
                        {product.subcategory ? ` · ${product.subcategory}` : ""}
                      </p>
                    </div>
                    <Badge variant={product.is_active ? "default" : "secondary"} className="shrink-0">
                      {product.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Price</p>
                      <p className="font-semibold">${Number(product.price).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Stock A</p>
                      <p className={lowStock ? "font-semibold text-destructive" : "font-semibold"}>
                        {product.stock_quantity}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Stock B</p>
                      <p className="font-semibold">
                        {product.stock_quantity_b}
                        {lowStock && (
                          <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">
                            Low
                          </Badge>
                        )}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-2 border-t pt-3">
                      <Button variant="outline" className="flex-1 h-11" onClick={() => openEdit(product)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 h-11"
                        onClick={() =>
                          toggleActiveMutation.mutate({
                            id: product.id,
                            is_active: product.is_active,
                          })
                        }
                      >
                        {product.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      {isAdmin && product.is_active && (
                        <Button
                          variant="outline"
                          className="h-11 px-3"
                          title="Remove"
                          onClick={() => setDeactivateId(product.id)}
                        >
                          <Power className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Flavor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Subcategory</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock A</TableHead>
                <TableHead>Stock B</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 9 : 8}>Loading...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 9 : 8}>No products found</TableCell>
                </TableRow>
              ) : (
                filtered.map((product) => {
                  const lowStock =
                    product.stock_quantity + product.stock_quantity_b <= product.low_stock_threshold;
                  return (
                    <TableRow key={product.id} className={!product.is_active ? "opacity-60" : undefined}>
                      <TableCell className="font-mono text-sm font-medium">
                        {product.sku || "-"}
                      </TableCell>
                      <TableCell>{product.name}</TableCell>
                      <TableCell>{product.category}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {product.subcategory || "-"}
                      </TableCell>
                      <TableCell>${Number(product.price).toFixed(2)}</TableCell>
                      <TableCell className={lowStock ? "text-destructive font-semibold" : undefined}>
                        {product.stock_quantity}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{product.stock_quantity_b}</span>
                          {lowStock && (
                            <Badge variant="destructive" className="text-xs">
                              Low
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleActiveMutation.mutate({
                                id: product.id,
                                is_active: product.is_active,
                              })
                            }
                          >
                            <Badge variant={product.is_active ? "default" : "secondary"}>
                              {product.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </Button>
                        ) : (
                          <Badge variant={product.is_active ? "default" : "secondary"}>
                            {product.is_active ? "Active" : "Inactive"}
                          </Badge>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(product)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            {isAdmin && product.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeactivateId(product.id)}
                                title="Deactivate"
                              >
                                <Power className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        </>
        )}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setEditing(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Product name"
              />
            </div>
            <div className="space-y-2">
              <Label>SKU</Label>
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Short code e.g. AU01-US"
              />
            </div>
            <div className="space-y-2">
              <Label>Barcode</Label>
              <Input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="Exact code from the product barcode"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Used by camera and Bluetooth scanners — leave SKU as the short name
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Category</Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="product-categories"
                />
                <datalist id="product-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label>Subcategory</Label>
                <Input
                  value={form.subcategory}
                  onChange={(e) => setForm({ ...form, subcategory: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sub-subcategory</Label>
              <Input
                value={form.sub_subcategory}
                onChange={(e) => setForm({ ...form, sub_subcategory: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Stock A</Label>
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.stock_quantity}
                  onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Stock B</Label>
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.stock_quantity_b}
                  onChange={(e) => setForm({ ...form, stock_quantity_b: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Low stock</Label>
                <Input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={form.low_stock_threshold}
                  onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button variant="outline" className="w-full sm:w-auto h-11" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                className="w-full sm:w-auto h-11"
                disabled={!form.name.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateId} onOpenChange={() => setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate product?</AlertDialogTitle>
            <AlertDialogDescription>
              This product will be marked inactive and hidden from active catalog views.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deactivateId && deactivateMutation.mutate(deactivateId)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Products;
