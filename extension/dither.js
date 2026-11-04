// Procedural dither art (Bayer-ordered halftone clouds + pixel checker), drawn into
// any <canvas data-dither="clouds|checker|strip" data-seed="n">. No image assets.
(() => {
  const C = {
    ivory: [247, 244, 237], cobalt: [7, 91, 255], ink: [23, 43, 115],
    peri: [201, 210, 255], magenta: [211, 76, 134],
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function noise2(seed) {
    const r = rng(seed), g = Array.from({ length: 256 }, r);
    const h = (x, y) => g[((x * 73856093) ^ (y * 19349663)) & 255];
    const sm = (t) => t * t * (3 - 2 * t);
    const v = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    return (x, y) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += amp * v(x * f, y * f); amp /= 2; f *= 2; } return s; };
  }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  function draw(cv) {
    const kind = cv.dataset.dither || "clouds";
    const px = Number(cv.dataset.px || 3);
    const W = Math.ceil(cv.clientWidth / px), H = Math.ceil(cv.clientHeight / px);
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), d = img.data;
    const seed = Number(cv.dataset.seed || 7), n = noise2(seed), r = rng(seed + 1);
    const set = (x, y, c) => { const i = (y * W + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
    const checkTop = kind === "strip" ? 0 : Math.floor(H * 0.68);

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const th = BAYER[(y & 3) * 4 + (x & 3)];
      let col = C.ivory;
      if (kind !== "strip") {
        // cloud mass: noise thresholded against a horizon that rises to the right
        const cloud = n(x * px / 42, y * px / 27) - (1 - y / H) * 0.55 + (x / W) * 0.12;
        const tone = Math.min(1, Math.max(0, (cloud - 0.18) * 2.4));
        const sky = mix(C.magenta, C.peri, Math.min(1, y / (H * 0.6)));
        if (tone > th) col = tone > 0.75 + th * 0.25 ? C.cobalt : sky;
      }
      if (y >= checkTop) {
        // pixel checker that erodes upward
        const cell = Math.max(2, Math.round(9 / px)), depth = (y - checkTop) / Math.max(1, H - checkTop);
        const on = ((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0;
        const keep = kind === "strip" ? n(x * px / 18, y * px / 9) > 0.42 : depth + n(x * px / 15, y * px / 12) * 0.6 > 0.55;
        if (keep) col = on ? C.cobalt : (r() < 0.12 ? C.peri : C.ivory);
        else if (r() < 0.06 * depth) col = C.cobalt;
      }
      set(x, y, col);
    }
    if (cv.dataset.tentacle) tentacle(W, H, set, Number(cv.dataset.tentacle));
    ctx.putImageData(img, 0, 0);
  }

  // Curling octopus tentacle: a tapering spiral, cylinder-shaded with ordered dither,
  // with ringed suckers along its inner edge.
  function tentacle(W, H, set, scale) {
    const cx = W * 0.8, cy = H * 0.42, R0 = H * 0.95 * scale, N = 500, pts = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), a = Math.PI * 0.35 - t * 2.3 * Math.PI, r = R0 * Math.pow(1 - t, 2.1) + 1.5;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) * 0.95, w: (H * 0.2 * scale) * Math.pow(1 - t, 1.1) + 1 });
    }
    // arclength positions for suckers
    let L = 0; pts[0].s = 0;
    for (let i = 1; i < N; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].s = L; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < N; i++) {
        const p = pts[i], dx = x - p.x, dy = y - p.y, d = dx * dx + dy * dy;
        const nd = d / (p.w * p.w); if (nd < 1 && nd < bd) { bd = nd; best = i; }
      }
      if (best < 0) continue;
      const p = pts[best], q = pts[Math.min(N - 1, best + 1)], o = pts[Math.max(0, best - 1)];
      const tx = q.x - o.x, ty = q.y - o.y, tl = Math.hypot(tx, ty) || 1;
      const side = ((x - p.x) * ty - (y - p.y) * tx) / tl / p.w; // -1..1 across the limb
      const th = BAYER[(y & 3) * 4 + (x & 3)];
      let col;
      // suckers on the inner side (toward the spiral centre)
      const spacing = Math.max(3, p.w * 1.25), k = Math.round(p.s / spacing);
      const sp = pts.reduce((b, c) => (Math.abs(c.s - k * spacing) < Math.abs(b.s - k * spacing) ? c : b), p);
      const sr = sp.w * 0.42, sx = sp.x + (ty / tl) * sp.w * 0.45, sy = sp.y - (tx / tl) * sp.w * 0.45;
      const sd = Math.hypot(x - sx, y - sy);
      if (side > 0.05 && sr >= 1.2 && sd < sr) {
        col = sd > sr * 0.62 ? C.ink : sd < sr * 0.28 ? C.cobalt : C.peri;
      } else if (Math.abs(side) > 0.86) {
        col = C.ink; // outline
      } else {
        const dens = 0.42 - side * 0.45 + (1 - Math.abs(side)) * -0.1; // lit from the inner side
        col = dens > 0.78 + th * 0.2 ? C.ink : dens > th ? C.cobalt : C.peri;
      }
      set(x, y, col);
    }
  }

  const run = () => document.querySelectorAll("canvas[data-dither]").forEach(draw);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  window.drawDither = draw;
})();
