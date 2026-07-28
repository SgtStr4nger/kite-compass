// Central API helper. Injects the admin Bearer token (kept in module memory +
// React context) into every request. NO localStorage — blocked in the sandbox iframe.
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

let authToken: string | null = null;
export function setAuthToken(t: string | null) { authToken = t; }
export function getAuthToken() { return authToken; }

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = (j as any).error ? JSON.stringify((j as any).error) : msg; } catch {}
    throw new Error(`${res.status}: ${msg}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// queryFn that reads queryKey[0] as a full path (may include query string),
// and attaches the auth header when present. Use with TanStack v5 object form.
export function authedQueryFn<T>() {
  return async ({ queryKey }: { queryKey: readonly unknown[] }): Promise<T> => {
    const path = queryKey[0] as string;
    return api<T>("GET", path);
  };
}
