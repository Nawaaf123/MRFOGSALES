import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type BarcodeScanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
};

const SCANNER_ELEMENT_ID = "cf-barcode-scanner";
const SCAN_COOLDOWN_MS = 1500;

async function stopHtml5Qrcode(scanner: Html5Qrcode | null) {
  if (!scanner) return;
  try {
    const state = scanner.getState();
    // 2 = SCANNING, 3 = PAUSED
    if (state === 2 || state === 3) {
      await scanner.stop();
    }
  } catch {
    // ignore
  }
  try {
    scanner.clear();
  } catch {
    // ignore
  }
}

export function BarcodeScanDialog({ open, onOpenChange, onScan }: BarcodeScanDialogProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const closingRef = useRef(false);
  const lastScanAtRef = useRef(0);
  const lastCodeRef = useRef("");
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const closeSafely = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setBusy(true);
    const scanner = scannerRef.current;
    scannerRef.current = null;
    await stopHtml5Qrcode(scanner);
    setBusy(false);
    closingRef.current = false;
    setLastAdded(null);
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) return;

    closingRef.current = false;
    lastScanAtRef.current = 0;
    lastCodeRef.current = "";
    setCameraError(null);
    setBusy(false);
    setLastAdded(null);
    let cancelled = false;

    const start = async () => {
      await new Promise((r) => setTimeout(r, 120));
      if (cancelled) return;

      const el = document.getElementById(SCANNER_ELEMENT_ID);
      if (!el) {
        setCameraError("Scanner view failed to load. Close and try again.");
        return;
      }

      el.innerHTML = "";

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
          { fps: 8, qrbox: { width: 260, height: 140 } },
          (decoded) => {
            const code = decoded.trim();
            if (!code || closingRef.current) return;

            const now = Date.now();
            // Ignore rapid repeats of the same code while the camera stays on it
            if (
              code === lastCodeRef.current &&
              now - lastScanAtRef.current < SCAN_COOLDOWN_MS
            ) {
              return;
            }
            lastCodeRef.current = code;
            lastScanAtRef.current = now;
            setLastAdded(code);
            onScanRef.current(code);
          },
          () => undefined
        );
        if (cancelled) {
          await stopHtml5Qrcode(scanner);
          if (scannerRef.current === scanner) scannerRef.current = null;
        }
      } catch {
        if (!cancelled) {
          setCameraError(
            "Could not open the camera. Allow camera permission, or use a Bluetooth scanner in the search box."
          );
        }
        await stopHtml5Qrcode(scanner);
        if (scannerRef.current === scanner) scannerRef.current = null;
      }
    };

    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      void stopHtml5Qrcode(scanner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else void closeSafely();
      }}
    >
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="border-b border-primary/10 bg-gradient-to-r from-primary/15 to-transparent px-6 py-4">
          <DialogHeader>
            <DialogTitle>Scan barcodes</DialogTitle>
            <DialogDescription>
              Keep scanning — each code adds a line. Tap Done when finished.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="space-y-3 p-4">
          {cameraError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
              {cameraError}
            </div>
          ) : (
            <div
              id={SCANNER_ELEMENT_ID}
              className="min-h-[240px] overflow-hidden rounded-xl border border-primary/20 bg-black"
            />
          )}
          {lastAdded && !cameraError && (
            <p className="rounded-lg bg-primary/10 px-3 py-2 text-center text-sm font-medium text-primary">
              Added · {lastAdded}
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            {busy
              ? "Closing camera…"
              : "Point at the next barcode, or tap Done to close"}
          </p>
          <Button
            type="button"
            className="h-11 w-full"
            disabled={busy}
            onClick={() => void closeSafely()}
          >
            {busy ? "Closing…" : "Done"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
