import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
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
import { useAuth, AuthUser } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Edit, Plus, Power } from "lucide-react";

type AppUser = AuthUser;

type Role = AuthUser["role"];
type Warehouse = AuthUser["assigned_warehouse"];

type CreateForm = {
  email: string;
  password: string;
  full_name: string;
  role: Role;
  assigned_warehouse: Warehouse;
};

type EditForm = {
  full_name: string;
  role: Role;
  assigned_warehouse: Warehouse;
};

const emptyCreate: CreateForm = {
  email: "",
  password: "",
  full_name: "",
  role: "sales",
  assigned_warehouse: "A",
};

const Users = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<AppUser[]>("/users"),
    enabled: user?.role === "admin",
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!createForm.email.trim() || !createForm.password || !createForm.full_name.trim()) {
        throw { message: "Name, email, and password are required" } satisfies ApiError;
      }
      if (createForm.password.length < 6) {
        throw { message: "Password must be at least 6 characters" } satisfies ApiError;
      }
      return api<AppUser>("/users", {
        method: "POST",
        body: JSON.stringify({
          email: createForm.email.trim(),
          password: createForm.password,
          full_name: createForm.full_name.trim(),
          role: createForm.role,
          assigned_warehouse: createForm.assigned_warehouse,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      toast({ title: "User created" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing || !editForm) throw { message: "Nothing to update" } satisfies ApiError;
      return api<AppUser>(`/users/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          full_name: editForm.full_name.trim(),
          role: editForm.role,
          assigned_warehouse: editForm.assigned_warehouse,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditing(null);
      setEditForm(null);
      toast({ title: "User updated" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api<void>(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeactivateId(null);
      toast({ title: "User deactivated" });
    },
    onError: (error: ApiError) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setDeactivateId(null);
    },
  });

  if (user && user.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  const openEdit = (item: AppUser) => {
    setEditing(item);
    setEditForm({
      full_name: item.full_name,
      role: item.role,
      assigned_warehouse: item.assigned_warehouse,
    });
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Users</h1>
            <p className="text-muted-foreground">Manage team accounts, roles, and warehouses</p>
          </div>
          <Button
            className="w-full sm:w-auto h-11"
            onClick={() => {
              setCreateForm(emptyCreate);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>Loading...</TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>No users found</TableCell>
                </TableRow>
              ) : (
                users.map((item) => (
                  <TableRow key={item.id} className={!item.is_active ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{item.full_name}</TableCell>
                    <TableCell>{item.email}</TableCell>
                    <TableCell className="capitalize">{item.role}</TableCell>
                    <TableCell>{item.assigned_warehouse}</TableCell>
                    <TableCell>
                      <Badge variant={item.is_active ? "default" : "secondary"}>
                        {item.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        {item.is_active && item.id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Deactivate"
                            onClick={() => setDeactivateId(item.id)}
                          >
                            <Power className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Full name *</Label>
              <Input
                value={createForm.full_name}
                onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Password *</Label>
              <Input
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={createForm.role}
                  onValueChange={(v) => setCreateForm({ ...createForm, role: v as Role })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="sales">Sales</SelectItem>
                    <SelectItem value="srour">Srour</SelectItem>
                    <SelectItem value="retailer">Retailer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Warehouse</Label>
                <Select
                  value={createForm.assigned_warehouse}
                  onValueChange={(v) =>
                    setCreateForm({ ...createForm, assigned_warehouse: v as Warehouse })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B">B</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditForm(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                />
              </div>
              <p className="text-sm text-muted-foreground">{editing?.email}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={editForm.role}
                    onValueChange={(v) => setEditForm({ ...editForm, role: v as Role })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="srour">Srour</SelectItem>
                      <SelectItem value="retailer">Retailer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Warehouse</Label>
                  <Select
                    value={editForm.assigned_warehouse}
                    onValueChange={(v) =>
                      setEditForm({ ...editForm, assigned_warehouse: v as Warehouse })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setEditForm(null);
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                  {updateMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateId} onOpenChange={() => setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be able to sign in until reactivated.
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

export default Users;
