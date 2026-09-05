/** Persist create-invoice form so weak networks don't wipe sales work. */

export type InvoiceCreateDraftItem = {
  product_id: string;
  product_name: string;
  product_sku?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type InvoiceCreateDraft = {
  version: 1;
  client_request_id: string;
  shop_id: string;
  notes: string;
  discount_amount: string;
  warehouse: "A" | "B";
  items: InvoiceCreateDraftItem[];
  cash_amount: string;
  check_amount: string;
  credit_amount: string;
  updated_at: string;
};

const keyFor = (userId: string) => `cf_invoice_create_draft:${userId}`;

export function loadInvoiceCreateDraft(userId: string): InvoiceCreateDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InvoiceCreateDraft;
    if (!parsed || parsed.version !== 1 || !parsed.client_request_id) return null;
    if (!Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveInvoiceCreateDraft(userId: string, draft: InvoiceCreateDraft): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(draft));
  } catch {
    // Quota / private mode — ignore; create can still proceed online.
  }
}

export function clearInvoiceCreateDraft(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    // ignore
  }
}

export function draftHasWork(draft: InvoiceCreateDraft | null | undefined): boolean {
  if (!draft) return false;
  return Boolean(draft.shop_id) || draft.items.length > 0 || Boolean(draft.notes.trim());
}

export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `inv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isNetworkApiError(error: { message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 0) return true;
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("no network") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed")
  );
}
