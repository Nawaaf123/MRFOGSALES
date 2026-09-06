const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const TOKEN_KEY = "cf_access_token";

export type ApiError = { message: string; status?: number };

export type ApiOptions = RequestInit & {
  /** Abort the request after this many ms (treat as network failure). */
  timeoutMs?: number;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { timeoutMs, signal: outerSignal, ...fetchInit } = options;
  const headers = new Headers(fetchInit.headers || {});
  if (!headers.has("Content-Type") && fetchInit.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchInit,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted =
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.name === "AbortError");
    const error: ApiError = {
      message: aborted ? "Request timed out" : "No network connection",
      status: 0,
    };
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (Array.isArray(data?.detail)) message = data.detail[0]?.msg || message;
    } catch {
      // ignore parse errors
    }
    const error: ApiError = { message, status: response.status };
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
