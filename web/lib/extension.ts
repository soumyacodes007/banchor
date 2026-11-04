"use client";
import { EXTENSION_ID } from "./config";

type ChromeRuntime = { sendMessage: (id: string, msg: unknown, cb: (res: unknown) => void) => void; lastError?: { message?: string } };
const runtime = (): ChromeRuntime | null =>
  (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime ?? null;

/** Sends a message to the Banchor extension; resolves null if it isn't installed. */
const EXT_KEY = "banchor.ext";
/** Remembers the id the extension puts on every dashboard link (?ext=). */
export function rememberExtensionId(id: string | null) {
  if (id && /^[a-p]{32}$/.test(id)) try { localStorage.setItem(EXT_KEY, id); } catch { /* ignore */ }
}
function extensionId(): string {
  if (EXTENSION_ID) return EXTENSION_ID;
  const announced = document.documentElement.dataset.banchorExt; // set by extension/announce.js
  if (announced) { rememberExtensionId(announced); return announced; }
  try { return localStorage.getItem(EXT_KEY) || ""; } catch { return ""; }
}

export function toExtension<T = unknown>(msg: Record<string, unknown>): Promise<T | null> {
  const rt = runtime();
  const id = extensionId();
  if (!id || !rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(id, msg, (res) => { if (rt.lastError) resolve(null); else resolve(res as T); });
    } catch { resolve(null); }
  });
}
