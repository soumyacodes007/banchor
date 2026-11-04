"use client";
import { EXTENSION_ID } from "./config";

type ChromeRuntime = { sendMessage: (id: string, msg: unknown, cb: (res: unknown) => void) => void; lastError?: { message?: string } };
const runtime = (): ChromeRuntime | null =>
  (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime ?? null;

/** Sends a message to the Banchor extension; resolves null if it isn't installed. */
export function toExtension<T = unknown>(msg: Record<string, unknown>): Promise<T | null> {
  const rt = runtime();
  if (!EXTENSION_ID || !rt?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(EXTENSION_ID, msg, (res) => { if (rt.lastError) resolve(null); else resolve(res as T); });
    } catch { resolve(null); }
  });
}
