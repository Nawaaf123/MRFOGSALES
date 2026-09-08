import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Upload, Download, FileSpreadsheet } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type ProductCreateRow = {
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  stock_quantity: number;
  low_stock_threshold: number;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
};

interface BulkProductUploadDialogProps {
  categoryFilter?: string;
  subcategoryFilter?: string;
  subSubcategoryFilter?: string;
}

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

export const BulkProductUploadDialog = ({
  categoryFilter = "all",
  subcategoryFilter = "all",
  subSubcategoryFilter = "all",
}: BulkProductUploadDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet([
      {
        "Product Name": "Example Product",
        SKU: "EX01-US",
        Barcode: "012345678905",
        Price: 9.99,
        Stock: 100,
        "Min Stock": 10,
        Category: categoryFilter !== "all" ? categoryFilter : "General",
        Subcategory: subcategoryFilter !== "all" ? subcategoryFilter : "",
        "Sub-subcategory": subSubcategoryFilter !== "all" ? subSubcategoryFilter : "",
      },
    ]);
    ws["!cols"] = [
      { wch: 30 },
      { wch: 14 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 12 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "product_upload_template.xlsx");
  };

  const mutation = useMutation({
    mutationFn: (products: ProductCreateRow[]) =>
      api<{ created: number; updated?: number }>("/bulk/products", {
        method: "POST",
        body: JSON.stringify({ products }),
      }),
    onSuccess: (result) => {
      const updated = result.updated ?? 0;
      toast({
        title: "Products imported",
        description:
          updated > 0
            ? `Created ${result.created}, updated ${updated}`
            : `${result.created} products have been added successfully`,
      });
      setFile(null);
      setIsOpen(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error: ApiError) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import products",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx");
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        const products = jsonData
          .map((row) => {
            const minStockRaw = cell(row, "Min Stock", "Low Stock", "low_stock_threshold");
            const stockRaw = cell(row, "Stock", "Stock A", "stock_quantity");
            return {
              name: cell(row, "Product Name", "Name", "name"),
              sku: cell(row, "SKU", "Sku", "sku") || null,
              barcode: cell(row, "Barcode", "BARCODE", "barcode") || null,
              price: parseFloat(cell(row, "Price", "price") || "0") || 0,
              stock_quantity: parseInt(stockRaw || "0", 10) || 0,
              low_stock_threshold: parseInt(minStockRaw || "10", 10) || 0,
              category:
                cell(row, "Category", "category") ||
                (categoryFilter !== "all" ? categoryFilter : "General"),
              subcategory:
                cell(row, "Subcategory", "subcategory") ||
                (subcategoryFilter !== "all" ? subcategoryFilter : "") ||
                null,
              sub_subcategory:
                cell(row, "Sub-subcategory", "sub_subcategory") ||
                (subSubcategoryFilter !== "all" ? subSubcategoryFilter : "") ||
                null,
            };
          })
          .filter((product) => product.name);

        if (products.length === 0) {
          toast({
            title: "No valid products",
            description: "The file contains no valid products. Ensure each row has a product name.",
            variant: "destructive",
          });
          return;
        }

        mutation.mutate(products);
      } catch {
        toast({
          title: "Error reading file",
          description: "Could not parse the Excel file. Please check the format.",
          variant: "destructive",
        });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-2" />
          Bulk Import
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Import Products</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <p className="text-sm text-muted-foreground">
              Download the template, fill in your products, and upload it back. Matching barcode or SKU
              updates existing products.
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Upload Excel File</label>
            <Input type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
          </div>

          {file && (
            <div className="flex items-center gap-2 p-2 bg-muted rounded">
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              <span className="text-sm truncate flex-1">{file.name}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!file || mutation.isPending}>
              {mutation.isPending ? "Importing..." : "Import Products"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
