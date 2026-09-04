import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type ShopCreateRow = {
  name: string;
  email: string | null;
  phone: string | null;
  street_address: string | null;
  street_address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  owner_name: string | null;
};

export const BulkUploadDialog = ({ open, onOpenChange, onSuccess }: BulkUploadDialogProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ created: number } | null>(null);
  const { toast } = useToast();

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        "Shop Name": "Example Shop",
        "E-mail": "shop@example.com",
        "Phone Number": "555-0100",
        "Street Address": "123 Main St",
        "Street Address Line 2": "",
        City: "City",
        State: "ST",
        "Zip Code": "00000",
        Owner: "Owner Name",
      },
    ]);
    ws["!cols"] = [
      { wch: 24 },
      { wch: 24 },
      { wch: 16 },
      { wch: 24 },
      { wch: 24 },
      { wch: 14 },
      { wch: 8 },
      { wch: 10 },
      { wch: 18 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Shops");
    XLSX.writeFile(wb, "shop_upload_template.xlsx");
  };

  const parseFile = async (fileToParse: File): Promise<ShopCreateRow[]> => {
    const data = await fileToParse.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

    return jsonData
      .map((row) => ({
        name: String(row["Shop Name"] ?? "").trim(),
        email: String(row["E-mail"] ?? "").trim() || null,
        phone: String(row["Phone Number"] ?? "").trim() || null,
        street_address: String(row["Street Address"] ?? "").trim() || null,
        street_address_line_2: String(row["Street Address Line 2"] ?? "").trim() || null,
        city: String(row["City"] ?? "").trim() || null,
        state: String(row["State"] ?? "").trim() || null,
        zip_code: String(row["Zip Code"] ?? "").trim() || null,
        owner_name: String(row["Owner"] ?? "").trim() || null,
      }))
      .filter((shop) => shop.name);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadStatus(null);

    try {
      const shops = await parseFile(file);
      if (shops.length === 0) {
        toast({
          title: "No valid shops",
          description: "Each row needs a Shop Name.",
          variant: "destructive",
        });
        return;
      }

      const result = await api<{ created: number }>("/bulk/shops", {
        method: "POST",
        body: JSON.stringify({ shops }),
      });

      setUploadStatus({ created: result.created });
      toast({
        title: "Upload Complete",
        description: `Successfully added ${result.created} shop${result.created !== 1 ? "s" : ""}`,
      });

      setTimeout(() => {
        onSuccess();
        onOpenChange(false);
        setUploadStatus(null);
        setFile(null);
      }, 1200);
    } catch (error: unknown) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as ApiError).message)
          : "Failed to process Excel file";
      toast({
        title: "Upload Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setFile(null);
          setUploadStatus(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Upload Shops</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-4 bg-muted rounded-lg space-y-2">
            <p className="text-sm text-muted-foreground">
              Download the template, fill in shop rows, then upload the Excel file.
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center space-y-3">
            <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Required: Shop Name. Optional: E-mail, Phone Number, address fields, Owner.
            </p>
            <Input
              type="file"
              accept=".xlsx,.xls"
              disabled={isUploading}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
                <span className="truncate">{file.name}</span>
              </div>
            )}
            <Button onClick={handleUpload} disabled={!file || isUploading}>
              {isUploading ? "Uploading..." : "Import Shops"}
            </Button>
          </div>

          {uploadStatus && (
            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{uploadStatus.created} shops added successfully</span>
              </div>
              {uploadStatus.created === 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span>No shops were created</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
