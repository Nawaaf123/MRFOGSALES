import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Navigate } from "react-router-dom";

type AppUser = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  assigned_warehouse: string;
  is_active: boolean;
};

const Users = () => {
  const { user } = useAuth();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<AppUser[]>("/users"),
    enabled: user?.role === "admin",
  });

  if (user && user.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-muted-foreground">Team accounts from the FastAPI auth system</p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>Loading...</TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No users found</TableCell>
                </TableRow>
              ) : (
                users.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.full_name}</TableCell>
                    <TableCell>{item.email}</TableCell>
                    <TableCell className="capitalize">{item.role}</TableCell>
                    <TableCell>{item.assigned_warehouse}</TableCell>
                    <TableCell>{item.is_active ? "Active" : "Inactive"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Users;
