import { BACKEND_URL } from "./config";
export async function api<T>(path: string): Promise<T | null> {
  if (!BACKEND_URL) return null;
  try {
    const r = await fetch(BACKEND_URL + path, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const usd = (n: number) => `$${n.toFixed(2)}`;
