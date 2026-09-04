import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import * as XLSX from "xlsx";

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const BulkUploadDialog = ({ open, onOpenChange, onSuccess }: BulkUploadDialogProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ success: number; failed: number; total: number } | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(null);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const shops = jsonData.map((row: any) => ({
        name: row["Shop Name"]?.toString().trim() || "",
        email: row["E-mail"]?.toString().trim() || null,
        phone: row["Phone Number"]?.toString().trim() || null,
        street_address: row["Street Address"]?.toString().trim() || null,
        street_address_line_2: row["Street Address Line 2"]?.toString().trim() || null,
        city: row["City"]?.toString().trim() || null,
        state: row["State"]?.toString().trim() || null,
        zip_code: row["Zip Code"]?.toString().trim() || null,
        owner_name: null,
        created_by: user?.id,
      })).filter(shop => shop.name);

      let successCount = 0;
      let failedCount = 0;

      for (const shop of shops) {
        const { error } = await supabase.from("shops").insert(shop);
        if (error) {
          console.error("Failed to insert shop:", shop.name, error);
          failedCount++;
        } else {
          successCount++;
        }
      }

      setUploadStatus({
        success: successCount,
        failed: failedCount,
        total: shops.length,
      });

      if (successCount > 0) {
        toast({
          title: "Upload Complete",
          description: `Successfully added ${successCount} shop${successCount !== 1 ? 's' : ''}`,
        });
      }

      if (failedCount > 0) {
        toast({
          title: "Some shops failed",
          description: `${failedCount} shop${failedCount !== 1 ? 's' : ''} could not be added`,
          variant: "destructive",
        });
      }

      // Call onSuccess and close dialog after a brief delay to show results
      setTimeout(() => {
        onSuccess();
        onOpenChange(false);
        setUploadStatus(null);
      }, 2000);
    } catch (error: any) {
      console.error("Error processing file:", error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to process Excel file",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bulk Upload Shops</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              Upload an Excel file (.xlsx) with shop information
            </p>
            <div className="text-xs text-muted-foreground mb-4">
              Required columns: Shop Name, E-mail, Phone Number, Street Address, Street Address Line 2, City, State, Zip Code
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
              id="excel-upload"
            />
            <label htmlFor="excel-upload">
              <Button asChild disabled={isUploading}>
                <span>{isUploading ? "Uploading..." : "Choose File"}</span>
              </Button>
            </label>
          </div>

          {uploadStatus && (
            <div className="space-y-2 p-4 bg-muted rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{uploadStatus.success} shops added successfully</span>
              </div>
              {uploadStatus.failed > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span>{uploadStatus.failed} shops failed</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Total processed: {uploadStatus.total}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
