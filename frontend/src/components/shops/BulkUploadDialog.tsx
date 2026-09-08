import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

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

type GeocodeBatch = {
  attempted: number;
  updated: number;
  skipped: number;
  remaining: number;
};

const CHUNK_SIZE = 100;

function cell(row: Record<string, unknown>, ...keys: string[]): string {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v])
  );
  for (const key of keys) {
    const value = normalized[key.toLowerCase()];
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

export const BulkUploadDialog = ({ open, onOpenChange, onSuccess }: BulkUploadDialogProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ created: number; geocoded: number } | null>(
    null
  );
  const { toast } = useToast();

  const downloadTemplate = async () => {
    const XLSX = await import("xlsx");
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
    const XLSX = await import("xlsx");
    const data = await fileToParse.arrayBuffer();
    const workbook = XLSX.read(data);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, unknown>[];

    return jsonData
      .map((row) => ({
        name: cell(row, "Shop Name", "Name", "Shop", "store name", "business name"),
        email: cell(row, "E-mail", "Email", "Email Address") || null,
        phone: cell(row, "Phone Number", "Phone", "Mobile", "Tel") || null,
        street_address:
          cell(row, "Street Address", "Address", "Street", "Address 1", "Address Line 1") || null,
        street_address_line_2:
          cell(row, "Street Address Line 2", "Address 2", "Address Line 2") || null,
        city: cell(row, "City", "Town") || null,
        state: cell(row, "State", "Province", "ST") || null,
        zip_code: cell(row, "Zip Code", "Zip", "Postal Code", "ZIP") || null,
        owner_name: cell(row, "Owner", "Owner Name", "Contact") || null,
      }))
      .filter((shop) => shop.name);
  };

  const geocodeAllMissing = async () => {
    let totalUpdated = 0;
    let rounds = 0;
    // Cap rounds so a stuck loop can't run forever (700 shops / 50 = 14)
    while (rounds < 40) {
      rounds += 1;
      setProgress(`Geocoding batch ${rounds}...`);
      const result = await api<GeocodeBatch>("/shops/geocode-missing?limit=50", {
        method: "POST",
      });
      totalUpdated += result.updated;
      setProgress(
        `Geocoded ${totalUpdated} so far · ${result.remaining} shops still missing coordinates`
      );
      if (result.remaining === 0 || result.attempted === 0) break;
    }
    return totalUpdated;
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadStatus(null);
    setProgress(null);

    try {
      const shops = await parseFile(file);
      if (shops.length === 0) {
        toast({
          title: "No valid shops",
          description: "Each row needs a Shop Name (or Name) column.",
          variant: "destructive",
        });
        return;
      }

      let created = 0;
      for (let i = 0; i < shops.length; i += CHUNK_SIZE) {
        const chunk = shops.slice(i, i + CHUNK_SIZE);
        setProgress(`Importing shops ${i + 1}-${Math.min(i + CHUNK_SIZE, shops.length)} of ${shops.length}...`);
        const result = await api<{ created: number }>("/bulk/shops", {
          method: "POST",
          body: JSON.stringify({ shops: chunk, geocode: false }),
        });
        created += result.created;
      }

      setProgress("Import done. Geocoding addresses for the map (this can take a few minutes)...");
      const geocoded = await geocodeAllMissing();

      setUploadStatus({ created, geocoded });
      toast({
        title: "Upload Complete",
        description: `Added ${created} shops. Mapped ${geocoded} addresses to the map.`,
      });

      setTimeout(() => {
        onSuccess();
        onOpenChange(false);
        setUploadStatus(null);
        setProgress(null);
        setFile(null);
      }, 1500);
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
          setProgress(null);
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
              Use the template columns (or similar headers). You do <strong>not</strong> need
              latitude/longitude — addresses are geocoded after import.
            </p>
            <p className="text-xs text-muted-foreground">
              Expected headers: Shop Name, Street Address, City, State, Zip Code, Phone, E-mail,
              Owner (flexible aliases accepted).
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="h-4 w-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center space-y-3">
            <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Works for large lists (700+). Import first, then map pins are filled in batches.
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
              {isUploading ? "Working..." : "Import Shops"}
            </Button>
          </div>

          {progress && (
            <p className="text-sm text-muted-foreground text-center">{progress}</p>
          )}

          {uploadStatus && (
            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>
                  {uploadStatus.created} shops added · {uploadStatus.geocoded} mapped
                </span>
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
