/** Offline / failed invoice creates waiting to POST when the network returns. */

import { isNetworkApiError, isValidUuid } from "@/lib/invoiceCreateDraft";

export type InvoiceSyncPaymentMethod = "cash" | "check" | "credit";

export type InvoiceSyncQueueItem = {
  version: 1;
  client_request_id: string;
  user_id: string;
  shop_id: string;
  shop_name: string;
  notes: string | null;
  discount_amount: number;
  warehouse: "A" | "B";
  items: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
  }>;
  payments: Array<{ amount: number; payment_method: InvoiceSyncPaymentMethod }>;
  total_amount: number;
  amount_paid: number;
  payment_status: "paid" | "partial" | "unpaid";
  status: "pending" | "syncing" | "failed";
  last_error: string | null;
  created_at: string;
  updated_at: string;
  attempts: number;
};

export const INVOICE_SYNC_QUEUE_EVENT = "cf-invoice-sync-queue";

const keyFor = (userId: string) => `cf_invoice_sync_queue:${userId}`;

export function invoiceSyncQueueQueryKey(userId: string) {
  return ["invoice-sync-queue", userId] as const;
}

export function notifyInvoiceSyncQueueChanged(userId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(INVOICE_SYNC_QUEUE_EVENT, { detail: { userId } }));
}

function readRaw(userId: string): InvoiceSyncQueueItem[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InvoiceSyncQueueItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        item.version === 1 &&
        isValidUuid(item.client_request_id) &&
        isValidUuid(item.shop_id) &&
        Array.isArray(item.items) &&
        item.items.length > 0
    );
  } catch {
    return [];
  }
}

function writeRaw(userId: string, items: InvoiceSyncQueueItem[]) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(items));
  } catch {
    // Quota / private mode
  }
  notifyInvoiceSyncQueueChanged(userId);
}

export function loadInvoiceSyncQueue(userId: string): InvoiceSyncQueueItem[] {
  return readRaw(userId);
}

export function getInvoiceSyncQueueItem(
  userId: string,
  clientRequestId: string
): InvoiceSyncQueueItem | null {
  return readRaw(userId).find((i) => i.client_request_id === clientRequestId) || null;
}

export function upsertInvoiceSyncQueueItem(userId: string, item: InvoiceSyncQueueItem): void {
  const items = readRaw(userId);
  const idx = items.findIndex((i) => i.client_request_id === item.client_request_id);
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  writeRaw(userId, items);
}

export function updateInvoiceSyncQueueItem(
  userId: string,
  clientRequestId: string,
  patch: Partial<InvoiceSyncQueueItem>
): InvoiceSyncQueueItem | null {
  const items = readRaw(userId);
  const idx = items.findIndex((i) => i.client_request_id === clientRequestId);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...patch, updated_at: new Date().toISOString() };
  writeRaw(userId, items);
  return items[idx];
}

export function removeInvoiceSyncQueueItem(userId: string, clientRequestId: string): void {
  writeRaw(
    userId,
    readRaw(userId).filter((i) => i.client_request_id !== clientRequestId)
  );
}

export function paymentStatusFromAmounts(
  totalAmount: number,
  amountPaid: number
): "paid" | "partial" | "unpaid" {
  if (amountPaid <= 0.01) return "unpaid";
  if (amountPaid + 0.01 >= totalAmount) return "paid";
  return "partial";
}

export function buildSyncQueueItem(input: {
  userId: string;
  clientRequestId: string;
  shopId: string;
  shopName: string;
  notes: string | null;
  discountAmount: number;
  warehouse: "A" | "B";
  items: InvoiceSyncQueueItem["items"];
  payments: InvoiceSyncQueueItem["payments"];
}): InvoiceSyncQueueItem {
  const subtotal = input.items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);
  const totalAmount = Math.max(0, subtotal - (Number(input.discountAmount) || 0));
  const amountPaid = input.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const now = new Date().toISOString();
  return {
    version: 1,
    client_request_id: input.clientRequestId,
    user_id: input.userId,
    shop_id: input.shopId,
    shop_name: input.shopName || "Unknown shop",
    notes: input.notes,
    discount_amount: Number(input.discountAmount) || 0,
    warehouse: input.warehouse,
    items: input.items,
    payments: input.payments,
    total_amount: totalAmount,
    amount_paid: amountPaid,
    payment_status: paymentStatusFromAmounts(totalAmount, amountPaid),
    status: "pending",
    last_error: null,
    created_at: now,
    updated_at: now,
    attempts: 0,
  };
}

export function queueItemToCreateBody(item: InvoiceSyncQueueItem) {
  return {
    client_request_id: item.client_request_id,
    shop_id: item.shop_id,
    items: item.items.map((row) => ({
      product_id: row.product_id,
      product_name: row.product_name,
      quantity: row.quantity,
      unit_price: row.unit_price,
      subtotal: row.subtotal,
    })),
    discount_amount: item.discount_amount,
    notes: item.notes,
    warehouse: item.warehouse,
    payments: item.payments,
  };
}

export { isNetworkApiError };
