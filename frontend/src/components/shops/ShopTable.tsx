import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Mail, Phone, MapPin, ChevronDown, ChevronRight, Snowflake, Sun } from "lucide-react";
import { ShopInvoices } from "./ShopInvoices";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
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
import { Card, CardContent } from "@/components/ui/card";

interface ShopTableProps {
  shops: any[];
  onEdit: (shop: any) => void;
  isAdmin: boolean;
  onRefetch: () => void;
}

export const ShopTable = ({ shops, onEdit, isAdmin, onRefetch }: ShopTableProps) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const freezeMutation = useMutation({
    mutationFn: async ({ id, is_frozen }: { id: string; is_frozen: boolean }) => {
      const { error } = await supabase
        .from("shops")
        .update({ is_frozen } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["pending-payments"] });
      queryClient.invalidateQueries({ queryKey: ["recent-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["top-shops"] });
      toast({
        title: "Success",
        description: vars.is_frozen ? "Shop frozen — removed from reports" : "Shop unfrozen — back in reports",
      });
      onRefetch();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update shop", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shops").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      toast({
        title: "Success",
        description: "Shop deleted successfully",
      });
      setDeleteId(null);
      onRefetch();
    },
    onError: (error: any) => {
      const isFkError = error?.message?.includes("foreign key constraint") || error?.code === "23503";
      toast({
        title: "Error",
        description: isFkError
          ? "Cannot delete this shop because it has invoices linked to it. Delete the invoices first."
          : "Failed to delete shop",
        variant: "destructive",
      });
      setDeleteId(null);
    },
  });

  if (shops.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No shops found</p>
        <p className="text-sm text-muted-foreground mt-1">
          Add your first customer shop to get started
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {shops.map((shop) => (
          <Card key={shop.id} className={shop.is_frozen ? "opacity-70 border-blue-300/50" : ""}>
            <CardContent className="p-4">
              <div
                className="flex justify-between items-start mb-2 cursor-pointer"
                onClick={() => setExpandedId(expandedId === shop.id ? null : shop.id)}
              >
                <div className="flex items-center gap-2">
                  {expandedId === shop.id ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-base">{shop.name}</h3>
                      {shop.is_frozen && (
                        <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">
                          <Snowflake className="h-3 w-3 mr-1" />
                          Frozen
                        </Badge>
                      )}
                    </div>
                    {shop.owner_name && (
                      <p className="text-sm text-muted-foreground">{shop.owner_name}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={shop.is_frozen ? "Unfreeze shop" : "Freeze shop"}
                      onClick={() => freezeMutation.mutate({ id: shop.id, is_frozen: !shop.is_frozen })}
                      disabled={freezeMutation.isPending}
                    >
                      {shop.is_frozen ? (
                        <Sun className="h-4 w-4 text-orange-500" />
                      ) : (
                        <Snowflake className="h-4 w-4 text-blue-500" />
                      )}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(shop)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(shop.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                {shop.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 flex-shrink-0" />
                    <a href={`tel:${shop.phone}`} className="hover:text-primary">{shop.phone}</a>
                  </div>
                )}
                {shop.email && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4 flex-shrink-0" />
                    <a href={`mailto:${shop.email}`} className="hover:text-primary truncate">{shop.email}</a>
                  </div>
                )}
                {(shop.street_address || shop.city || shop.state) && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      {shop.street_address && <div>{shop.street_address}</div>}
                      {shop.street_address_line_2 && <div>{shop.street_address_line_2}</div>}
                      {(shop.city || shop.state || shop.zip_code) && (
                        <div>{[shop.city, shop.state, shop.zip_code].filter(Boolean).join(", ")}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {expandedId === shop.id && (
                <div className="mt-3 pt-3 border-t">
                  <ShopInvoices shopId={shop.id} shopName={shop.name} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop Name</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shops.map((shop) => (
              <>
                <TableRow
                  key={shop.id}
                  className={`cursor-pointer hover:bg-accent/50 ${shop.is_frozen ? "opacity-70" : ""}`}
                  onClick={() => setExpandedId(expandedId === shop.id ? null : shop.id)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2 flex-wrap">
                      {expandedId === shop.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
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
                    <div className="flex flex-col gap-1 text-sm">
                      {shop.phone && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          <span>{shop.phone}</span>
                        </div>
                      )}
                      {shop.email && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          <span>{shop.email}</span>
                        </div>
                      )}
                      {!shop.phone && !shop.email && "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {(shop.street_address || shop.city || shop.state) ? (
                      <div className="flex items-start gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <div className="line-clamp-2">
                          {shop.street_address && <div>{shop.street_address}</div>}
                          {shop.street_address_line_2 && <div>{shop.street_address_line_2}</div>}
                          {(shop.city || shop.state || shop.zip_code) && (
                            <div>{[shop.city, shop.state, shop.zip_code].filter(Boolean).join(", ")}</div>
                          )}
                        </div>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-2">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title={shop.is_frozen ? "Unfreeze shop" : "Freeze shop"}
                          onClick={() => freezeMutation.mutate({ id: shop.id, is_frozen: !shop.is_frozen })}
                          disabled={freezeMutation.isPending}
                        >
                          {shop.is_frozen ? (
                            <Sun className="h-4 w-4 text-orange-500" />
                          ) : (
                            <Snowflake className="h-4 w-4 text-blue-500" />
                          )}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => onEdit(shop)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" size="sm" onClick={() => setDeleteId(shop.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === shop.id && (
                  <TableRow key={`${shop.id}-invoices`}>
                    <TableCell colSpan={5} className="bg-muted/30 p-4">
                      <ShopInvoices shopId={shop.id} shopName={shop.name} />
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shop</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this shop? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
