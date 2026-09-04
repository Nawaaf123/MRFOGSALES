import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Check, X } from "lucide-react";

type OrderStatus = "pending" | "approved" | "rejected" | "converted";

type OrderItem = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type Order = {
  id: string;
  shop_id: string;
  status: OrderStatus;
  total_amount: number;
  notes: string | null;
  admin_notes: string | null;
  invoice_id: string | null;
  warehouse: "A" | "B" | null;
  created_at: string;
  items: OrderItem[];
  shop: { id: string; name: string } | null;
};

const statusVariant = (
  status: OrderStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "converted" || status === "approved") return "default";
  if (status === "pending") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline";
};

const Orders = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [approveOrder, setApproveOrder] = useState<Order | null>(null);
  const [rejectOrder, setRejectOrder] = useState<Order | null>(null);
  const [warehouse, setWarehouse] = useState<"A" | "B">("A");
  const [adminNotes, setAdminNotes] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Order[]>("/orders"),
  });

  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders]);

  const approveMutation = useMutation({
    mutationFn: (order: Order) =>
      api<{ order: Order; invoice: { invoice_number: string } }>(`/orders/${order.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          warehouse: warehouse || order.warehouse || "A",
          admin_notes: adminNotes.trim() || null,
        }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setApproveOrder(null);
      setAdminNotes("");
      toast({
        title: "Order approved",
        description: `Converted to invoice ${data.invoice.invoice_number}`,
      });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (order: Order) =>
      api<Order>(`/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "rejected",
          admin_notes: adminNotes.trim() || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      setRejectOrder(null);
      setAdminNotes("");
      toast({ title: "Order rejected" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openApprove = (order: Order) => {
    setApproveOrder(order);
    setWarehouse(order.warehouse || user?.assigned_warehouse || "A");
    setAdminNotes("");
  };

  const openReject = (order: Order) => {
    setRejectOrder(order);
    setAdminNotes("");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Review pending orders and convert approved ones to invoices"
              : "Your submitted orders and their status"}
          </p>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Shop</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6}>Loading...</TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 7 : 6}>No orders yet</TableCell>
                </TableRow>
              ) : (
                sorted.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                    <TableCell className="font-medium">{order.shop?.name || "-"}</TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        {(order.items || []).slice(0, 3).map((item) => (
                          <div key={item.id} className="text-muted-foreground">
                            {item.quantity}× {item.product_name}
                          </div>
                        ))}
                        {(order.items || []).length > 3 && (
                          <div className="text-xs text-muted-foreground">
                            +{(order.items || []).length - 3} more
                          </div>
                        )}
                        {(order.items || []).length === 0 && "-"}
                      </div>
                    </TableCell>
                    <TableCell>${Number(order.total_amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(order.status)} className="capitalize">
                        {order.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(order.created_at).toLocaleString()}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {order.status === "pending" && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => openApprove(order)}>
                              <Check className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openReject(order)}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!approveOrder} onOpenChange={(open) => !open && setApproveOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Approving converts this order into an unpaid invoice and deducts stock from the
              selected warehouse.
            </p>
            <div>
              <p className="font-medium">{approveOrder?.shop?.name}</p>
              <p className="text-sm text-muted-foreground">
                ${Number(approveOrder?.total_amount || 0).toFixed(2)} ·{" "}
                {(approveOrder?.items || []).length} item(s)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select value={warehouse} onValueChange={(v) => setWarehouse(v as "A" | "B")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Warehouse A</SelectItem>
                  <SelectItem value="B">Warehouse B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Admin notes</Label>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveOrder(null)}>
                Cancel
              </Button>
              <Button
                disabled={approveMutation.isPending || !approveOrder}
                onClick={() => approveOrder && approveMutation.mutate(approveOrder)}
              >
                {approveMutation.isPending ? "Approving..." : "Approve & convert"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!rejectOrder} onOpenChange={(open) => !open && setRejectOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject order?</AlertDialogTitle>
            <AlertDialogDescription>
              This order for {rejectOrder?.shop?.name || "the shop"} will be marked rejected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Admin notes</Label>
            <Textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={2}
              placeholder="Optional reason"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rejectOrder && rejectMutation.mutate(rejectOrder)}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Orders;
