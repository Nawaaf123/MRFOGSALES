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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import {
  buildPageParams,
  DEFAULT_PAGE_SIZE,
  type Paginated,
} from "@/lib/pagination";
import { ListPaginationBar } from "@/components/ui/ListPaginationBar";
import { useToast } from "@/hooks/use-toast";
import { BulkUploadDialog } from "@/components/shops/BulkUploadDialog";
import { PageHero } from "@/components/ui/PageHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { DeferredLocationsMap } from "@/components/location/DeferredLocationsMap";
import { cn } from "@/lib/utils";
import {
  Edit,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShoppingBag,
  Snowflake,
  Sun,
  Upload,
} from "lucide-react";

type Shop = {
  id: string;
  name: string;
  owner_name: string | null;
  email: string | null;
  phone: string | null;
  street_address: string | null;
  street_address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_frozen: boolean;
};

type ShopFormState = {
  name: string;
  owner_name: string;
  email: string;
  phone: string;
  street_address: string;
  street_address_line_2: string;
  city: string;
  state: string;
  zip_code: string;
};

const emptyForm: ShopFormState = {
  name: "",
  owner_name: "",
  email: "",
  phone: "",
  street_address: "",
  street_address_line_2: "",
  city: "",
  state: "",
  zip_code: "",
};

function toForm(shop: Shop): ShopFormState {
  return {
    name: shop.name,
    owner_name: shop.owner_name || "",
    email: shop.email || "",
    phone: shop.phone || "",
    street_address: shop.street_address || "",
    street_address_line_2: shop.street_address_line_2 || "",
    city: shop.city || "",
    state: shop.state || "",
    zip_code: shop.zip_code || "",
  };
}

function formPayload(form: ShopFormState) {
  return {
    name: form.name.trim(),
    owner_name: form.owner_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    street_address: form.street_address.trim() || null,
    street_address_line_2: form.street_address_line_2.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim() || null,
    zip_code: form.zip_code.trim() || null,
  };
}

function formatAddress(shop: Shop) {
  const line1 = [shop.street_address, shop.street_address_line_2].filter(Boolean).join(", ");
  const line2 = [shop.city, shop.state, shop.zip_code].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(" · ") || "-";
}

const Shops = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = user?.role === "admin" || user?.role === "sales";
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "frozen">("all");
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState<ShopFormState>(emptyForm);
  const [page, setPage] = useState(1);
  const pageSize = DEFAULT_PAGE_SIZE;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const listParams = useMemo(
    () =>
      buildPageParams({
        include_frozen: true,
        frozen: statusFilter === "frozen" ? true : statusFilter === "active" ? false : undefined,
        search: debouncedSearch || undefined,
        page,
        page_size: pageSize,
      }),
    [debouncedSearch, statusFilter, page, pageSize]
  );

  const { data: shopPage, isLoading } = useQuery({
    queryKey: ["shops", "include_frozen", listParams],
    queryFn: () =>
      api<Paginated<Shop> & { active_count?: number; frozen_count?: number }>(
        `/shops${listParams}`
      ),
    staleTime: 2 * 60_000,
  });

  const shops = shopPage?.items ?? [];
  const shopTotal = shopPage?.total ?? 0;
  const activeCount = shopPage?.active_count ?? 0;
  const frozenCount = shopPage?.frozen_count ?? 0;
  const catalogTotal = activeCount + frozenCount;

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = formPayload(form);
      if (!body.name) throw { message: "Shop name is required" } satisfies ApiError;
      if (editing) {
        return api<Shop>(`/shops/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return api<Shop>("/shops", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      window.dispatchEvent(new Event("shops-changed"));
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      toast({ title: editing ? "Shop updated" : "Shop created" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const freezeMutation = useMutation({
    mutationFn: ({ id, is_frozen }: { id: string; is_frozen: boolean }) =>
      api<Shop>(`/shops/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_frozen }),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      window.dispatchEvent(new Event("shops-changed"));
      toast({
        title: vars.is_frozen ? "Shop frozen" : "Shop unfrozen",
        description: vars.is_frozen
          ? "Removed from reports and invoice lists"
          : "Back in reports and invoice lists",
      });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const geocodeMutation = useMutation({
    mutationFn: async () => {
      let totalUpdated = 0;
      let remaining = 1;
      let rounds = 0;
      while (remaining > 0 && rounds < 40) {
        rounds += 1;
        const result = await api<{
          attempted: number;
          updated: number;
          skipped: number;
          remaining: number;
        }>("/shops/geocode-missing?limit=50", { method: "POST" });
        totalUpdated += result.updated;
        remaining = result.remaining;
        if (result.attempted === 0) break;
      }
      return { updated: totalUpdated, remaining };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      window.dispatchEvent(new Event("shops-changed"));
      toast({
        title: "Geocode complete",
        description: `Updated ${result.updated} shops. Remaining without coords: ${result.remaining}`,
      });
    },
    onError: (error: ApiError) => {
      toast({ title: "Geocode failed", description: error.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (shop: Shop) => {
    setEditing(shop);
    setForm(toForm(shop));
    setOpen(true);
  };

  return (
    <>
      <div className="space-y-4">
        <PageHero
          icon={ShoppingBag}
          title="Shops"
          description="Retail accounts and customer contacts"
          stats={[
            { label: "Total", value: catalogTotal, accent: true },
            { label: "Active", value: activeCount },
            { label: "Frozen", value: frozenCount },
          ]}
          action={
            canManage ? (
              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                {isAdmin && (
                  <Button
                    variant="outline"
                    className="h-11 w-full border-primary/25 sm:w-auto"
                    disabled={geocodeMutation.isPending}
                    onClick={() => geocodeMutation.mutate()}
                  >
                    <MapPin className="mr-2 h-4 w-4" />
                    {geocodeMutation.isPending ? "Geocoding..." : "Geocode"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-11 w-full border-primary/25 sm:w-auto"
                  onClick={() => setBulkOpen(true)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Bulk Import
                </Button>
                <Button className="h-11 w-full shadow-sm shadow-primary/25 sm:w-auto" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Shop
                </Button>
              </div>
            ) : undefined
          }
        />

        <FilterChips
          value={statusFilter}
          onChange={(id) => setStatusFilter(id as "all" | "active" | "frozen")}
          items={[
            { id: "all", label: "All", count: catalogTotal },
            { id: "active", label: "Active", count: activeCount },
            { id: "frozen", label: "Frozen", count: frozenCount },
          ]}
        />

        <Input
          placeholder="Search shops by name, owner, phone, city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full max-w-md"
        />

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Shop map</h2>
          <p className="text-sm text-muted-foreground">
            Red markers show shops with geocoded addresses
          </p>
          <DeferredLocationsMap heightClassName="h-[320px] md:h-[420px]" pollSales={false} />
        </div>

        <BulkUploadDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["shops"] });
            window.dispatchEvent(new Event("shops-changed"));
          }}
        />

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : shops.length === 0 ? (
            <EmptyState icon={ShoppingBag} title="No shops found" description="Try another search or status filter" />
          ) : (
            shops.map((shop) => (
              <div
                key={shop.id}
                className={cn(
                  "relative space-y-3 overflow-hidden rounded-xl border bg-card p-4 pl-5",
                  shop.is_frozen && "opacity-80"
                )}
              >
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 w-1",
                    shop.is_frozen ? "bg-muted-foreground/40" : "bg-primary"
                  )}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{shop.name}</p>
                    {shop.owner_name && (
                      <p className="truncate text-sm text-muted-foreground">{shop.owner_name}</p>
                    )}
                  </div>
                  <Badge
                    className={cn(
                      "shrink-0",
                      shop.is_frozen
                        ? "bg-muted text-muted-foreground hover:bg-muted"
                        : "bg-primary/15 text-primary hover:bg-primary/15"
                    )}
                    variant="secondary"
                  >
                    {shop.is_frozen ? "Frozen" : "Active"}
                  </Badge>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {shop.phone && (
                    <a href={`tel:${shop.phone}`} className="flex items-center gap-2 hover:text-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      {shop.phone}
                    </a>
                  )}
                  {shop.email && (
                    <a href={`mailto:${shop.email}`} className="flex items-center gap-2 hover:text-foreground break-all">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      {shop.email}
                    </a>
                  )}
                  {(shop.street_address || shop.city) && (
                    <p className="flex items-start gap-2">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{formatAddress(shop)}</span>
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-2 border-t pt-3">
                    {isAdmin && (
                      <Button
                        variant="outline"
                        className="flex-1 h-11"
                        disabled={freezeMutation.isPending}
                        onClick={() =>
                          freezeMutation.mutate({
                            id: shop.id,
                            is_frozen: !shop.is_frozen,
                          })
                        }
                      >
                        {shop.is_frozen ? (
                          <>
                            <Sun className="mr-2 h-4 w-4 text-primary" />
                            Unfreeze
                          </>
                        ) : (
                          <>
                            <Snowflake className="mr-2 h-4 w-4 text-primary" />
                            Freeze
                          </>
                        )}
                      </Button>
                    )}
                    <Button variant="outline" className="flex-1 h-11" onClick={() => openEdit(shop)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-x-auto rounded-xl border border-primary/10 md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Shop</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5}>Loading...</TableCell>
                </TableRow>
              ) : shops.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5}>No shops found</TableCell>
                </TableRow>
              ) : (
                shops.map((shop) => (
                  <TableRow key={shop.id} className={shop.is_frozen ? "opacity-70" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        {shop.name}
                        {shop.is_frozen && (
                          <Badge variant="outline" className="border-primary/40 text-xs text-primary">
                            <Snowflake className="mr-1 h-3 w-3" />
                            Frozen
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{shop.owner_name || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                        {shop.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {shop.phone}
                          </span>
                        )}
                        {shop.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {shop.email}
                          </span>
                        )}
                        {!shop.phone && !shop.email && "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-start gap-1 text-sm text-muted-foreground">
                        {(shop.street_address || shop.city) && (
                          <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
                        )}
                        {formatAddress(shop)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={shop.is_frozen ? "secondary" : "default"}>
                        {shop.is_frozen ? "Frozen" : "Active"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title={shop.is_frozen ? "Unfreeze shop" : "Freeze shop"}
                              disabled={freezeMutation.isPending}
                              onClick={() =>
                                freezeMutation.mutate({
                                  id: shop.id,
                                  is_frozen: !shop.is_frozen,
                                })
                              }
                            >
                              {shop.is_frozen ? (
                                <Sun className="h-4 w-4 text-primary" />
                              ) : (
                                <Snowflake className="h-4 w-4 text-primary" />
                              )}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openEdit(shop)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <ListPaginationBar
          page={page}
          pageSize={pageSize}
          total={shopTotal}
          onPageChange={setPage}
        />
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
            <DialogTitle>{editing ? "Edit Shop" : "Add Shop"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Shop Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Enter shop name"
              />
            </div>
            <div className="space-y-2">
              <Label>Owner Name</Label>
              <Input
                value={form.owner_name}
                onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Street Address</Label>
              <Input
                value={form.street_address}
                onChange={(e) => setForm({ ...form, street_address: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Address Line 2</Label>
              <Input
                value={form.street_address_line_2}
                onChange={(e) => setForm({ ...form, street_address_line_2: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Zip</Label>
                <Input
                  value={form.zip_code}
                  onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
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
    </>
  );
};

export default Shops;
