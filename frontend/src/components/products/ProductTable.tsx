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
import { Edit, Trash2, Package } from "lucide-react";
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
import { InventoryDialog } from "./InventoryDialog";
import { Card, CardContent } from "@/components/ui/card";

interface ProductTableProps {
  products: any[];
  onEdit: (product: any) => void;
  isAdmin: boolean;
}

export const ProductTable = ({ products, onEdit, isAdmin }: ProductTableProps) => {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [inventoryProduct, setInventoryProduct] = useState<any>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'price' | 'stock' | 'stock_b' } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("products")
        .update({ is_active: !isActive })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({
        title: "Success",
        description: "Product status updated",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update product status",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({
        title: "Success",
        description: "Product deleted successfully",
      });
      setDeleteId(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive",
      });
      setDeleteId(null);
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: 'price' | 'stock_quantity' | 'stock_quantity_b'; value: number }) => {
      const { error } = await supabase
        .from("products")
        .update({ [field]: value } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast({
        title: "Success",
        description: "Product updated successfully",
      });
      setEditingCell(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update product",
        variant: "destructive",
      });
      setEditingCell(null);
    },
  });

  const handleCellClick = (productId: string, field: 'price' | 'stock' | 'stock_b', currentValue: number) => {
    if (!isAdmin) return;
    setEditingCell({ id: productId, field });
    setEditValue(currentValue.toString());
  };

  const handleCellBlur = () => {
    if (!editingCell) return;

    const numValue = parseFloat(editValue);
    if (isNaN(numValue) || numValue < 0) {
      toast({
        title: "Invalid value",
        description: "Please enter a valid positive number",
        variant: "destructive",
      });
      setEditingCell(null);
      return;
    }

    const field: 'price' | 'stock_quantity' | 'stock_quantity_b' =
      editingCell.field === 'price' ? 'price' :
      editingCell.field === 'stock' ? 'stock_quantity' : 'stock_quantity_b';
    updateFieldMutation.mutate({ id: editingCell.id, field, value: numValue });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const getCategoryColor = (category: string) => {
    const hash = category.split('').reduce((acc, char) => {
      return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    
    const colors = [
      "bg-blue-500/10 text-blue-500 border-blue-500/20",
      "bg-purple-500/10 text-purple-500 border-purple-500/20",
      "bg-green-500/10 text-green-500 border-green-500/20",
      "bg-amber-500/10 text-amber-500 border-amber-500/20",
      "bg-pink-500/10 text-pink-500 border-pink-500/20",
      "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
      "bg-orange-500/10 text-orange-500 border-orange-500/20",
    ];
    
    return colors[Math.abs(hash) % colors.length];
  };

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No products found</p>
        <p className="text-sm text-muted-foreground mt-1">
          {isAdmin ? "Add your first product to get started" : "Products will appear here once added"}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {products.map((product) => (
          <Card key={product.id}>
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-base">{product.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge variant="outline" className={getCategoryColor(product.category)}>
                      {product.category}
                    </Badge>
                    {product.subcategory && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {product.subcategory}
                      </Badge>
                    )}
                    {product.sub_subcategory && (
                      <Badge variant="outline" className="text-muted-foreground text-xs">
                        {product.sub_subcategory}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge variant={product.is_active ? "default" : "secondary"}>
                  {product.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              
              <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                <div>
                  <span className="text-muted-foreground">Price</span>
                  <p className="font-semibold">${product.price.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Stock A</span>
                  <p className="font-semibold">{product.stock_quantity}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Stock B</span>
                  <p className="font-semibold">{product.stock_quantity_b ?? 0}</p>
                </div>
              </div>

              {isAdmin && (
                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setInventoryProduct(product)}
                  >
                    <Package className="h-4 w-4 mr-1" />
                    Inventory
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => onEdit(product)}
                  >
                    <Edit className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteId(product.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
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
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Subcategory</TableHead>
              <TableHead>Sub-subcategory</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Stock A</TableHead>
              <TableHead>Stock B</TableHead>
              <TableHead>Status</TableHead>
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={getCategoryColor(product.category)}>
                    {product.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{product.subcategory || "-"}</span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{product.sub_subcategory || "-"}</span>
                </TableCell>
                <TableCell 
                  className={isAdmin ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={() => handleCellClick(product.id, 'price', product.price)}
                  title={isAdmin ? "Click to edit price" : ""}
                >
                  {editingCell?.id === product.id && editingCell?.field === 'price' ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleCellBlur}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="w-20 px-2 py-1 border rounded"
                    />
                  ) : (
                    `$${product.price.toFixed(2)}`
                  )}
                </TableCell>
                <TableCell
                  className={isAdmin ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={() => handleCellClick(product.id, 'stock', product.stock_quantity)}
                  title={isAdmin ? "Click to edit Warehouse A stock" : ""}
                >
                  {editingCell?.id === product.id && editingCell?.field === 'stock' ? (
                    <input
                      type="number"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleCellBlur}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="w-20 px-2 py-1 border rounded"
                    />
                  ) : (
                    <span className={((product.stock_quantity || 0) + (product.stock_quantity_b || 0)) <= product.low_stock_threshold ? "text-destructive font-semibold" : ""}>
                      {product.stock_quantity}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className={isAdmin ? "cursor-pointer hover:bg-muted/50" : ""}
                  onClick={() => handleCellClick(product.id, 'stock_b', product.stock_quantity_b ?? 0)}
                  title={isAdmin ? "Click to edit Warehouse B stock" : ""}
                >
                  {editingCell?.id === product.id && editingCell?.field === 'stock_b' ? (
                    <input
                      type="number"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleCellBlur}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="w-20 px-2 py-1 border rounded"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span>{product.stock_quantity_b ?? 0}</span>
                      {((product.stock_quantity || 0) + (product.stock_quantity_b || 0)) <= product.low_stock_threshold && (
                        <Badge variant="destructive" className="text-xs">Low</Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {isAdmin ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggleActiveMutation.mutate({
                          id: product.id,
                          isActive: product.is_active,
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
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setInventoryProduct(product)}
                        title="Adjust Inventory"
                      >
                        <Package className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(product)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(product.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product? This action cannot be undone.
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

      <InventoryDialog
        product={inventoryProduct}
        open={!!inventoryProduct}
        onOpenChange={(open) => !open && setInventoryProduct(null)}
      />
    </>
  );
};
