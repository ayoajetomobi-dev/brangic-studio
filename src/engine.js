/* Comput engine — port of sphere_logo_dense.py with a size-aware scaling law.
 *
 * The original script draws a fixed number of marks at a fixed share of the
 * sphere width, so scaling the SVG up just makes every mark bigger.
 * Here the output size is an input. Mark size (grain) grows slower than the
 * logo (grain ∝ size^growth) and the mark count fills the difference so the
 * ink coverage, and therefore the shading, stays the same at every size.
 */
const Comput = (() => {
  const DEFAULTS = {
    size: 512,
    // scaling law
    base: 96,            // px size where the logo matches the original script
    baseMarks: 4200,     // MARKS at base size
    grainBase: 80,       // circle diameter = sphere width / grainBase at base size
    growth: 0.5,         // 0 = grain keeps its pixel size, 1 = grain scales with the logo
    minGrain: 0.8,       // px, smallest grain allowed (small sizes get fewer marks)
    maxMarks: 120000,    // cap; past it the grain grows instead
    // lighting
    lightX: -0.25, lightY: 0.45, shadowPacking: 5.0, rimPacking: 4.0,
    // centre diffusion: how much of the original density the centre keeps (100 = untouched)
    centre: 35,          // % density left in the thinned area (a sparse scatter always survives)
    centreReach: 50,     // % how far the thinning spreads
    centreMode: 'off',   // 'off', 'cross' (thins out from the middle) or 'hamburger' (a band across the middle)
    // marks
    lineShare: 0.6, lineLength: 1.9, lineWeight: 0.8,
    direction: 'radial', radialFrom: 'centre', foreshorten: 0.4,
    organic: 0.6, wiggle: 6, clustering: true,
    gap: 9,              // % of grain (0.5px at the original 5.5px grain)
    // colour
    color: '#111111', background: 'none', seed: 3,
    // ---------- illustration (image source) ----------
    source: 'sphere',    // 'sphere' = the logo, 'image' = any picture or render
    markPx: 2.5,         // mark size in px at the chosen output width
    ink: 1,              // overall density multiplier
    imgBrightness: 0,    // -1 … 1
    imgContrast: 1.2,    // 0 … 3
    imgCutoff: 0.08,     // tones lighter than this get no marks at all (clean paper)
    imgGamma: 1,         // >1 pushes marks into the shadows, <1 spreads them into the mid-tones
    imgInvert: false,    // false: dark areas get marks (ink on paper); true: light areas get marks (light on black)
    imgFloor: 0.08,      // sparse marks even in the lightest parts of a shape, so the form still reads
    imgEdge: 0.6,        // extra packing along outlines, like the rim of the logo
    imgDirection: 'flow',// 'flow' along shapes, 'across' through shapes, 'radial', 'vertical'
  };
  const RADIUS_RATIO = 0.44; // 220 / 500 in the original

  function plan(p, size) {
    size = size || p.size;
    const s = size / p.base;
    const d0 = (2 * RADIUS_RATIO * p.base) / p.grainBase;
    let d = Math.max(p.minGrain, d0 * Math.pow(s, p.growth));
    let n = p.baseMarks * s * s * (d0 / d) ** 2;          // keep coverage constant
    if (n > p.maxMarks) { n = p.maxMarks; d = d0 * s * Math.sqrt(p.baseMarks / n); }
    if (n < 40) { n = 40; d = d0 * s * Math.sqrt(p.baseMarks / n); }
    return { size, n: Math.round(n), grain: d, radius: RADIUS_RATIO * size };
  }

  function rng(seed) {
    let a = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
    const r = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.normal = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(6.283185307179586 * r());
    return r;
  }

  class Cancelled extends Error {}

  // squared distance between segments p1-q1 and p2-q2 (Ericson)
  function segDist2(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
    const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y;
    const rx = p1x - p2x, ry = p1y - p2y;
    const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
    let s, t;
    if (a <= 1e-12 && e <= 1e-12) return rx * rx + ry * ry;
    if (a <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
    else {
      const c = d1x * rx + d1y * ry;
      if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
        else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      }
    }
    const dx = p1x + d1x * s - (p2x + d2x * t), dy = p1y + d1y * s - (p2y + d2y * t);
    return dx * dx + dy * dy;
  }

  // CSR spatial hash
  function buildGrid(X, Y, n, min, cell, dim, minY = min, dimY = dim) {
    const cells = dim * dimY, start = new Int32Array(cells + 1), cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let gx = ((X[i] - min) / cell) | 0, gy = ((Y[i] - minY) / cell) | 0;
      gx = gx < 0 ? 0 : gx >= dim ? dim - 1 : gx;
      gy = gy < 0 ? 0 : gy >= dimY ? dimY - 1 : gy;
      const c = gy * dim + gx; cellOf[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const fill = start.slice(0, cells), items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
    return { start, items };
  }

  // yield to the page without setTimeout's 4 ms / background-tab clamping
  const tick = typeof MessageChannel !== 'undefined'
    ? (() => { const ch = new MessageChannel(), q = []; ch.port1.onmessage = () => q.shift()(); if (ch.port1.unref) ch.port1.unref(); return () => new Promise((res) => { q.push(res); ch.port2.postMessage(0); }); })()
    : () => new Promise((res) => setTimeout(res, 0));

  // Lloyd (k-means) relaxation of N sites over m density-distributed samples.
  // Grid covers [minX, minX + GX*h] x [minY, minY + GY*h].
  async function lloyd(X, Y, N, SX, SY, m, minX, minY, h, GX, GY, iters, maybeYield) {
    const AX = new Float64Array(N), AY = new Float64Array(N), AC = new Int32Array(N);
    const GM = Math.max(GX, GY);
    for (let it = 0; it < iters; it++) {
      const { start, items } = buildGrid(X, Y, N, minX, h, GX, minY, GY);
      AX.fill(0); AY.fill(0); AC.fill(0);
      for (let q = 0; q < m; q++) {
        const x = SX[q], y = SY[q];
        const cx = ((x - minX) / h) | 0, cy = ((y - minY) / h) | 0;
        let best = Infinity, bi = -1;
        for (let r = 0; r < GM; r++) {
          if (bi >= 0 && r > 1) { const lim = (r - 1) * h; if (lim * lim >= best) break; }
          const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
          for (let gy = y0; gy <= y1; gy++) {
            if (gy < 0 || gy >= GY) continue;
            const step = gy === y0 || gy === y1 ? 1 : x1 - x0 || 1;
            for (let gx = x0; gx <= x1; gx += step) {
              if (gx < 0 || gx >= GX) continue;
              const c = gy * GX + gx;
              for (let k = start[c], e = start[c + 1]; k < e; k++) {
                const s = items[k], dx = X[s] - x, dy = Y[s] - y, d = dx * dx + dy * dy;
                if (d < best) { best = d; bi = s; }
              }
            }
          }
        }
        if (bi >= 0) { AX[bi] += x; AY[bi] += y; AC[bi]++; }
        if ((q & 0xffff) === 0) await maybeYield(0.04 + 0.96 * ((it + q / m) / iters));
      }
      for (let i = 0; i < N; i++) if (AC[i]) { X[i] = AX[i] / AC[i]; Y[i] = AY[i] / AC[i]; }
    }
  }

  function yielder(opt, from, span) {
    const onProgress = opt.onProgress || (() => {}), cancelled = opt.cancelled || (() => false);
    let last = Date.now();
    return async (frac) => {
      if (Date.now() - last > 30) {
        onProgress(from + span * frac); await tick(); last = Date.now();
        if (cancelled()) throw new Cancelled();
      }
    };
  }

  // Settings that move the marks. Anything else (0s and 1s, colour) reuses the positions.
  const POSITION_KEYS = ['base', 'baseMarks', 'grainBase', 'growth', 'minGrain', 'maxMarks', 'lightX', 'lightY',
    'shadowPacking', 'rimPacking', 'centre', 'centreReach', 'centreMode', 'organic', 'seed'];
  function positionsKey(p, size, draft) {
    return size + '|' + (draft ? 'd' : 'f') + '|' + POSITION_KEYS.map((k) => p[k]).join('|');
  }

  // Stage A (slow): where the marks sit on the ball. draft = fewer relaxation passes, for live dragging.
  async function positions(p, size, opt = {}) {
    const maybeYield = yielder(opt, 0, opt.draft ? 1 : 0.88);
    const t0 = Date.now();
    const pl = plan(p, size);
    let N = pl.n;
    const R = rng(p.seed);

    // ---------- 1. density on the unit ball (y up) ----------
    let L0 = p.lightX, L1 = p.lightY, L2 = 1;
    const ln = Math.hypot(L0, L1, L2); L0 /= ln; L1 /= ln; L2 /= ln;
    const SP = p.shadowPacking, RP = p.rimPacking;
    const density = (x, y) => {
      const nz = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const light = Math.min(1, Math.max(0, x * L0 + y * L1 + nz * L2));
      const sh = 1 - light, rim = 1 - nz;
      return (1 + SP * sh * sh + RP * Math.pow(rim, 2.5)) * keep(x, y, nz);
    };

    // centre diffusion. keep() = share of the original density kept.
    // cross: thins outwards from the middle; the rim stays packed.
    // hamburger: thins a horizontal band right across the ball, through the left and right
    // edges too, so the top and bottom read as two packed buns.
    // Even at 0% a sparse scatter survives (4% of the density), so it never wipes clean.
    const CV = p.centreMode === 'off' ? 1 : 0.04 + 0.96 * Math.min(1, Math.max(0, p.centre / 100));
    const CE = 4 - 3.65 * Math.min(1, Math.max(0, p.centreReach / 100)); // reach 0 → tight centre spot, 1 → reaches the rim
    const HAM = p.centreMode === 'hamburger';
    const HBW = 0.15 + 0.6 * Math.min(1, Math.max(0, p.centreReach / 100)); // band half-height
    function keep(x, y, nz) {
      if (CV >= 1) return 1;
      let w;
      if (HAM) { const u = y / HBW; w = Math.exp(-u * u); }
      else w = Math.pow(nz, CE);
      return 1 - (1 - CV) * w;
    }
    if (CV < 1) {
      // fewer marks rather than the same marks pushed outwards, so the rim keeps its packing
      let a = 0, b = 0;
      for (let j = 0; j < 160; j++) for (let i = 0; i < 160; i++) {
        const x = -1 + (i + 0.5) / 80, y = -1 + (j + 0.5) / 80;
        if (x * x + y * y > 1) continue;
        const d = density(x, y), k = keep(x, y, Math.sqrt(1 - x * x - y * y));
        a += d; b += k > 0 ? d / k : 0;
      }
      N = Math.max(40, Math.round(N * (a / b)));
    }

    // ---------- 2. density-weighted samples, then Lloyd (k-means) relaxation ----------
    const M = Math.round(Math.min(3.2e6, opt.draft ? Math.max(20000, N * 6) : Math.max(40000, N * 14)));
    const G = Math.ceil(Math.sqrt((4 * M) / Math.PI)), cs = 2 / G;
    const W = new Float32Array(G * G);
    let tot = 0;
    for (let j = 0; j < G; j++) {
      const y = -1 + (j + 0.5) * cs;
      for (let i = 0; i < G; i++) {
        const x = -1 + (i + 0.5) * cs;
        if (x * x + y * y <= 1) { const w = density(x, y); W[j * G + i] = w; tot += w; }
      }
    }
    const SX = new Float32Array(M + G * G), SY = new Float32Array(M + G * G);
    let m = 0;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const w = W[j * G + i]; if (!w) continue;
        const k = Math.floor((M * w) / tot + R());
        for (let q = 0; q < k; q++) {
          const x = -1 + (i + R()) * cs, y = -1 + (j + R()) * cs;
          if (x * x + y * y < 1) { SX[m] = x; SY[m] = y; m++; }
        }
      }
    }
    await maybeYield(0.02);

    const X = new Float64Array(N), Y = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const k = (R() * m) | 0;
      X[i] = SX[k] + (R() - 0.5) * cs; Y[i] = SY[k] + (R() - 0.5) * cs;
    }

    const iters = opt.draft ? Math.min(3, Math.round(4 + 40 * (1 - p.organic))) : Math.round(4 + 40 * (1 - p.organic));
    const h = Math.sqrt((2 * Math.PI) / N), GS = Math.ceil(2.04 / h);
    await lloyd(X, Y, N, SX, SY, m, -1.02, -1.02, h, GS, GS, iters, maybeYield);

    // loosen the grid, keep everything on the ball
    const sig = p.organic * 0.35 * Math.sqrt(Math.PI / N), LIM = 1 - 1 / 300;
    for (let i = 0; i < N; i++) {
      X[i] += R.normal() * sig; Y[i] += R.normal() * sig;
      const r = Math.hypot(X[i], Y[i]);
      if (r > LIM) { X[i] *= LIM / r; Y[i] *= LIM / r; }
    }
    // thinned areas: scatter the survivors by a share of their own spacing so the
    // centre reads as a loose natural spray instead of an even sparse grid
    if (CV < 1) {
      const spacing0 = Math.sqrt(Math.PI / N);
      for (let i = 0; i < N; i++) {
        const nz = Math.sqrt(Math.max(0, 1 - X[i] * X[i] - Y[i] * Y[i])), k = keep(X[i], Y[i], nz);
        const local = Math.min(0.12, spacing0 / Math.sqrt(Math.max(k, 0.02)));
        const s = 0.5 * (1 - k) * local;
        X[i] += R.normal() * s; Y[i] += R.normal() * s;
        const r = Math.hypot(X[i], Y[i]);
        if (r > LIM) { X[i] *= LIM / r; Y[i] *= LIM / r; }
      }
    }
    return { key: positionsKey(p, size, opt.draft), plan: pl, n: N, X, Y, L0, L1, draft: !!opt.draft, ms: Date.now() - t0 };
  }

  // Stage B (fast): turn positions into 0s and 1s. Has its own random stream so it
  // gives the same result whether or not the positions came from the cache.
  async function place(pos, p, opt = {}) {
    const maybeYield = yielder(opt, pos.fromCache || pos.draft ? 0 : 0.88, pos.fromCache || pos.draft ? 1 : 0.12);
    const t0 = Date.now();
    const { plan: pl, n: N, X, Y, L0, L1 } = pos;
    const R = rng(p.seed + 7919);
    // ---------- 3. marks in output pixels ----------
    const S = pl.size, RP_ = pl.radius, D = pl.grain, rad = D / 2;
    const lw = D * p.lineWeight, gap = (p.gap / 100) * D;
    const PX = new Float64Array(N), PY = new Float64Array(N);
    const UX = new Float64Array(N), UY = new Float64Array(N), HALF = new Float64Array(N);
    let ox = 0, oy = 0;
    if (p.radialFrom === 'light') { ox = L0; oy = L1; }
    let halfMax = 0;
    for (let i = 0; i < N; i++) {
      const px = X[i], py = Y[i], pz = Math.sqrt(Math.max(0, 1 - px * px - py * py));
      PX[i] = S / 2 + px * RP_; PY[i] = S / 2 - py * RP_;
      let ux, uy;
      if (p.direction === 'follow') {
        const tx = -px * py, ty = 1 - py * py, n = Math.hypot(tx, ty) + 1e-9;
        ux = tx / n; uy = -ty / n;
      } else if (p.direction === 'radial') {
        let rx = px - ox, ry = py - oy, n = Math.hypot(rx, ry);
        const a = R() * 6.283185307179586;
        if (n <= 0.03) { rx = Math.cos(a); ry = Math.sin(a); n = 1; }
        ux = rx / n; uy = -ry / n;
      } else { ux = 0; uy = 1; }
      const w = (R.normal() * p.wiggle * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
      UX[i] = ux * c - uy * s; UY[i] = ux * s + uy * c;
      const squash = p.direction === 'radial' ? 1 - p.foreshorten * (1 - pz) : 1;
      HALF[i] = Math.max((D * p.lineLength * squash) / 2 - lw / 2, 0);
      if (HALF[i] > halfMax) halfMax = HALF[i];
    }

    const out = await assign({ N, PX, PY, UX, UY, HALF, halfMax, D, lw, rad, gap, W: S, H: S }, p, R, maybeYield);
    return {
      kind: 'sphere', size: S, width: S, height: S, plan: pl, grain: D, rad, lw, n: N, x: PX, y: PY, ux: UX, uy: UY, half: HALF,
      ...out, draft: pos.draft, ms: Date.now() - t0 + (pos.fromCache ? 0 : pos.ms),
    };
  }

  // ---------- circle (0) or pill (1), never letting marks touch ----------
  async function assign(g, p, R, maybeYield) {
    const { N, PX, PY, UX, UY, HALF, halfMax, lw, rad, gap, W, H } = g;
    const wantLine = new Uint8Array(N);
    for (let i = 0; i < N; i++) wantLine[i] = R() < p.lineShare ? 1 : 0;
    const perm = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    const ls = [], cs2 = [];
    for (let i = 0; i < N; i++) (wantLine[i] ? ls : cs2).push(i);
    const order = perm(ls).concat(perm(cs2));   // pills claim space first

    const reach = halfMax + Math.max(rad, lw / 2);
    const cell = 2 * reach + gap + 1e-6, gdx = Math.max(1, Math.ceil(W / cell) + 1), gdy = Math.max(1, Math.ceil(H / cell) + 1);
    const { start, items } = buildGrid(PX, PY, N, 0, cell, gdx, 0, gdy);
    const shape = new Int8Array(N).fill(-2);      // -2 pending, 0 circle, 1 pill, -1 dropped
    for (let oi = 0; oi < N; oi++) {
      const i = order[oi];
      const gx = Math.min(gdx - 1, Math.max(0, (PX[i] / cell) | 0));
      const gy = Math.min(gdy - 1, Math.max(0, (PY[i] / cell) | 0));
      let placed = false;
      for (let tryLine = wantLine[i]; tryLine >= 0 && !placed; tryLine--) {
        const hi = tryLine ? HALF[i] : 0, ri = tryLine ? lw / 2 : rad;
        const ax = PX[i] - UX[i] * hi, ay = PY[i] - UY[i] * hi, bx = PX[i] + UX[i] * hi, by = PY[i] + UY[i] * hi;
        let clash = false;
        for (let yy = gy - 1; yy <= gy + 1 && !clash; yy++) {
          if (yy < 0 || yy >= gdy) continue;
          for (let xx = gx - 1; xx <= gx + 1 && !clash; xx++) {
            if (xx < 0 || xx >= gdx) continue;
            const c = yy * gdx + xx;
            for (let k = start[c], e = start[c + 1]; k < e; k++) {
              const j = items[k], sj = shape[j];
              if (sj < 0) continue;
              const hj = sj === 1 ? HALF[j] : 0, rj = sj === 1 ? lw / 2 : rad;
              const lim = ri + rj + gap;
              const dx0 = PX[j] - PX[i], dy0 = PY[j] - PY[i];
              const far = lim + hi + hj;
              if (dx0 * dx0 + dy0 * dy0 >= far * far) continue;
              const d2 = segDist2(ax, ay, bx, by,
                PX[j] - UX[j] * hj, PY[j] - UY[j] * hj, PX[j] + UX[j] * hj, PY[j] + UY[j] * hj);
              if (d2 < lim * lim) { clash = true; break; }
            }
          }
        }
        if (!clash) { shape[i] = tryLine ? 1 : 0; placed = true; }
      }
      if (!placed) shape[i] = p.clustering ? 0 : -1;
      if ((oi & 0x3fff) === 0) await maybeYield(oi / N);
    }
    let circles = 0, lines = 0, dropped = 0;
    for (let i = 0; i < N; i++) shape[i] === 0 ? circles++ : shape[i] === 1 ? lines++ : dropped++;
    return { shape, circles, lines, dropped };
  }

  // =================== illustration from an image ===================
  // img = { id, w, h, lum: Float32Array (0 black … 1 white), alpha: Float32Array (0 … 1) }

  const TONE_KEYS = ['imgBrightness', 'imgContrast', 'imgCutoff', 'imgGamma', 'imgInvert', 'imgFloor', 'imgEdge'];
  const toneKey = (p) => TONE_KEYS.map((k) => p[k]).join('|');

  // how much ink each image cell wants, 0 … 1
  function coverage(img, p) {
    const key = toneKey(p);
    if (img._cov && img._covKey === key) return img._cov;
    const n = img.w * img.h, C = new Float32Array(n), w = img.w, h = img.h;
    const b = p.imgBrightness, c = p.imgContrast, cut = Math.min(0.95, p.imgCutoff), g = p.imgGamma, fl = p.imgFloor;
    if (img.hasAlpha === undefined) { img.hasAlpha = false; for (let i = 0; i < n; i++) if (img.alpha[i] < 0.99) { img.hasAlpha = true; break; } }
    for (let i = 0; i < n; i++) {
      let t = p.imgInvert ? img.lum[i] : 1 - img.lum[i];       // tone that should carry marks
      t = (t - 0.5) * c + 0.5 - b * 0.5;
      t = t <= cut ? 0 : (t - cut) / (1 - cut);
      if (t > 1) t = 1;
      // the floor keeps light parts of a shape sparsely marked; for pictures without
      // transparency it only applies where there is some tone, so white paper stays clean
      const v = t > 0 || img.hasAlpha ? fl + (1 - fl) * Math.pow(t, g) : 0;
      C[i] = v * img.alpha[i];
    }
    if (p.imgEdge > 0) {
      // outline map: silhouette (transparency) edges, or luminance edges for opaque pictures
      const src = img.hasAlpha ? img.alpha : img.lum, E = new Float32Array(n);
      let max = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = src[i + 1 - w] + 2 * src[i + 1] + src[i + 1 + w] - src[i - 1 - w] - 2 * src[i - 1] - src[i - 1 + w];
        const gy = src[i - 1 + w] + 2 * src[i + w] + src[i + 1 + w] - src[i - 1 - w] - 2 * src[i - w] - src[i + 1 - w];
        E[i] = Math.hypot(gx, gy); if (E[i] > max) max = E[i];
      }
      const r = Math.max(1, Math.round(0.006 * Math.max(w, h)));
      boxBlur(E, w, h, r); boxBlur(E, w, h, r);
      let m2 = 0; for (let i = 0; i < n; i++) if (E[i] > m2) m2 = E[i];
      if (m2 > 0) for (let i = 0; i < n; i++) {
        const e = Math.min(1, (E[i] / m2) * 1.6) * p.imgEdge * img.alpha[i];
        C[i] = Math.min(1, C[i] + e * (1 - C[i] * 0.5));
      }
    }
    img._cov = C; img._covKey = key; img._flow = null;
    return C;
  }

  // Direction field from the picture itself: smoothed structure tensor of the coverage map.
  // Gives the axis along contours (flow) plus how clear that axis is (coherence 0 … 1).
  function flowField(img, p) {
    const C = coverage(img, p);
    if (img._flow) return img._flow;
    const w = img.w, h = img.h, n = w * h;
    const xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const at = (i, j) => C[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const i = y * w + x; xx[i] = gx * gx; yy[i] = gy * gy; xy[i] = gx * gy;
    }
    const r = Math.max(2, Math.round(0.025 * Math.max(w, h)));
    for (const A of [xx, yy, xy]) { boxBlur(A, w, h, r); boxBlur(A, w, h, r); }
    const fx = new Float32Array(n), fy = new Float32Array(n), coh = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = xx[i], b = yy[i], c = xy[i];
      const d = Math.sqrt((a - b) * (a - b) + 4 * c * c);
      const th = 0.5 * Math.atan2(2 * c, a - b);          // gradient axis
      fx[i] = -Math.sin(th); fy[i] = Math.cos(th);         // along the contour
      coh[i] = a + b > 1e-9 ? d / (a + b) : 0;
    }
    img._flow = { fx, fy, coh };
    return img._flow;
  }
  function boxBlur(A, w, h, r) {
    const T = new Float32Array(A.length);
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += A[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        T[row + x] = acc / (2 * r + 1);
        acc += A[row + Math.min(w - 1, x + r + 1)] - A[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += T[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        A[y * w + x] = acc / (2 * r + 1);
        acc += T[Math.min(h - 1, y + r + 1) * w + x] - T[Math.max(0, y - r) * w + x];
      }
    }
  }

  // mark size at an output width; at other widths (responsive levels) it follows the growth rule
  const markAt = (p, size) => p.markPx * Math.pow(size / p.size, p.growth);

  function imagePlan(p, img, size) {
    const W = size, H = Math.max(1, Math.round((size * img.h) / img.w));
    const C = coverage(img, p);
    let sum = 0, inkCells = 0;
    for (let i = 0; i < C.length; i++) { sum += C[i]; if (C[i] > 0) inkCells++; }
    const cellArea = (W / img.w) * (H / img.h);
    let D = Math.max(0.3, markAt(p, size));
    const Aeff = Math.PI * (D / 2) * (D / 2) * 1.6;          // average 0/1 footprint
    let n = (p.ink * 0.72 * sum * cellArea) / Aeff;           // full tone ≈ 72% ink, with clumping in the darkest parts
    if (n > p.maxMarks) { D *= Math.sqrt(n / p.maxMarks); n = p.maxMarks; }
    return { W, H, grain: D, n: Math.round(n), sum, inkArea: inkCells * cellArea, cellArea };
  }

  function imageKey(p, img, size, draft) {
    const pl = imagePlan(p, img, size);
    return ['img', img.id, size, pl.grain.toFixed(4), pl.n, toneKey(p), p.organic, p.seed, draft ? 'd' : 'f'].join('|');
  }

  async function imagePositions(p, img, size, opt = {}) {
    const maybeYield = yielder(opt, 0, opt.draft ? 1 : 0.88);
    const t0 = Date.now(), R = rng(p.seed);
    const pl = imagePlan(p, img, size), N = pl.n, { W, H } = pl;
    const key = imageKey(p, img, size, opt.draft);
    if (N < 1) return { key, kind: 'image', plan: pl, n: 0, X: new Float64Array(0), Y: new Float64Array(0), draft: !!opt.draft, ms: 0 };
    const C = coverage(img, p), cw = W / img.w, ch = H / img.h;
    const M = Math.round(Math.min(3.2e6, opt.draft ? Math.max(20000, N * 6) : Math.max(40000, N * 14)));
    const SX = new Float32Array(M + img.w * img.h), SY = new Float32Array(M + img.w * img.h);
    let m = 0;
    for (let j = 0; j < img.h; j++) for (let i = 0; i < img.w; i++) {
      const c = C[j * img.w + i]; if (!c) continue;
      const k = Math.floor((M * c) / pl.sum + R());
      for (let q = 0; q < k; q++) { SX[m] = (i + R()) * cw; SY[m] = (j + R()) * ch; m++; }
    }
    await maybeYield(0.02);
    const X = new Float64Array(N), Y = new Float64Array(N);
    for (let i = 0; i < N; i++) { const k = (R() * m) | 0; X[i] = SX[k]; Y[i] = SY[k]; }
    const iters = opt.draft ? Math.min(3, Math.round(4 + 40 * (1 - p.organic))) : Math.round(4 + 40 * (1 - p.organic));
    const h = Math.max(0.5, Math.sqrt((2 * pl.inkArea) / N));
    await lloyd(X, Y, N, SX, SY, m, 0, 0, h, Math.ceil(W / h) + 1, Math.ceil(H / h) + 1, iters, maybeYield);
    const sig = p.organic * 0.35 * Math.sqrt(pl.inkArea / N);
    for (let i = 0; i < N; i++) {
      X[i] = Math.min(W, Math.max(0, X[i] + R.normal() * sig));
      Y[i] = Math.min(H, Math.max(0, Y[i] + R.normal() * sig));
    }
    return { key, kind: 'image', plan: pl, n: N, X, Y, draft: !!opt.draft, ms: Date.now() - t0 };
  }

  async function imagePlace(pos, p, img, opt = {}) {
    const maybeYield = yielder(opt, pos.fromCache || pos.draft ? 0 : 0.88, pos.fromCache || pos.draft ? 1 : 0.12);
    const t0 = Date.now(), R = rng(p.seed + 7919);
    const { plan: pl, n: N, X, Y } = pos, { W, H } = pl, D = pl.grain, rad = D / 2;
    const lw = D * p.lineWeight, gap = (p.gap / 100) * D;
    const UX = new Float64Array(N), UY = new Float64Array(N), HALF = new Float64Array(N);
    const F = p.imgDirection === 'flow' || p.imgDirection === 'across' ? flowField(img, p) : null;
    const half = Math.max((D * p.lineLength) / 2 - lw / 2, 0);
    for (let i = 0; i < N; i++) {
      let ux = 0, uy = 1;
      if (F) {
        const ci = Math.min(img.h - 1, (Y[i] / H * img.h) | 0) * img.w + Math.min(img.w - 1, (X[i] / W * img.w) | 0);
        let fx = F.fx[ci], fy = F.fy[ci];
        if (p.imgDirection === 'across') { const t = fx; fx = -fy; fy = t; }
        // where the picture has no clear structure, ease towards upright
        const k = Math.min(1, Math.max(0, (F.coh[ci] - 0.04) / 0.3));
        if (fy < 0) { fx = -fx; fy = -fy; }
        ux = fx * k; uy = fy * k + (1 - k);
        const n = Math.hypot(ux, uy) || 1; ux /= n; uy /= n;
      } else if (p.imgDirection === 'radial') {
        const dx = X[i] - W / 2, dy = Y[i] - H / 2, n = Math.hypot(dx, dy);
        if (n > 1e-6) { ux = dx / n; uy = dy / n; }
      }
      const w = (R.normal() * p.wiggle * Math.PI) / 180, c = Math.cos(w), s = Math.sin(w);
      UX[i] = ux * c - uy * s; UY[i] = ux * s + uy * c; HALF[i] = half;
    }
    const out = await assign({ N, PX: X, PY: Y, UX, UY, HALF, halfMax: half, D, lw, rad, gap, W, H }, p, R, maybeYield);
    return {
      kind: 'image', size: W, width: W, height: H, plan: pl, grain: D, rad, lw, n: N, x: X, y: Y, ux: UX, uy: UY, half: HALF,
      ...out, draft: pos.draft, ms: Date.now() - t0 + (pos.fromCache ? 0 : pos.ms),
    };
  }

  // Built-in sample so image mode opens working: three stacked spheres (a cairn) lit from
  // the top left, with cast shadows and a soft ground shadow. Transparent background.
  function sampleImage(w = 480, h = 640) {
    const lum = new Float32Array(w * h), alpha = new Float32Array(w * h);
    const S = [[0.02, -0.38, 0, 0.36], [0.1, 0.12, 0, 0.21], [0.03, 0.43, 0, 0.13]];
    let L = [-0.55, 0.6, 0.58]; const ln = Math.hypot(...L); L = L.map((v) => v / ln);
    const hitSphere = (ox, oy, oz, dx, dy, dz, sp) => {
      const cx = ox - sp[0], cy = oy - sp[1], cz = oz - sp[2];
      const b = cx * dx + cy * dy + cz * dz, c = cx * cx + cy * cy + cz * cz - sp[3] * sp[3], d = b * b - c;
      return d < 0 ? Infinity : -b - Math.sqrt(d);
    };
    const sc = 2 / h;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = (i + 0.5 - w / 2) * sc, y = (h / 2 - j - 0.5) * sc, k = j * w + i;
      let best = null, bz = -Infinity;
      for (const sp of S) { const dx = x - sp[0], dy = y - sp[1], q = sp[3] * sp[3] - dx * dx - dy * dy; if (q > 0 && sp[2] + Math.sqrt(q) > bz) { bz = sp[2] + Math.sqrt(q); best = sp; } }
      if (best) {
        const nx = (x - best[0]) / best[3], ny = (y - best[1]) / best[3], nz = (bz - best[2]) / best[3];
        let d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        for (const sp of S) if (sp !== best) { const t = hitSphere(x, y, bz, L[0], L[1], L[2], sp); if (t > 1e-4 && t < Infinity) { d *= 0.15; break; } }
        // contact darkening where spheres meet
        let ao = 1;
        for (const sp of S) if (sp !== best) { const g = Math.hypot(x - sp[0], y - sp[1], bz - sp[2]) - sp[3]; ao = Math.min(ao, 0.55 + 0.45 * Math.min(1, g / 0.08)); }
        lum[k] = Math.min(1, (0.08 + 0.95 * d) * ao); alpha[k] = 1;
      } else {
        // ground shadow: an ellipse under the cairn, pushed away from the light
        const gx = (x - 0.16) / 0.62, gy = (y + 0.74) / 0.07, r = gx * gx + gy * gy;
        if (r < 1) { lum[k] = 0; alpha[k] = 0.85 * Math.pow(1 - r, 1.5); }
      }
    }
    return { id: 'sample-cairn', name: 'Sample: cairn', w, h, lum, alpha };
  }

  // Full run. opt.cache: a Map reused between calls, so changing only the 0s and 1s
  // skips the slow stage. opt.draft: quick low-relaxation preview.
  // opt.image is required when p.source === 'image'.
  async function generate(p, size, opt = {}) {
    const img = p.source === 'image' ? opt.image : null;
    if (p.source === 'image' && !img) throw new Error('No image loaded');
    const key = img ? imageKey(p, img, size, opt.draft) : positionsKey(p, size, opt.draft);
    let pos = opt.cache && opt.cache.get(key);
    if (pos) { pos = { ...pos, fromCache: true }; opt.cache.delete(key); opt.cache.set(key, pos); }
    else {
      pos = img ? await imagePositions(p, img, size, opt) : await positions(p, size, opt);
      if (opt.cache) { opt.cache.set(key, pos); while (opt.cache.size > 8) opt.cache.delete(opt.cache.keys().next().value); }
    }
    const res = img ? await imagePlace(pos, p, img, opt) : await place(pos, p, opt);
    (opt.onProgress || (() => {}))(1);
    return res;
  }

  // ---------- SVG ----------
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // inner markup for one result, scaled by k into the target coordinate space
  function marks(res, p, mode, k = 1, dec = 2) {
    const f = dec === 1 ? r1 : r2, col = esc(p.color);
    const { x, y, ux, uy, half, shape, n } = res;
    const c = [], l = [];
    if (mode === 'compact') {
      for (let i = 0; i < n; i++) {
        if (shape[i] === 0) c.push(`M${f(x[i] * k)} ${f(y[i] * k)}h.01`);
        else if (shape[i] === 1) {
          const hx = ux[i] * half[i] * k, hy = uy[i] * half[i] * k;
          l.push(`M${f(x[i] * k - hx)} ${f(y[i] * k - hy)}l${f(2 * hx)} ${f(2 * hy)}`);
        }
      }
      return (c.length ? `<path fill="none" stroke="${col}" stroke-width="${r2(res.grain * k)}" stroke-linecap="round" d="${c.join('')}"/>` : '') +
        (l.length ? `<path fill="none" stroke="${col}" stroke-width="${r2(res.lw * k)}" stroke-linecap="round" d="${l.join('')}"/>` : '');
    }
    const rr = r2(res.rad * k);
    for (let i = 0; i < n; i++) {
      if (shape[i] === 0) c.push(`<circle cx="${f(x[i] * k)}" cy="${f(y[i] * k)}" r="${rr}"/>`);
      else if (shape[i] === 1) {
        const hx = ux[i] * half[i], hy = uy[i] * half[i];
        l.push(`<line x1="${f((x[i] - hx) * k)}" y1="${f((y[i] - hy) * k)}" x2="${f((x[i] + hx) * k)}" y2="${f((y[i] + hy) * k)}"/>`);
      }
    }
    return `<g fill="${col}">${c.join('')}</g><g fill="none" stroke="${col}" stroke-width="${r2(res.lw * k)}" stroke-linecap="round">${l.join('')}</g>`;
  }

  function bgRect(p, w, h = w) { return p.background === 'none' ? '' : `<rect width="${w}" height="${h}" fill="${esc(p.background)}"/>`; }

  function svg(res, p, mode = 'elements') {
    const W = res.width, H = res.height, dec = W <= 512 ? 2 : 1;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<!-- Comput · ${res.kind === 'image' ? 'illustration' : 'sphere'} · ${W}x${H}px · ${res.circles} 0s · ${res.lines} 1s · mark ${r2(res.grain)}px · seed ${p.seed} -->` +
      bgRect(p, W, H) + marks(res, p, mode, 1, dec) + `</svg>`;
  }

  // one SVG holding several levels of detail; media queries inside the SVG pick
  // the level from the size the SVG is drawn at (works when used as <img>,
  // <object> or a CSS background). Tools that ignore CSS show the default level.
  function thresholds(sizes) {
    const t = [];
    for (let i = 0; i < sizes.length - 1; i++) t.push(Math.round(Math.sqrt(sizes[i] * sizes[i + 1])));
    return t;
  }
  function responsiveSvg(results, p) {
    const V = 1000;
    results = results.slice().sort((a, b) => a.size - b.size);
    const sizes = results.map((r) => r.size), t = thresholds(sizes);
    const def = Math.floor((results.length - 1) / 2);
    let css = '.c{display:none}';
    results.forEach((r, i) => {
      const q = [];
      if (i > 0) q.push(`(min-width:${t[i - 1]}px)`);
      if (i < results.length - 1) q.push(`(max-width:${t[i] - 0.02}px)`);
      css += q.length ? `@media ${q.join(' and ')}{.c${i}{display:inline}}` : `.c${i}{display:inline}`;
    });
    const VH = Math.round((V * results[0].height) / results[0].width);
    const groups = results.map((r, i) =>
      `<g class="c c${i}"${i === def ? '' : ' display="none"'} data-size="${r.size}">${marks(r, p, 'compact', V / r.size, 1)}</g>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${VH}">` +
      `<!-- Comput · responsive ${results[0].kind === 'image' ? 'illustration' : 'sphere'} · detail levels ${sizes.join('/')}px wide · switch at ${t.join('/')}px · seed ${p.seed} -->` +
      `<style>${css}</style>` + bgRect(p, V, VH) + groups + `</svg>`;
  }

  return { DEFAULTS, POSITION_KEYS, TONE_KEYS, plan, imagePlan, sampleImage, generate, positions, place, positionsKey, svg, responsiveSvg, thresholds, Cancelled };
})();
if (typeof module !== 'undefined') module.exports = Comput;
