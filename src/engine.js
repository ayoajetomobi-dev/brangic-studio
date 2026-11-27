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
    imgKnockout: true,
    imgDetail: 0.6,      // local contrast in the picture before marks are placed: crisper relief and lettering, same overall tone   // leave a plain backdrop around the subject empty (photos without transparency)
    imgDirection: 'flow',// 'flow' along shapes, 'across' through shapes, 'radial', 'vertical';
                         // with a normal map also 'burst' (like the logo), 'follow' (pole to pole), 'rings'
    imgLight: 'light',   // with a 3D form: tone from Comput's own 'light' (the logo's), the 'render', or a 'mix'
    normalSource: 'none',// 3D form: 'none' (flat picture), 'inflate' (rounded from the outline), 'file' (a normal map)
    inflateRound: 0.85,
    // illustrations have their own light, so lighting one never changes the logo
    iLightX: -0.25, iLightY: 0.45, iShadowPacking: 5.0, iRimPacking: 4.0,  // inflate: 1 = fully domed, lower = flatter top with rounded edges
    normalFlipY: false,  // normal maps saved the DirectX way have green pointing down
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
    // motion: a separate stream for the loosening noise, so each mark keeps the same offset frame to frame
    const RN = opt.stable ? rng(p.seed + 101) : R;

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
    if (opt.fixedN) N = opt.fixedN;

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
    if (opt.init && opt.init.X.length === N) { X.set(opt.init.X); Y.set(opt.init.Y); }   // motion: start from the last frame
    else for (let i = 0; i < N; i++) {
      const k = (R() * m) | 0;
      X[i] = SX[k] + (R() - 0.5) * cs; Y[i] = SY[k] + (R() - 0.5) * cs;
    }

    const iters = opt.iters ?? (opt.draft ? Math.min(3, Math.round(4 + 40 * (1 - p.organic))) : Math.round(4 + 40 * (1 - p.organic)));
    const h = Math.sqrt((2 * Math.PI) / N), GS = Math.ceil(2.04 / h);
    await lloyd(X, Y, N, SX, SY, m, -1.02, -1.02, h, GS, GS, iters, maybeYield);
    const RX = Float64Array.from(X), RY = Float64Array.from(Y);

    // loosen the grid, keep everything on the ball
    const sig = p.organic * 0.35 * Math.sqrt(Math.PI / N), LIM = 1 - 1 / 300;
    for (let i = 0; i < N; i++) {
      X[i] += RN.normal() * sig; Y[i] += RN.normal() * sig;
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
        X[i] += RN.normal() * s; Y[i] += RN.normal() * s;
        const r = Math.hypot(X[i], Y[i]);
        if (r > LIM) { X[i] *= LIM / r; Y[i] *= LIM / r; }
      }
    }
    return { key: positionsKey(p, size, opt.draft), plan: pl, n: N, X, Y, L0, L1, relaxed: { X: RX, Y: RY }, draft: !!opt.draft, ms: Date.now() - t0 };
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

  const TONE_KEYS = ['imgBrightness', 'imgContrast', 'imgCutoff', 'imgGamma', 'imgInvert', 'imgFloor', 'imgEdge', 'imgDetail',
    'imgLight', 'iLightX', 'iLightY', 'iShadowPacking', 'iRimPacking'];
  const toneKey = (p) => TONE_KEYS.map((k) => p[k]).join('|');

  // how much ink each image cell wants, 0 … 1
  function coverage(img, p) {
    const key = toneKey(p);
    if (img._cov && img._covKey === key) return img._cov;
    const n = img.w * img.h, C = new Float32Array(n), w = img.w, h = img.h;
    const b = p.imgBrightness, c = p.imgContrast, cut = Math.min(0.95, p.imgCutoff), g = p.imgGamma, fl = p.imgFloor;
    if (img.hasAlpha === undefined) { img.hasAlpha = false; for (let i = 0; i < n; i++) if (img.alpha[i] < 0.99) { img.hasAlpha = true; break; } }
    // With a normal map, Comput can light the object itself with the logo's model:
    // more marks in shadow (away from the light) and towards the rim (turning away from you).
    const NM = img.normal && p.imgLight !== 'render' ? img.normal : null;
    let L0 = p.iLightX, L1 = p.iLightY, L2 = 1;
    { const ln = Math.hypot(L0, L1, L2); L0 /= ln; L1 /= ln; L2 /= ln; }
    const SP = p.iShadowPacking, RP = p.iRimPacking, LT = 1 + SP + RP;
    const logoLight = NM && p.imgLight === 'light';
    // Detail: lift local contrast (the picture minus a soft blur of itself), so relief, edges and
    // lettering separate from their surroundings while the overall tone stays where it was
    let L = img.lum;
    if (p.imgDetail > 0) {
      const r = Math.max(1, Math.round(0.015 * Math.max(w, h)));
      if (!img._blur || img._blurR !== r) { const B = Float32Array.from(img.lum); boxBlur(B, w, h, r); boxBlur(B, w, h, r); img._blur = B; img._blurR = r; }
      const B = img._blur, k = p.imgDetail * 1.6; L = new Float32Array(n);
      for (let i = 0; i < n; i++) L[i] = Math.min(1, Math.max(0, img.lum[i] + k * (img.lum[i] - B[i])));
    }
    for (let i = 0; i < n; i++) {
      let t = p.imgInvert ? L[i] : 1 - L[i];                   // tone that should carry marks
      if (logoLight) {
        // the logo's model, untouched by the photo tone controls (see imagePlan for the count)
        if (img.kind && img.kind[i] === 2) { C[i] = img.alpha[i] * 0.9; continue; }   // scene ground: shadow only
        const nx = NM.x[i], ny = NM.y[i], nz = NM.z[i];
        let li = Math.min(1, Math.max(0, nx * L0 + ny * L1 + nz * L2));
        if (img.shadow) li *= (1 - img.shadow[i]) * img.ao[i];                      // scenes: cast and contact shadows
        const sh = 1 - li, rim = 1 - Math.max(0, nz);
        let tl = (1 + SP * sh * sh + RP * Math.pow(rim, 2.5)) / LT;
        if (p.imgInvert) tl = 1 - tl + 1 / LT;
        C[i] = tl * img.alpha[i];
        continue;
      }
      if (NM) {
        const nx = NM.x[i], ny = NM.y[i], nz = NM.z[i];
        const li = Math.min(1, Math.max(0, nx * L0 + ny * L1 + nz * L2)), sh = 1 - li, rim = 1 - Math.max(0, nz);
        let tl = (1 + SP * sh * sh + RP * Math.pow(rim, 2.5)) / LT;
        if (p.imgInvert) tl = 1 - tl;
        t = p.imgLight === 'mix' ? 0.5 * (t + tl) : tl;
      }
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
      const src = img.edgeSrc || (img.hasAlpha ? img.alpha : img.lum), E = new Float32Array(n);
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
        const e = Math.min(1, (E[i] / m2) * 1.6) * p.imgEdge * (img.edgeSrc ? img.edgeSrc[i] : img.alpha[i]);
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

  // average of the logo's density over its disc, for calibrating illustrations lit by Comput
  const _ld = new Map();
  function logoDensity(p) {
    const key = [p.iLightX, p.iLightY, p.iShadowPacking, p.iRimPacking].join('|');
    if (_ld.has(key)) return _ld.get(key);
    let L0 = p.iLightX, L1 = p.iLightY, L2 = 1; const ln = Math.hypot(L0, L1, L2); L0 /= ln; L1 /= ln; L2 /= ln;
    let a = 0, c = 0;
    for (let j = 0; j < 120; j++) for (let i = 0; i < 120; i++) {
      const x = -1 + (i + 0.5) / 60, y = -1 + (j + 0.5) / 60; if (x * x + y * y > 1) continue;
      const nz = Math.sqrt(1 - x * x - y * y), li = Math.min(1, Math.max(0, x * L0 + y * L1 + nz * L2));
      a += 1 + p.iShadowPacking * (1 - li) ** 2 + p.iRimPacking * Math.pow(1 - nz, 2.5); c++;
    }
    const v = { mean: a / c, lt: 1 + p.iShadowPacking + p.iRimPacking };
    _ld.set(key, v); return v;
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
    if (img.normal && p.imgLight === 'light') {
      // match the logo: it puts 0.835 / D² marks per px² where its density equals the disc average
      n = (p.ink * logoDensity(p).lt * 0.835 * sum * cellArea) / (D * D * logoDensity(p).mean);
    }
    if (n > p.maxMarks) { D *= Math.sqrt(n / p.maxMarks); n = p.maxMarks; }
    return { W, H, grain: D, n: Math.round(n), sum, inkArea: inkCells * cellArea, cellArea };
  }

  function imageKey(p, img, size, draft) {
    const pl = imagePlan(p, img, size);
    return ['img', img.id, size, pl.grain.toFixed(4), pl.n, toneKey(p), p.organic, p.seed, draft ? 'd' : 'f'].join('|');
  }

  async function imagePositions(p, img, size, opt = {}) {
    const maybeYield = yielder(opt, 0, opt.draft ? 1 : 0.88);
    const t0 = Date.now(), R = rng(p.seed), RN = opt.stable ? rng(p.seed + 101) : R;
    const pl = imagePlan(p, img, size), N = opt.fixedN || pl.n, { W, H } = pl;
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
    if (opt.init && opt.init.X.length === N) { X.set(opt.init.X); Y.set(opt.init.Y); }
    else for (let i = 0; i < N; i++) { const k = (R() * m) | 0; X[i] = SX[k]; Y[i] = SY[k]; }
    const iters = opt.iters ?? (opt.draft ? Math.min(3, Math.round(4 + 40 * (1 - p.organic))) : Math.round(4 + 40 * (1 - p.organic)));
    const h = Math.max(0.5, Math.sqrt((2 * pl.inkArea) / N));
    await lloyd(X, Y, N, SX, SY, m, 0, 0, h, Math.ceil(W / h) + 1, Math.ceil(H / h) + 1, iters, maybeYield);
    const RX = Float64Array.from(X), RY = Float64Array.from(Y);
    const sig = p.organic * 0.35 * Math.sqrt(pl.inkArea / N);
    for (let i = 0; i < N; i++) {
      X[i] = Math.min(W, Math.max(0, X[i] + RN.normal() * sig));
      Y[i] = Math.min(H, Math.max(0, Y[i] + RN.normal() * sig));
    }
    return { key, kind: 'image', plan: pl, n: N, X, Y, relaxed: { X: RX, Y: RY }, draft: !!opt.draft, ms: Date.now() - t0 };
  }

  async function imagePlace(pos, p, img, opt = {}) {
    const maybeYield = yielder(opt, pos.fromCache || pos.draft ? 0 : 0.88, pos.fromCache || pos.draft ? 1 : 0.12);
    const t0 = Date.now(), R = rng(p.seed + 7919);
    const { plan: pl, n: N, X, Y } = pos, { W, H } = pl, D = pl.grain, rad = D / 2;
    const lw = D * p.lineWeight, gap = (p.gap / 100) * D;
    const UX = new Float64Array(N), UY = new Float64Array(N), HALF = new Float64Array(N);
    const dir = p.imgDirection, NM = img.normal;
    const surf = dir === 'burst' || dir === 'follow' || dir === 'rings';
    const useN = NM && surf;
    // surface modes need a normal map; without one they fall back to following the picture
    const F = dir === 'flow' || dir === 'across' || (surf && !NM) ? flowField(img, p) : null;
    const half0 = Math.max((D * p.lineLength) / 2 - lw / 2, 0);
    let halfMax = 0;
    for (let i = 0; i < N; i++) {
      let ux = 0, uy = 1, squash = 1;
      const ci = Math.min(img.h - 1, (Y[i] / H * img.h) | 0) * img.w + Math.min(img.w - 1, (X[i] / W * img.w) | 0);
      if (useN) {
        // directions from the surface itself, exactly as on the logo (normals are y-up)
        const nx = NM.x[ci], ny = NM.y[ci];
        if (dir === 'follow') {
          const tx = -nx * ny, ty = 1 - ny * ny, n = Math.hypot(tx, ty) + 1e-9;
          ux = tx / n; uy = -ty / n;
        } else {
          let rx = nx, ry = ny, n = Math.hypot(rx, ry);
          if (n < 0.03) { const a = R() * 6.283185307179586; rx = Math.cos(a); ry = Math.sin(a); n = 1; }
          ux = rx / n; uy = -ry / n;
          if (dir === 'rings') { const t = ux; ux = -uy; uy = t; }
        }
        squash = 1 - p.foreshorten * (1 - Math.max(0, NM.z[ci]));   // shorter as the surface turns away
      } else if (F) {
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
      UX[i] = ux * c - uy * s; UY[i] = ux * s + uy * c;
      HALF[i] = useN ? Math.max((D * p.lineLength * squash) / 2 - lw / 2, 0) : half0;
      if (HALF[i] > halfMax) halfMax = HALF[i];
    }
    const out = await assign({ N, PX: X, PY: Y, UX, UY, HALF, halfMax, D, lw, rad, gap, W, H }, p, R, maybeYield);
    return {
      kind: 'image', size: W, width: W, height: H, plan: pl, grain: D, rad, lw, n: N, x: X, y: Y, ux: UX, uy: UY, half: HALF,
      ...out, draft: pos.draft, ms: Date.now() - t0 + (pos.fromCache ? 0 : pos.ms),
    };
  }

  // Built-in sample so image mode opens working: three stacked spheres (a cairn) lit from
  // the top left, with cast shadows and a soft ground shadow. Transparent background.
  function sampleImage(w = 480, h = 640) {
    const lum = new Float32Array(w * h), alpha = new Float32Array(w * h);
    const NX = new Float32Array(w * h), NY = new Float32Array(w * h), NZ = new Float32Array(w * h), NA = new Float32Array(w * h);
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
        NX[k] = nx; NY[k] = ny; NZ[k] = nz; NA[k] = 1;
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
    return {
      id: 'sample-cairn', name: 'Sample: cairn', w, h, lum, alpha,
      normals: { id: 'sample-cairn-normals', name: 'Sample normals', w, h, x: NX, y: NY, z: NZ, alpha: NA },
    };
  }

  // Inflate: give a flat cut-out shape a rounded 3D surface, like blowing up a balloon.
  // Distance to the outline -> a height (a circle becomes an exact sphere) -> normals.
  // roundness 1 = fully domed, lower = flatter top with rounded edges.
  function inflate(render, roundness = 1) {
    const w = render.w, h = render.h, n = w * h, mask = new Uint8Array(n);
    let hasAlpha = false; for (let i = 0; i < n; i++) if (render.alpha[i] < 0.99) { hasAlpha = true; break; }
    for (let i = 0; i < n; i++) mask[i] = hasAlpha ? render.alpha[i] > 0.5 : render.lum[i] < 0.9 && render.alpha[i] > 0.5;
    const dt = edt(mask, w, h);
    let dmax = 0; for (let i = 0; i < n; i++) if (dt[i] > dmax) dmax = dt[i];
    const Rk = Math.max(1, Math.max(0.05, Math.min(1, roundness)) * dmax), H = new Float32Array(n);
    for (let i = 0; i < n; i++) { const d = Math.min(dt[i], Rk); H[i] = mask[i] ? Math.sqrt(d * (2 * Rk - d)) : 0; }
    const r = Math.max(1, Math.round(0.03 * dmax)); boxBlur(H, w, h, r);
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), alpha = new Float32Array(n);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (!mask[k]) continue;
      const gx = (H[j * w + Math.min(w - 1, i + 1)] - H[j * w + Math.max(0, i - 1)]) / 2;
      const gyUp = (H[Math.max(0, j - 1) * w + i] - H[Math.min(h - 1, j + 1) * w + i]) / 2;
      const l = Math.hypot(gx, gyUp, 1);
      x[k] = -gx / l; y[k] = -gyUp / l; z[k] = 1 / l; alpha[k] = hasAlpha ? render.alpha[k] : 1;
    }
    return { id: render.id + '|inflate|' + roundness, name: 'Inflated outline', w, h, x, y, z, alpha };
  }
  // exact Euclidean distance (px) from each inside pixel to the nearest outside pixel
  function edt(mask, w, h) {
    const INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h));
    const v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1), D = new Float64Array(w * h);
    const pass = (len) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
        if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    };
    for (let i = 0; i < w; i++) { for (let j = 0; j < h; j++) f[j] = mask[j * w + i] ? INF : 0; pass(h); for (let j = 0; j < h; j++) D[j * w + i] = d[j]; }
    for (let j = 0; j < h; j++) { for (let i = 0; i < w; i++) f[i] = D[j * w + i]; pass(w); for (let i = 0; i < w; i++) D[j * w + i] = Math.sqrt(d[i]); }
    return D;
  }

  // Find the backdrop and return a mask (1 = backdrop), or null when there isn't a clear one.
  // Colour pictures: like a magic wand, grow in from the border across neighbouring pixels whose
  // colour changes only a little (so a sky's gradient is followed) and stop at real edges; a guard
  // keeps the fill near the colour it started on. Grey pictures: smooth grey stone and smooth grey
  // sky look the same, so only a truly flat backdrop around the border is removed.
  function backdropMask(img) {
    const { w, h, lum, alpha } = img, n = w * h, rgb = img.rgb;
    const border = [];
    for (let i = 0; i < w; i++) border.push(i, (h - 1) * w + i);
    for (let j = 0; j < h; j++) border.push(j * w, j * w + w - 1);
    let chroma = 0;
    if (rgb) for (const k of border) chroma += (Math.max(rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]) - Math.min(rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2])) / 255;
    const colourful = rgb && chroma / border.length > 0.08;
    const mask = new Uint8Array(n), seed = new Int32Array(n).fill(-1), stack = new Int32Array(n); let top = 0, count = 0;
    const take = (k, s0) => { mask[k] = 1; seed[k] = s0; stack[top++] = k; count++; };
    let ok;
    if (colourful) {
      const c = (k, i) => rgb[3 * k + i] / 255;
      const diff = (a2, b2) => Math.max(Math.abs(c(a2, 0) - c(b2, 0)), Math.abs(c(a2, 1) - c(b2, 1)), Math.abs(c(a2, 2) - c(b2, 2)));
      ok = (q, k, s0) => diff(q, k) < 0.045 && diff(q, s0) < 0.45;
    } else {
      const vals = border.map((k) => lum[k]).sort((a2, b2) => a2 - b2), med = vals[vals.length >> 1];
      if (vals.filter((v) => Math.abs(v - med) < 0.07).length / vals.length < 0.8) return null;   // the border is not one flat tone
      ok = (q) => Math.abs(lum[q] - med) < 0.07;
    }
    for (const k of border) if (!mask[k] && alpha[k] > 0.5 && (colourful || ok(k))) take(k, k);
    while (top) {
      const k = stack[--top], x = k % w, y = (k - x) / w, s0 = seed[k];
      if (x > 0) { const q = k - 1; if (!mask[q] && alpha[q] > 0.5 && ok(q, k, s0)) take(q, s0); }
      if (x < w - 1) { const q = k + 1; if (!mask[q] && alpha[q] > 0.5 && ok(q, k, s0)) take(q, s0); }
      if (y > 0) { const q = k - w; if (!mask[q] && alpha[q] > 0.5 && ok(q, k, s0)) take(q, s0); }
      if (y < h - 1) { const q = k + w; if (!mask[q] && alpha[q] > 0.5 && ok(q, k, s0)) take(q, s0); }
    }
    return count > n * 0.08 ? mask : null;
  }
  // the picture with its plain backdrop made transparent (edges still come from the picture itself)
  function knockout(img) {
    if (img.alpha.some((a) => a < 0.99)) return img;   // already has real transparency
    const m = backdropMask(img); if (!m) return img;
    const alpha = new Float32Array(img.w * img.h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = m[i] ? 0 : img.alpha[i];
    return { ...img, id: img.id + '|ko', alpha, hasAlpha: false, _cov: null, _flow: null };
  }

  // Put a render and a normal map together. nmap = { id, w, h, x, y, z (y-up), alpha }.
  // 'light' uses the normal map alone (its size and outline); otherwise the render leads and
  // the normals are stretched to match it.
  function combine(render, nmap, mode, flipY) {
    if (!nmap) return render;
    const light = mode === 'light', base = light ? nmap : render, w = base.w, h = base.h, n = w * h;
    const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
    const sx = nmap.w / w, sy = nmap.h / h, fy = flipY ? -1 : 1;
    for (let j = 0; j < h; j++) {
      const row = Math.min(nmap.h - 1, ((j + 0.5) * sy) | 0) * nmap.w;
      for (let i = 0; i < w; i++) {
        const k = row + Math.min(nmap.w - 1, ((i + 0.5) * sx) | 0), o = j * w + i;
        x[o] = nmap.x[k]; y[o] = fy * nmap.y[k]; z[o] = nmap.z[k];
      }
    }
    return {
      id: (light ? '' : render.id) + '|' + nmap.id + '|' + mode + '|' + (flipY ? 1 : 0), name: render.name, w, h,
      lum: light ? new Float32Array(n).fill(0.5) : render.lum, alpha: light ? nmap.alpha : render.alpha, normal: { x, y, z },
    };
  }

  // =================== motion helpers ===================
  // share of the logo's marks kept by centre diffusion at a given centre density (0 … 100)
  function diffusionKeep(p, centrePct) {
    const mode = p.centreMode === 'hamburger' ? 'hamburger' : 'cross';
    const cl = (v) => Math.min(1, Math.max(0, v));
    const CV = 0.04 + 0.96 * cl(centrePct / 100), CE = 4 - 3.65 * cl(p.centreReach / 100), HBW = 0.15 + 0.6 * cl(p.centreReach / 100);
    return (x, y) => {
      if (CV >= 1) return 1;
      const w = mode === 'hamburger' ? Math.exp(-((y / HBW) ** 2)) : Math.pow(Math.sqrt(Math.max(0, 1 - x * x - y * y)), CE);
      return 1 - (1 - CV) * w;
    };
  }
  // one animated SVG: the marks appear in batches, in a random order
  function buildUpSvg(res, p, seconds = 3, groups = 24, loop = false) {
    const W = res.width, H = res.height, R = rng(p.seed + 5), n = res.n;
    const bucket = new Uint8Array(n); for (let i = 0; i < n; i++) bucket[i] = Math.min(groups - 1, (R() * groups) | 0);
    const parts = [];
    for (let g = 0; g < groups; g++) {
      const sub = { ...res, shape: res.shape.map((v, i) => (bucket[i] === g ? v : -1)) };
      parts.push(`<g class="b" style="animation-delay:${((g / groups) * seconds * 0.85).toFixed(3)}s">${marks(sub, p, 'compact', 1, W <= 512 ? 2 : 1)}</g>`);
    }
    const dur = Math.max(0.2, (seconds / groups) * 2.5).toFixed(2);
    const css = loop
      ? `.b{opacity:0;animation:a ${seconds * 1.4}s ease-in-out infinite}@keyframes a{0%{opacity:0}12%{opacity:1}75%{opacity:1}100%{opacity:0}}`
      : `.b{opacity:0;animation:a ${dur}s ease-out forwards}@keyframes a{to{opacity:1}}@media (prefers-reduced-motion:reduce){.b{animation:none;opacity:1}}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<!-- Comput · build up · ${seconds}s · ${res.circles} 0s · ${res.lines} 1s · seed ${p.seed} -->` +
      `<style>${css}</style>` + bgRect(p, W, H) + parts.join('') + `</svg>`;
  }

  // =================== scenes: Comput's own 3D shapes ===================
  // scene = { shapes: [{ type, x, y, z, size, q, rx, ry, rz }], melt, ground, yaw, pitch, aspect }
  // World is y-up; the frame is 2 units tall. Orthographic camera, like the logo.
  // Shapes are signed distance functions, ray-marched per pixel; the result is a picture
  // with normals, cast shadows and contact shadows that the logo's light model then reads.
  const SHAPES = {
    sphere: { label: 'Sphere', q: false, bound: 1 },
    cube: { label: 'Cube', q: true, bound: 1.6 },
    cylinder: { label: 'Cylinder', q: true, bound: 1.6 },
    ring: { label: 'Ring', q: true, bound: 1.4 },
    capsule: { label: 'Capsule', q: true, bound: 2.1 },
    custom: { label: 'Drawn', q: false, bound: 1.5 },
  };

  // ---------- drawn shapes ----------
  // A closed outline drawn by the designer (points in its own plane, fitted to -1..1), smoothed
  // into a curve, turned into a 2D distance field, then given depth: flat with crisp edges at
  // Inflate 0, puffed up like a balloon as Inflate rises.
  const DRAWN_GRID = 160, DRAWN_EXT = 1.25, DRAWN_SLOTS = 8;
  // closed Catmull-Rom curve through the points
  function splinePoints(pts, per = 14) {
    const n = pts.length, out = [];
    if (n < 3) return pts.slice();
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
      }
    }
    return out;
  }
  // Bezier outlines: each anchor is [x, y, inX, inY, outX, outY], handles relative to the anchor
  // (0, 0 = a corner on that side). Older drawings are plain [x, y] points smoothed as above.
  const isBez = (pts) => Array.isArray(pts) && pts.length > 0 && pts[0].length >= 6;
  function toBezier(pts) {
    if (isBez(pts)) return pts.map((q) => q.slice(0, 6));
    const n = pts.length;
    return pts.map((q, i) => {   // a Catmull-Rom curve is exactly a Bezier with these handles
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], ox = (b[0] - a[0]) / 6, oy = (b[1] - a[1]) / 6;
      return [q[0], q[1], -ox, -oy, ox, oy];
    });
  }
  // one segment, anchor i to the next, as its four control points
  function bezSeg(P, i, closed = true) {
    const a = P[i], b = P[(i + 1) % P.length];
    return [[a[0], a[1]], [a[0] + a[4], a[1] + a[5]], [b[0] + b[2], b[1] + b[3]], [b[0], b[1]]];
  }
  const bezAt = (c, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]); };
  // the closed outline as a polygon (straight segments need only their ends)
  function pathPoints(pts, per = 16) {
    if (!isBez(pts)) return splinePoints(pts, Math.max(4, Math.round(per * 0.9)));
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const c = bezSeg(pts, i), straight = !pts[i][4] && !pts[i][5] && !pts[(i + 1) % pts.length][2] && !pts[(i + 1) % pts.length][3];
      const m = straight ? 1 : per;
      for (let k = 0; k < m; k++) out.push(bezAt(c, k / m));
    }
    return out;
  }
  // split segment i at t (de Casteljau): the outline keeps its exact shape, with a new anchor at t
  function splitPath(pts, i, t) {
    const P = toBezier(pts), c = bezSeg(P, i), L = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const p01 = L(c[0], c[1]), p12 = L(c[1], c[2]), p23 = L(c[2], c[3]), a = L(p01, p12), b = L(p12, p23), m = L(a, b);
    const j = (i + 1) % P.length, A = P[i], B = P[j];
    A[4] = p01[0] - A[0]; A[5] = p01[1] - A[1];
    B[2] = p23[0] - B[0]; B[3] = p23[1] - B[1];
    const nw = [m[0], m[1], a[0] - m[0], a[1] - m[1], b[0] - m[0], b[1] - m[1]];
    P.splice(i + 1, 0, nw);
    return { pts: P, index: i + 1 };
  }
  // re-centre an outline in -1..1 (by the curve itself, not just its anchors)
  function fitPath(pts) {
    const P = toBezier(pts), poly = pathPoints(P, 24), xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ext = Math.max(1e-3, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2);
    const r = (v) => Math.round(v * 1e4) / 1e4;
    return { cx, cy, ext, pts: P.map((q) => [r((q[0] - cx) / ext), r((q[1] - cy) / ext), r(q[2] / ext), r(q[3] / ext), r(q[4] / ext), r(q[5] / ext)]) };
  }
  const _fields = new Map();
  // signed distance field of the smoothed outline on a grid (row 0 = bottom); inr = deepest inside distance
  function drawnField(pts) {
    const key = JSON.stringify(pts);
    if (_fields.has(key)) return _fields.get(key);
    const poly = pathPoints(pts), n = poly.length, G = DRAWN_GRID, E = DRAWN_EXT, F = new Float32Array(G * G);
    let inr = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = -E + ((i + 0.5) / G) * 2 * E, y = -E + ((j + 0.5) / G) * 2 * E;
      let d = Infinity, sgn = 1;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ax = poly[a][0], ay = poly[a][1], ex = poly[b][0] - ax, ey = poly[b][1] - ay, wx = x - ax, wy = y - ay;
        const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
        const bx = wx - ex * t, by = wy - ey * t; d = Math.min(d, bx * bx + by * by);
        const c1 = y >= ay, c2 = y < poly[b][1], c3 = ex * wy > ey * wx;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sgn = -sgn;
      }
      const v = sgn * Math.sqrt(d); F[j * G + i] = v; if (-v > inr) inr = -v;
    }
    const sample = (x, y) => {
      const cx = Math.max(-E, Math.min(E, x)), cy = Math.max(-E, Math.min(E, y)), out = Math.hypot(x - cx, y - cy);
      const fx = ((cx + E) / (2 * E)) * G - 0.5, fy = ((cy + E) / (2 * E)) * G - 0.5;
      const i0 = Math.max(0, Math.min(G - 2, Math.floor(fx))), j0 = Math.max(0, Math.min(G - 2, Math.floor(fy)));
      const tx = Math.max(0, Math.min(1, fx - i0)), ty = Math.max(0, Math.min(1, fy - j0));
      const v = (F[j0 * G + i0] * (1 - tx) + F[j0 * G + i0 + 1] * tx) * (1 - ty) + (F[(j0 + 1) * G + i0] * (1 - tx) + F[(j0 + 1) * G + i0 + 1] * tx) * ty;
      return v + out;
    };
    const f = { key, grid: F, inr: Math.max(inr, 1e-3), sample };
    _fields.set(key, f); while (_fields.size > 32) _fields.delete(_fields.keys().next().value);
    return f;
  }
  const DEFAULT_DRAWN = [[0, 1], [0.95, 0.3], [0.6, -0.8], [-0.6, -0.8], [-0.95, 0.3]];
  // o: the shape itself; w, h, d stretch it along its own x, y, z (1 = as before), round is the
  // corner radius as a share of its thinnest half-size (cube and cylinder)
  const dims = (o) => ({ w: Math.max(0.02, o.w ?? 1), h: Math.max(0.02, o.h ?? 1), d: Math.max(0.02, o.d ?? 1) });
  function shapeSdf(type, q, o = {}) {
    const { w, h, d } = dims(o);
    switch (type) {
      case 'cube': {
        const bx = 0.8 * w, by = 0.8 * (0.25 + 1.5 * q) * h, bz = 0.8 * d, rr = Math.min(bx, by, bz) * Math.min(0.95, Math.max(0, o.round ?? 0.0875));
        return (x, y, z) => { const ax = Math.abs(x) - bx + rr, ay = Math.abs(y) - by + rr, az = Math.abs(z) - bz + rr;
          return Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) + Math.min(Math.max(ax, ay, az), 0) - rr; }; }
      case 'cylinder': {
        const r = 0.8 * w, hh = 0.8 * (0.2 + 1.6 * q) * h, rr = Math.min(r, hh) * Math.min(0.95, Math.max(0, o.round ?? 0.0625));
        return (x, y, z) => { const dx = Math.hypot(x, z) - r + rr, dy = Math.abs(y) - hh + rr;
          return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - rr; }; }
      case 'ring': { const R = 0.8 * w, r = (0.08 + 0.4 * q) * h;
        return (x, y, z) => Math.hypot(Math.hypot(x, z) - R, y) - r; }
      case 'capsule': { const r = 0.42 * w, hh = 1.4 * q * h;
        return (x, y, z) => { const cy = y - Math.max(-hh, Math.min(hh, y)); return Math.hypot(x, cy, z) - r; }; }
      case 'custom': {
        // depth: half-thickness 0.25 x Depth; Inflate (round) sets how far in from the edge the full thickness is reached
        const fld = drawnField(Array.isArray(o.pts) && o.pts.length >= 3 ? o.pts : DEFAULT_DRAWN), k = Math.min(w, h), hz = 0.25 * d;
        const Rk = Math.max(0.02, Math.min(1, o.round ?? 0.6) * fld.inr);
        return (x, y, z) => {
          const s2 = fld.sample(x / w, y / h), d2 = s2 * k, t = 1 - Math.min(Math.max(0, -s2) / Rk, 1);
          const prof = Math.sqrt(Math.max(0, 1 - t * t));
          return Math.max(d2, (Math.abs(z) - hz * prof) * 0.6);
        };
      }
      default:
        if (w === 1 && h === 1 && d === 1) return (x, y, z) => Math.hypot(x, y, z) - 1;
        // ellipsoid (a close approximation of the distance, exact at the surface)
        return (x, y, z) => { const k0 = Math.hypot(x / w, y / h, z / d), k1 = Math.hypot(x / (w * w), y / (h * h), z / (d * d));
          return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(w, h, d); };
    }
  }
  function rotMat(rx, ry, rz) {   // degrees, applied X then Y then Z
    const a = (rx * Math.PI) / 180, b = (ry * Math.PI) / 180, c = (rz * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    const X = [1, 0, 0, 0, ca, -sa, 0, sa, ca], Y = [cb, 0, sb, 0, 1, 0, -sb, 0, cb], Z = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
    const mul = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]); return o; };
    return mul(Z, mul(Y, X));
  }
  function camera(scene) {
    const yaw = ((scene.yaw || 0) * Math.PI) / 180, pitch = ((scene.pitch ?? 12) * Math.PI) / 180;
    // forward looks towards -z, tilted down by pitch, turned by yaw
    const F = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const Rt = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const U = [Rt[1] * F[2] - Rt[2] * F[1], Rt[2] * F[0] - Rt[0] * F[2], Rt[0] * F[1] - Rt[1] * F[0]];
    return { F, R: Rt, U };
  }
  // camera framing on top of orbit: zoom (1 = the frame is 2 units tall) and pan (camera-plane units)
  const framing = (scene) => ({ zoom: Math.min(8, Math.max(0.2, scene.zoom || 1)), panX: scene.panX || 0, panY: scene.panY || 0 });
  // where a world point lands on the artboard (px)
  function projectPoint(scene, x, y, z, W, H) {
    const { R, U, F } = camera(scene), { zoom, panX, panY } = framing(scene), aspect = W / H;
    const u = x * R[0] + y * R[1] + z * R[2], v = x * U[0] + y * U[1] + z * U[2];
    return { px: (((u - panX) * zoom + aspect) / (2 * aspect)) * W, py: ((1 - (v - panY) * zoom) / 2) * H, R, U, F, zoom };
  }
  // where a shape's centre lands on the artboard (px), and how big it looks
  function projectShape(scene, sh, W, H) {
    const q = projectPoint(scene, sh.x, sh.y, sh.z, W, H);
    return { ...q, r: (boundOf(sh) / 2) * H * q.zoom * (sh.type === 'sphere' ? 1 : 0.8) };
  }
  // local half-extents of each shape before scaling (used for the ground height)
  function shapeExtent(type, q, o = {}) {
    const { w, h, d } = dims(o);
    switch (type) {
      case 'cube': return [0.8 * w, 0.8 * (0.25 + 1.5 * q) * h, 0.8 * d];
      case 'cylinder': return [0.8 * w, 0.8 * (0.2 + 1.6 * q) * h, 0.8 * w];
      case 'ring': { const r = (0.08 + 0.4 * q) * h; return [0.8 * w + r, r, 0.8 * w + r]; }
      case 'capsule': return [0.42 * w, 1.4 * q * h + 0.42 * w, 0.42 * w];
      case 'custom': return [w * 1.05, h * 1.05, 0.25 * d];
      default: return [w, h, d];
    }
  }
  const boundOf = (sh) => Math.hypot(...shapeExtent(sh.type, sh.q ?? 0.5, sh)) * sh.size;
  // the ground sits under the lowest point of any shape
  function groundY(scene) {
    let m = Infinity;
    for (const sh of scene.shapes || []) {
      if (sh.cut) continue;
      const e = shapeExtent(sh.type, sh.q ?? 0.5, sh), M = rotMat(sh.rx || 0, sh.ry || 0, sh.rz || 0);
      const ey = sh.type === 'sphere' && e[0] === e[1] && e[1] === e[2] ? e[1] : Math.abs(M[3]) * e[0] + Math.abs(M[4]) * e[1] + Math.abs(M[5]) * e[2];
      m = Math.min(m, sh.y - ey * sh.size);
    }
    return m;
  }
  // rotation matrix (Z·Y·X, row-major) back to the X, Y, Z angles in degrees
  function matToEuler(M) {
    const b = Math.asin(Math.max(-1, Math.min(1, -M[6])));
    let a, c;
    if (Math.abs(M[6]) < 0.9999) { a = Math.atan2(M[7], M[8]); c = Math.atan2(M[3], M[0]); }
    else { a = Math.atan2(-M[5], M[4]); c = 0; }
    const d = 180 / Math.PI;
    return { rx: a * d, ry: b * d, rz: c * d };
  }
  // rotation about any axis (Rodrigues), row-major
  function axisMat(ax, ay, az, deg) {
    const l = Math.hypot(ax, ay, az) || 1, x = ax / l, y = ay / l, z = az / l, t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  function matMul(A, B) { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]); return o; }
  const aspectOf = (a) => ({ '1:1': 1, '4:5': 0.8, '3:2': 1.5, '16:9': 16 / 9 }[a] || 1);
  const sceneKey = (scene, p, w, h) => 'scene:' + w + 'x' + h + ':' + JSON.stringify(scene) + ':' + [p.iLightX, p.iLightY].join(',');

  async function renderScene(scene, p, w, h, opt = {}) {
    const maybeYield = yielder(opt, 0, 1);
    const n = w * h, aspect = w / h, { zoom, panX, panY } = framing(scene);
    const lum = new Float32Array(n), alpha = new Float32Array(n), kind = new Uint8Array(n), edgeSrc = new Float32Array(n);
    const NX = new Float32Array(n), NY = new Float32Array(n), NZ = new Float32Array(n), SH = new Float32Array(n), AO = new Float32Array(n).fill(1);
    const id = sceneKey(scene, p, w, h);
    const shapes = (scene.shapes || []).map((sh) => ({
      sh, f: shapeSdf(sh.type, sh.q ?? 0.5, sh), M: rotMat(sh.rx || 0, sh.ry || 0, sh.rz || 0), s: sh.size, cut: !!sh.cut,
    }));
    const img = { id, name: 'Scene', w, h, lum, alpha, kind, edgeSrc, shadow: SH, ao: AO, normal: { x: NX, y: NY, z: NZ } };
    if (!shapes.length) return img;
    const k = Math.max(1e-4, scene.melt || 0);
    const map = (x, y, z) => {
      let d = 1e9;
      for (const o of shapes) {
        const dx = x - o.sh.x, dy = y - o.sh.y, dz = z - o.sh.z, M = o.M, s = o.s;
        // inverse rotation (transpose), then scale
        const lx = (M[0] * dx + M[3] * dy + M[6] * dz) / s, ly = (M[1] * dx + M[4] * dy + M[7] * dz) / s, lz = (M[2] * dx + M[5] * dy + M[8] * dz) / s;
        const e = o.f(lx, ly, lz) * s;
        if (o.cut) { d = Math.max(d, -e); continue; }          // a cut shape carves away what came before it
        if (k <= 1e-4) d = Math.min(d, e);
        else { const hh = Math.max(0, Math.min(1, 0.5 + (0.5 * (e - d)) / k)); d = e * (1 - hh) + d * hh - k * hh * (1 - hh); }
      }
      return d;
    };
    // bounding sphere of the whole scene, to skip empty rays quickly
    const solid = shapes.filter((o) => !o.cut); if (!solid.length) return img;
    let bx = 0, by = 0, bz = 0; for (const o of solid) { bx += o.sh.x; by += o.sh.y; bz += o.sh.z; }
    bx /= solid.length; by /= solid.length; bz /= solid.length;
    let br = 0; for (const o of solid) br = Math.max(br, Math.hypot(o.sh.x - bx, o.sh.y - by, o.sh.z - bz) + boundOf(o.sh) + k);
    const { F, R, U } = camera(scene);
    let L0 = p.iLightX, L1 = p.iLightY, L2 = 1; { const l = Math.hypot(L0, L1, L2); L0 /= l; L1 /= l; L2 /= l; }
    const LW = [L0 * R[0] + L1 * U[0] - L2 * F[0], L0 * R[1] + L1 * U[1] - L2 * F[1], L0 * R[2] + L1 * U[2] - L2 * F[2]];
    const softShadow = (x, y, z) => {
      let res = 1, t = 0.02;
      for (let i = 0; i < 40 && t < 5; i++) {
        const d = map(x + LW[0] * t, y + LW[1] * t, z + LW[2] * t);
        if (d < 0.0015) return 0;
        res = Math.min(res, (10 * d) / t); t += Math.max(0.015, Math.min(0.25, d));
      }
      return Math.max(0, Math.min(1, res));
    };
    const D = 6, HX = new Float32Array(n), HY = new Float32Array(n), HZ = new Float32Array(n);
    let minY = Infinity;
    // pass 1: the shapes
    for (let j = 0; j < h; j++) {
      const v = (1 - ((j + 0.5) / h) * 2) / zoom + panY;
      for (let i = 0; i < w; i++) {
        const u = ((((i + 0.5) / w) * 2 - 1) * aspect) / zoom + panX, q = j * w + i;
        const ox = u * R[0] + v * U[0] - F[0] * D, oy = u * R[1] + v * U[1] - F[1] * D, oz = u * R[2] + v * U[2] - F[2] * D;
        // ray vs bounding sphere
        const cx = ox - bx, cy = oy - by, cz = oz - bz, b = cx * F[0] + cy * F[1] + cz * F[2], c = cx * cx + cy * cy + cz * cz - br * br, disc = b * b - c;
        if (disc < 0) continue;
        let t = Math.max(0, -b - Math.sqrt(disc)); const tEnd = -b + Math.sqrt(disc);
        let hit = false;
        for (let it = 0; it < 96 && t < tEnd; it++) {
          const d = map(ox + F[0] * t, oy + F[1] * t, oz + F[2] * t);
          if (d < 0.0008) { hit = true; break; }
          t += d * 0.9;
        }
        if (!hit) continue;
        const x = ox + F[0] * t, y = oy + F[1] * t, z = oz + F[2] * t, e = 0.0015;
        let gx = map(x + e, y, z) - map(x - e, y, z), gy = map(x, y + e, z) - map(x, y - e, z), gz = map(x, y, z + e) - map(x, y, z - e);
        const gl = Math.hypot(gx, gy, gz) || 1; gx /= gl; gy /= gl; gz /= gl;
        // normals in camera space for the light model: x right, y up, z towards you
        NX[q] = gx * R[0] + gy * R[1] + gz * R[2]; NY[q] = gx * U[0] + gy * U[1] + gz * U[2]; NZ[q] = -(gx * F[0] + gy * F[1] + gz * F[2]);
        const px = x + gx * 0.004, py = y + gy * 0.004, pz = z + gz * 0.004;
        SH[q] = 1 - softShadow(px, py, pz);
        let occ = 0; for (let a = 1; a <= 4; a++) { const hh = 0.04 * a; occ += (hh - map(x + gx * hh, y + gy * hh, z + gz * hh)) / Math.pow(2, a - 1); }
        AO[q] = Math.max(0.35, Math.min(1, 1 - 2.2 * occ));
        alpha[q] = 1; kind[q] = 1; edgeSrc[q] = 1; HX[q] = x; HY[q] = y; HZ[q] = z;
        lum[q] = (0.1 + 0.9 * Math.max(0, gx * LW[0] + gy * LW[1] + gz * LW[2]) * (1 - SH[q])) * AO[q];
        if (y < minY) minY = y;
      }
      if ((j & 7) === 0) await maybeYield(0.8 * (j / h));
    }
    // pass 2: shadows on an invisible ground just under the lowest shape
    const gs = scene.ground ?? 0.6, gy0 = groundY(scene) - 0.004;
    if (gs > 0 && minY < Infinity && F[1] < -1e-3) {
      for (let j = 0; j < h; j++) {
        const v = (1 - ((j + 0.5) / h) * 2) / zoom + panY;
        for (let i = 0; i < w; i++) {
          const q = j * w + i; if (kind[q]) continue;
          const u = ((((i + 0.5) / w) * 2 - 1) * aspect) / zoom + panX;
          const ox = u * R[0] + v * U[0] - F[0] * D, oy = u * R[1] + v * U[1] - F[1] * D, oz = u * R[2] + v * U[2] - F[2] * D;
          const t = (gy0 - oy) / F[1]; if (t <= 0) continue;
          const x = ox + F[0] * t, z = oz + F[2] * t;
          // fade with distance from the shapes, so a low light gives a grounded shadow, not a streak
          const fade = Math.max(0, 1 - Math.hypot(x - bx, z - bz) / (br * 1.5));
          if (fade <= 0) continue;
          const sh = (1 - softShadow(x, gy0 + 0.002, z)) * fade * fade;
          if (sh > 0.02) { kind[q] = 2; alpha[q] = sh * gs; }
        }
        if ((j & 7) === 0) await maybeYield(0.8 + 0.2 * (j / h));
      }
    }
    return img;
  }

  // which shape is under an artboard point: cast one ray, take the first surface it meets,
  // or the shape it passed closest to if it misses by less than tolPx
  function pickShape(scene, W, H, px, py, tolPx = 8) {
    const list = (scene.shapes || []).map((sh) => ({ f: shapeSdf(sh.type, sh.q ?? 0.5, sh), M: rotMat(sh.rx || 0, sh.ry || 0, sh.rz || 0), sh }));
    if (!list.length) return -1;
    const { F, R, U } = camera(scene), { zoom, panX, panY } = framing(scene), aspect = W / H;
    const u = (((px / W) * 2 - 1) * aspect) / zoom + panX, v = (1 - (py / H) * 2) / zoom + panY;
    const o = [u * R[0] + v * U[0] - F[0] * 6, u * R[1] + v * U[1] - F[1] * 6, u * R[2] + v * U[2] - F[2] * 6];
    const tol = (tolPx * 2) / (H * zoom), near = new Array(list.length).fill(Infinity);
    let t = 0;
    for (let it = 0; it < 200 && t < 14; it++) {
      const x = o[0] + F[0] * t, y = o[1] + F[1] * t, z = o[2] + F[2] * t;
      let d = Infinity, bi = -1;
      list.forEach((L, i) => {
        const dx = x - L.sh.x, dy = y - L.sh.y, dz = z - L.sh.z, M = L.M, sc = L.sh.size;
        const e = L.f((M[0] * dx + M[3] * dy + M[6] * dz) / sc, (M[1] * dx + M[4] * dy + M[7] * dz) / sc, (M[2] * dx + M[5] * dy + M[8] * dz) / sc) * sc;
        if (e < near[i]) near[i] = e;
        if (e < d) { d = e; bi = i; }
      });
      if (d < 0.002) return bi;
      t += Math.max(0.002, d * 0.9);
    }
    let best = -1, bd = tol; near.forEach((e, i) => { if (e < bd) { bd = e; best = i; } });
    return best;
  }

  // ready-made scenes to start from
  const SCENES = {
    'zero-one': { label: '0 + 1', scene: { aspect: '3:2', melt: 0, ground: 0.6, yaw: 0, pitch: 12, shapes: [
      { type: 'ring', x: -0.62, y: 0, z: 0, size: 0.62, q: 0.62, rx: 90, ry: 0, rz: 0 },
      { type: 'capsule', x: 0.72, y: 0, z: 0, size: 0.6, q: 0.62, rx: 0, ry: 0, rz: 0 }] } },
    orbit: { label: 'Orbit', scene: { aspect: '1:1', melt: 0, ground: 0.5, yaw: 0, pitch: 14, shapes: [
      { type: 'sphere', x: 0, y: 0.05, z: 0, size: 0.5, rx: 0, ry: 0, rz: 0 },
      { type: 'ring', x: 0, y: 0.05, z: 0, size: 0.82, q: 0.12, rx: 18, ry: 0, rz: -16 }] } },
    stack: { label: 'Stack', scene: { aspect: '4:5', melt: 0, ground: 0.6, yaw: 28, pitch: 16, shapes: [
      { type: 'cylinder', x: 0, y: -0.52, z: 0, size: 0.42, q: 0.32, rx: 0, ry: 0, rz: 0 },
      { type: 'cube', x: 0, y: 0.02, z: 0, size: 0.3, q: 0.5, rx: 0, ry: 20, rz: 0 },
      { type: 'sphere', x: 0, y: 0.5, z: 0, size: 0.22, rx: 0, ry: 0, rz: 0 }] } },
    pebbles: { label: 'Pebbles', scene: { aspect: '3:2', melt: 0.12, ground: 0.6, yaw: 0, pitch: 10, shapes: [
      { type: 'sphere', x: -0.55, y: -0.2, z: 0, size: 0.42, rx: 0, ry: 0, rz: 0 },
      { type: 'sphere', x: 0.05, y: -0.32, z: 0.12, size: 0.32, rx: 0, ry: 0, rz: 0 },
      { type: 'sphere', x: 0.55, y: -0.4, z: -0.1, size: 0.24, rx: 0, ry: 0, rz: 0 },
      { type: 'capsule', x: 0.1, y: 0.25, z: -0.2, size: 0.3, q: 0.7, rx: 0, ry: 0, rz: 70 }] } },
  };

  // Full run. opt.cache: a Map reused between calls, so changing only the 0s and 1s
  // skips the slow stage. opt.draft: quick low-relaxation preview.
  // opt.image is required when p.source === 'image'.
  async function generate(p, size, opt = {}) {
    if (p.source === 'scene') p = { ...p, imgLight: 'light' };
    const pic = p.source === 'image' || p.source === 'scene';
    const img = pic ? opt.image : null;
    if (pic && !img) throw new Error(p.source === 'scene' ? 'The scene is empty' : 'No image loaded');
    const key = img ? imageKey(p, img, size, opt.draft) : positionsKey(p, size, opt.draft);
    const motion = !!(opt.init || opt.fixedN || opt.stable);
    let pos = !motion && opt.cache && opt.cache.get(key);
    if (pos) { pos = { ...pos, fromCache: true }; opt.cache.delete(key); opt.cache.set(key, pos); }
    else {
      pos = img ? await imagePositions(p, img, size, opt) : await positions(p, size, opt);
      if (opt.cache && !motion) { opt.cache.set(key, pos); while (opt.cache.size > 8) opt.cache.delete(opt.cache.keys().next().value); }
    }
    const res = img ? await imagePlace(pos, p, img, opt) : await place(pos, p, opt);
    res.relaxed = pos.relaxed;
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

  return { DEFAULTS, POSITION_KEYS, TONE_KEYS, coverage, pickShape, boundOf, knockout, splinePoints, pathPoints, toBezier, splitPath, fitPath, bezSeg, bezAt, drawnField, DRAWN_GRID, DRAWN_EXT, DRAWN_SLOTS, camera, framing, projectPoint, groundY, rotMat, matToEuler, axisMat, matMul, logoDensity, shapeExtent, diffusionKeep, buildUpSvg, rng, plan, imagePlan, sampleImage, combine, inflate, renderScene, projectShape, aspectOf, SHAPES, SCENES, generate, positions, place, positionsKey, svg, responsiveSvg, thresholds, Cancelled };
})();
if (typeof module !== 'undefined') module.exports = Comput;
