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
import * as XLSX from "xlsx";

type ProductCreateRow = {
  name: string;
  price: number;
  stock_quantity: number;
  category: string;
  subcategory: string | null;
  sub_subcategory: string | null;
};

interface BulkProductUploadDialogProps {
  categoryFilter?: string;
  subcategoryFilter?: string;
  subSubcategoryFilter?: string;
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

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        "Product Name": "Example Product",
        Price: 9.99,
        Stock: 100,
        Category: categoryFilter !== "all" ? categoryFilter : "General",
        Subcategory: subcategoryFilter !== "all" ? subcategoryFilter : "",
        "Sub-subcategory": subSubcategoryFilter !== "all" ? subSubcategoryFilter : "",
      },
    ]);
    ws["!cols"] = [
      { wch: 30 },
      { wch: 10 },
      { wch: 10 },
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
      api<{ created: number }>("/bulk/products", {
        method: "POST",
        body: JSON.stringify({ products }),
      }),
    onSuccess: (result) => {
      toast({
        title: "Products imported",
        description: `${result.created} products have been added successfully`,
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
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

        const products = jsonData
          .map((row) => ({
            name: String(row["Product Name"] ?? "").trim(),
            price: parseFloat(String(row["Price"] ?? 0)) || 0,
            stock_quantity: parseInt(String(row["Stock"] ?? 0), 10) || 0,
            category:
              String(row["Category"] ?? "").trim() ||
              (categoryFilter !== "all" ? categoryFilter : "General"),
            subcategory:
              String(row["Subcategory"] ?? "").trim() ||
              (subcategoryFilter !== "all" ? subcategoryFilter : "") ||
              null,
            sub_subcategory:
              String(row["Sub-subcategory"] ?? "").trim() ||
              (subSubcategoryFilter !== "all" ? subSubcategoryFilter : "") ||
              null,
          }))
          .filter((product) => product.name && product.price > 0);

        if (products.length === 0) {
          toast({
            title: "No valid products",
            description:
              "The file contains no valid products. Ensure each row has a name and price > 0.",
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
              Download the template, fill in your products, and upload it back.
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
