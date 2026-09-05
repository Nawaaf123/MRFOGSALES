import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
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
import { useToast } from "@/hooks/use-toast";
import { BulkUploadDialog } from "@/components/shops/BulkUploadDialog";
import { LocationsMap } from "@/components/location/SalesMap";
import { Edit, Mail, MapPin, Phone, Plus, Snowflake, Sun, Upload } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<Shop | null>(null);
  const [form, setForm] = useState<ShopFormState>(emptyForm);

  const { data: shops = [], isLoading } = useQuery({
    queryKey: ["shops"],
    queryFn: () => api<Shop[]>("/shops?include_frozen=true"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.owner_name || "").toLowerCase().includes(q) ||
        (s.phone || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        (s.city || "").toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q)
    );
  }, [shops, search]);

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
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Shops</h1>
            <p className="text-muted-foreground">Retail accounts and customer contacts</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Bulk Import
              </Button>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Shop
              </Button>
            </div>
          )}
        </div>

        <Input
          placeholder="Search shops by name, owner, phone, city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />

        <div className="space-y-2">
          <div>
            <h2 className="text-lg font-semibold">Shop and sales map</h2>
            <p className="text-sm text-muted-foreground">
              Blue pins are shops; red pins are live salesperson GPS
            </p>
          </div>
          {isAdmin && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={geocodeMutation.isPending}
                onClick={() => geocodeMutation.mutate()}
              >
                <MapPin className="h-4 w-4 mr-2" />
                {geocodeMutation.isPending ? "Geocoding..." : "Geocode missing shops"}
              </Button>
            </div>
          )}
          <LocationsMap heightClassName="h-[420px]" />
        </div>

        <BulkUploadDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["shops"] });
            window.dispatchEvent(new Event("shops-changed"));
          }}
        />

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
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
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5}>No shops found</TableCell>
                </TableRow>
              ) : (
                filtered.map((shop) => (
                  <TableRow key={shop.id} className={shop.is_frozen ? "opacity-70" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        {shop.name}
                        {shop.is_frozen && (
                          <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">
                            <Snowflake className="h-3 w-3 mr-1" />
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
                                <Sun className="h-4 w-4 text-orange-500" />
                              ) : (
                                <Snowflake className="h-4 w-4 text-blue-500" />
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
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
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-1">
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
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={!form.name.trim() || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Shops;
