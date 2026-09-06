import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  INVOICE_SYNC_QUEUE_EVENT,
  invoiceSyncQueueQueryKey,
  isNetworkApiError,
  loadInvoiceSyncQueue,
  queueItemToCreateBody,
  removeInvoiceSyncQueueItem,
  updateInvoiceSyncQueueItem,
  type InvoiceSyncQueueItem,
} from "@/lib/invoiceSyncQueue";

type SyncResult = { synced: number; failed: number };

let drainLock = false;

async function drainInvoiceSyncQueue(userId: string): Promise<SyncResult> {
  if (drainLock) return { synced: 0, failed: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { synced: 0, failed: 0 };
  }

  drainLock = true;
  let synced = 0;
  let failed = 0;

  try {
    const queue = loadInvoiceSyncQueue(userId).filter(
      (item) => item.status === "pending" || item.status === "failed" || item.status === "syncing"
    );

    for (const item of queue) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;

      updateInvoiceSyncQueueItem(userId, item.client_request_id, {
        status: "syncing",
        last_error: null,
      });

      try {
        await api("/invoices", {
          method: "POST",
          body: JSON.stringify(queueItemToCreateBody(item)),
          timeoutMs: 15000,
        });
        removeInvoiceSyncQueueItem(userId, item.client_request_id);
        synced += 1;
      } catch (err) {
        const error = err as ApiError;
        if (isNetworkApiError(error)) {
          updateInvoiceSyncQueueItem(userId, item.client_request_id, {
            status: "pending",
            attempts: (item.attempts || 0) + 1,
            last_error: error.message || "No network",
          });
          break;
        }
        if (error.status === 401) {
          updateInvoiceSyncQueueItem(userId, item.client_request_id, {
            status: "pending",
            last_error: "Session expired — sign in again to sync",
          });
          break;
        }
        updateInvoiceSyncQueueItem(userId, item.client_request_id, {
          status: "failed",
          attempts: (item.attempts || 0) + 1,
          last_error: error.message || "Sync failed",
        });
        failed += 1;
      }
    }
  } finally {
    drainLock = false;
  }

  return { synced, failed };
}

/**
 * Background drain of the offline invoice create queue.
 * Mount once inside the authenticated shell.
 */
export function InvoiceSyncRunner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userId = user?.id;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refreshQueueQuery = useCallback(() => {
    if (!userId) return;
    queryClient.setQueryData(invoiceSyncQueueQueryKey(userId), loadInvoiceSyncQueue(userId));
  }, [queryClient, userId]);

  const runDrain = useCallback(async () => {
    if (!userId) return;
    const result = await drainInvoiceSyncQueue(userId);
    refreshQueueQuery();
    if (result.synced > 0) {
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["pending-payments"] });
      toastRef.current({
        title: result.synced === 1 ? "Invoice synced" : `${result.synced} invoices synced`,
        description: "Pending create(s) uploaded to the server.",
      });
    }
  }, [userId, refreshQueueQuery, queryClient]);

  useEffect(() => {
    if (!userId) return;
    refreshQueueQuery();

    const onOnline = () => {
      void runDrain();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void runDrain();
    };
    const onQueueEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      refreshQueueQuery();
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(INVOICE_SYNC_QUEUE_EVENT, onQueueEvent);

    const timer = window.setTimeout(() => void runDrain(), 800);
    const interval = window.setInterval(() => void runDrain(), 45_000);

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(INVOICE_SYNC_QUEUE_EVENT, onQueueEvent);
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [userId, runDrain, refreshQueueQuery]);

  return null;
}

export function useInvoiceSyncQueue(userId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    queryClient.setQueryData(invoiceSyncQueueQueryKey(userId), loadInvoiceSyncQueue(userId));
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId && detail.userId !== userId) return;
      queryClient.setQueryData(invoiceSyncQueueQueryKey(userId), loadInvoiceSyncQueue(userId));
    };
    window.addEventListener(INVOICE_SYNC_QUEUE_EVENT, onEvent);
    return () => window.removeEventListener(INVOICE_SYNC_QUEUE_EVENT, onEvent);
  }, [userId, queryClient]);
}

export async function syncInvoiceQueueNow(userId: string): Promise<SyncResult> {
  return drainInvoiceSyncQueue(userId);
}

export function queueItemAsLocalInvoice(item: InvoiceSyncQueueItem) {
  return {
    id: `local-sync:${item.client_request_id}`,
    invoice_number:
      item.status === "failed"
        ? "Sync failed"
        : item.status === "syncing"
          ? "Syncing…"
          : "Pending sync",
    shop_id: item.shop_id,
    created_by: item.user_id,
    total_amount: item.total_amount,
    discount_amount: item.discount_amount,
    payment_status: item.payment_status,
    notes: item.notes,
    warehouse: item.warehouse,
    created_at: item.created_at,
    items: item.items,
    payments: item.payments.map((p, idx) => ({
      id: `local-pay:${item.client_request_id}:${idx}`,
      amount: p.amount,
      payment_method: p.payment_method,
      payment_date: item.created_at.slice(0, 10),
    })),
    shop: {
      id: item.shop_id,
      name: item.shop_name,
    },
    amount_paid: item.amount_paid,
    local_sync: item.status,
    local_sync_error: item.last_error,
    client_request_id: item.client_request_id,
  };
}
