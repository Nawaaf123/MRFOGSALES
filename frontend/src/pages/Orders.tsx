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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type Shop = {
  id: string;
  name: string;
  retailer_user_id?: string | null;
};

type RetailerSignup = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  requested_shop_name: string;
  message: string | null;
  status: string;
  shop_id: string | null;
  user_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const statusVariant = (
  status: OrderStatus
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "converted" || status === "approved") return "default";
  if (status === "pending") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline";
};

const signupStatusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "approved") return "default";
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

  const [approveSignup, setApproveSignup] = useState<RetailerSignup | null>(null);
  const [rejectSignup, setRejectSignup] = useState<RetailerSignup | null>(null);
  const [signupShopId, setSignupShopId] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Order[]>("/orders"),
  });

  const { data: signups = [], isLoading: signupsLoading } = useQuery({
    queryKey: ["retailer-signups"],
    queryFn: () => api<RetailerSignup[]>("/retailer-signups"),
    enabled: isAdmin,
  });

  const { data: shops = [] } = useQuery({
    queryKey: ["shops"],
    queryFn: () => api<Shop[]>("/shops"),
    enabled: isAdmin && !!approveSignup,
  });

  const availableShops = useMemo(() => {
    const hasRetailerField = shops.some((s) => "retailer_user_id" in s);
    if (!hasRetailerField) return shops;
    return shops.filter((s) => !s.retailer_user_id);
  }, [shops]);

  const sorted = useMemo(() => {
    return [...orders].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders]);

  const sortedSignups = useMemo(() => {
    return [...signups].sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [signups]);

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

  const approveSignupMutation = useMutation({
    mutationFn: ({ id, shop_id }: { id: string; shop_id: string }) =>
      api<RetailerSignup>(`/retailer-signups/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ shop_id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retailer-signups"] });
      queryClient.invalidateQueries({ queryKey: ["shops"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setApproveSignup(null);
      setSignupShopId("");
      toast({ title: "Signup approved", description: "Retailer linked to shop" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectSignupMutation = useMutation({
    mutationFn: (id: string) =>
      api<RetailerSignup>(`/retailer-signups/${id}/reject`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retailer-signups"] });
      setRejectSignup(null);
      toast({ title: "Signup rejected" });
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

  const ordersTable = (
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
                        <Button size="sm" variant="outline" onClick={() => openReject(order)}>
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
  );

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Review pending orders and retailer signup requests"
              : "Your submitted orders and their status"}
          </p>
        </div>

        {isAdmin ? (
          <Tabs defaultValue="orders">
            <TabsList>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="signups">
                Signup Requests
                {signups.filter((s) => s.status === "pending").length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {signups.filter((s) => s.status === "pending").length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="orders" className="mt-4">
              {ordersTable}
            </TabsContent>
            <TabsContent value="signups" className="mt-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Requested Shop</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signupsLoading ? (
                      <TableRow>
                        <TableCell colSpan={7}>Loading...</TableCell>
                      </TableRow>
                    ) : sortedSignups.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>No signup requests</TableCell>
                      </TableRow>
                    ) : (
                      sortedSignups.map((signup) => (
                        <TableRow key={signup.id}>
                          <TableCell className="font-medium">{signup.full_name}</TableCell>
                          <TableCell>{signup.email}</TableCell>
                          <TableCell>{signup.requested_shop_name}</TableCell>
                          <TableCell>{signup.phone || "-"}</TableCell>
                          <TableCell>
                            <Badge
                              variant={signupStatusVariant(signup.status)}
                              className="capitalize"
                            >
                              {signup.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {new Date(signup.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {signup.status === "pending" && (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setApproveSignup(signup);
                                    setSignupShopId("");
                                  }}
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setRejectSignup(signup)}
                                >
                                  <X className="h-4 w-4 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          ordersTable
        )}
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

      <Dialog
        open={!!approveSignup}
        onOpenChange={(open) => {
          if (!open) {
            setApproveSignup(null);
            setSignupShopId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve retailer signup</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="font-medium">{approveSignup?.full_name}</p>
              <p className="text-sm text-muted-foreground">{approveSignup?.email}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Requested shop: {approveSignup?.requested_shop_name}
              </p>
              {approveSignup?.message && (
                <p className="text-sm text-muted-foreground mt-1">{approveSignup.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Link to shop *</Label>
              <Select value={signupShopId} onValueChange={setSignupShopId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select shop" />
                </SelectTrigger>
                <SelectContent>
                  {availableShops.map((shop) => (
                    <SelectItem key={shop.id} value={shop.id}>
                      {shop.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Backend rejects shops already linked to a retailer.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setApproveSignup(null);
                  setSignupShopId("");
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!signupShopId || approveSignupMutation.isPending || !approveSignup}
                onClick={() =>
                  approveSignup &&
                  approveSignupMutation.mutate({
                    id: approveSignup.id,
                    shop_id: signupShopId,
                  })
                }
              >
                {approveSignupMutation.isPending ? "Approving..." : "Approve"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!rejectSignup}
        onOpenChange={(open) => !open && setRejectSignup(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject signup request?</AlertDialogTitle>
            <AlertDialogDescription>
              Reject {rejectSignup?.full_name || "this retailer"} (
              {rejectSignup?.email || "no email"})?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => rejectSignup && rejectSignupMutation.mutate(rejectSignup.id)}
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
