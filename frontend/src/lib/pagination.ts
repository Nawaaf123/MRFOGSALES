import { api } from "@/lib/api";

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export const DEFAULT_PAGE_SIZE = 50;
export const CATALOG_PAGE_SIZE = 200;

export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function buildPageParams(
  params: Record<string, string | number | boolean | null | undefined> = {}
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** Fetch every page of a paginated list endpoint (for dropdowns / offline catalogs). */
export async function fetchAllPages<T>(
  path: string,
  options?: {
    pageSize?: number;
    extraParams?: Record<string, string | number | boolean | null | undefined>;
    timeoutMs?: number;
  }
): Promise<T[]> {
  const pageSize = options?.pageSize ?? CATALOG_PAGE_SIZE;
  const items: T[] = [];
  let page = 1;
  let total = Infinity;

  while (items.length < total) {
    const pageQs = buildPageParams({
      ...(options?.extraParams || {}),
      page,
      page_size: pageSize,
    }).replace(/^\?/, "");
    const url = path.includes("?") ? `${path}&${pageQs}` : `${path}?${pageQs}`;

    const data = await api<Paginated<T>>(url, {
      timeoutMs: options?.timeoutMs,
    });
    items.push(...(data.items || []));
    total = Number(data.total || 0);
    if (!data.items?.length) break;
    page += 1;
    if (page > 500) break;
  }

  return items;
}
