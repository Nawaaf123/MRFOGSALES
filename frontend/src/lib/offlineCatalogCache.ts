/** Last-known shops/products for create-invoice when the network is down. */

type CacheEnvelope<T> = {
  version: 1;
  updated_at: string;
  data: T;
};

const shopsKey = (userId: string) => `cf_offline_shops:${userId}`;
const productsKey = (userId: string) => `cf_offline_products:${userId}`;

function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.data as unknown[])) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function saveCache<T>(key: string, data: T) {
  try {
    const envelope: CacheEnvelope<T> = {
      version: 1,
      updated_at: new Date().toISOString(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // ignore quota
  }
}

export function saveOfflineShopsCache<T>(userId: string, shops: T[]) {
  saveCache(shopsKey(userId), shops);
}

export function loadOfflineShopsCache<T>(userId: string): T[] | null {
  return loadCache<T[]>(shopsKey(userId));
}

export function saveOfflineProductsCache<T>(userId: string, products: T[]) {
  saveCache(productsKey(userId), products);
}

export function loadOfflineProductsCache<T>(userId: string): T[] | null {
  return loadCache<T[]>(productsKey(userId));
}
