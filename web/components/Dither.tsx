"use client";
import { useEffect, useRef } from "react";

declare global { interface Window { drawDither?: (c: HTMLCanvasElement) => void } }

/** Canvas painted by /dither.js (same generator as the extension). */
export function Dither({ kind = "clouds", seed = 7, px = 3, tentacle, className }: {
  kind?: "clouds" | "strip"; seed?: number; px?: number; tentacle?: number; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => ref.current && window.drawDither?.(ref.current);
    if (window.drawDither) draw();
    else { const t = setInterval(() => { if (window.drawDither) { clearInterval(t); draw(); } }, 50); return () => clearInterval(t); }
    const ro = new ResizeObserver(draw);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [kind, seed, px, tentacle]);
  return (
    <canvas ref={ref} className={className} data-dither={kind} data-seed={seed} data-px={px}
      {...(tentacle ? { "data-tentacle": tentacle } : {})} aria-hidden="true" />
  );
}
