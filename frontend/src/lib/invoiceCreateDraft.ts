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

export function isValidUuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

/** Works on HTTP (non-secure) mobile browsers where crypto.randomUUID is missing. */
export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through
    }
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort — still UUID-shaped
  const s = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}0000000000000000`.slice(0, 32);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-a${s.slice(17, 20)}-${s.slice(20, 32)}`;
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
    msg.includes("load failed") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("abort")
  );
}
