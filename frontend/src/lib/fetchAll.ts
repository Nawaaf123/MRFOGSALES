/**
 * Helpers to safely fetch large result sets from the backend.
 *
 * The Data API caps every request at 1000 rows. These helpers page through
 * results (and chunk long `IN (...)` filters) so nothing is silently dropped.
 */

const PAGE_SIZE = 1000;

/**
 * Runs a query builder repeatedly with .range() until all rows are fetched.
 * `build` must return a fresh query builder each call.
 */
export async function fetchAllRows<T>(
  build: () => any,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // Hard safety stop: 200k rows
  for (let i = 0; i < 200; i++) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data || []) as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/**
 * Same as fetchAllRows but also splits a long list of ids into chunks so the
 * request URL never exceeds gateway limits.
 * `build(chunk)` must return a fresh query builder filtered by that chunk.
 */
export async function fetchAllByIds<T>(
  ids: string[],
  build: (chunk: string[]) => any,
  chunkSize = 100,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const part = await fetchAllRows<T>(() => build(chunk), pageSize);
    rows.push(...part);
  }
  return rows;
}
