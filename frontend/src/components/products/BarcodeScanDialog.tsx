import { useEffect, useRef } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type BarcodeScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
};

const SCANNER_ELEMENT_ID = "cf-barcode-scanner";

export function BarcodeScanDialog({ open, onOpenChange, onScan }: BarcodeScanDialogProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handledRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onOpenChangeRef = useRef(onOpenChange);
  onScanRef.current = onScan;
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    handledRef.current = false;
    let cancelled = false;

    const start = async () => {
      await new Promise((r) => setTimeout(r, 80));
      if (cancelled) return;

      const el = document.getElementById(SCANNER_ELEMENT_ID);
      if (!el) return;

      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.ITF,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (decoded) => {
            const code = decoded.trim();
            if (!code || handledRef.current) return;
            handledRef.current = true;
            onScanRef.current(code);
            onOpenChangeRef.current(false);
          },
          () => undefined
        );
      } catch {
        // Permission / no camera — user can cancel
      }
    };

    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        void scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => undefined);
      }
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-4">
          <DialogHeader>
            <DialogTitle>Scan barcode</DialogTitle>
            <DialogDescription>
              Point the camera at the product barcode. Bluetooth scanners also work in the product
              search box.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="space-y-3 p-4">
          <div
            id={SCANNER_ELEMENT_ID}
            className="min-h-[240px] overflow-hidden rounded-xl border border-primary/20 bg-black"
          />
          <p className="text-center text-xs text-muted-foreground">
            Allow camera access if prompted
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
