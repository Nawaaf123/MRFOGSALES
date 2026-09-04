import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InvoiceForm } from "./InvoiceForm";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice?: any;
  onSuccess: () => void;
}

export const InvoiceDialog = ({ open, onOpenChange, invoice, onSuccess }: InvoiceDialogProps) => {
  const [busy, setBusy] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (busy && !next) return; // block close while saving
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6"
        // Never close on outside clicks or Escape — only Cancel/X buttons.
        // Outside clicks include taps on dropdown menus (they render in a
        // portal outside this element), which was wiping in-progress invoices.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {invoice ? "Edit Invoice" : "Create New Invoice"}
          </DialogTitle>
        </DialogHeader>
        <InvoiceForm
          invoice={invoice}
          onSuccess={onSuccess}
          onCancel={() => onOpenChange(false)}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  );
};
