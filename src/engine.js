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
    centre: 100,         // % density left at the very centre
    centreReach: 50,     // % how far out towards the rim the thinning reaches
    centreMode: 'cross', // 'cross' thins across x and y, 'hamburger' mainly along y (a band through the middle)
    // marks
    lineShare: 0.6, lineLength: 1.9, lineWeight: 0.8,
    direction: 'radial', radialFrom: 'centre', foreshorten: 0.4,
    organic: 0.6, wiggle: 6, clustering: true,
    gap: 9,              // % of grain (0.5px at the original 5.5px grain)
    // colour
    color: '#111111', background: 'none', seed: 3,
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
  function buildGrid(X, Y, n, min, cell, dim) {
    const start = new Int32Array(dim * dim + 1), cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let gx = ((X[i] - min) / cell) | 0, gy = ((Y[i] - min) / cell) | 0;
      gx = gx < 0 ? 0 : gx >= dim ? dim - 1 : gx;
      gy = gy < 0 ? 0 : gy >= dim ? dim - 1 : gy;
      const c = gy * dim + gx; cellOf[i] = c; start[c + 1]++;
    }
    for (let c = 0; c < dim * dim; c++) start[c + 1] += start[c];
    const fill = start.slice(0, dim * dim), items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fill[cellOf[i]]++] = i;
    return { start, items };
  }

  // yield to the page without setTimeout's 4 ms / background-tab clamping
  const tick = typeof MessageChannel !== 'undefined'
    ? (() => { const ch = new MessageChannel(), q = []; ch.port1.onmessage = () => q.shift()(); if (ch.port1.unref) ch.port1.unref(); return () => new Promise((res) => { q.push(res); ch.port2.postMessage(0); }); })()
    : () => new Promise((res) => setTimeout(res, 0));

  async function generate(p, size, opt = {}) {
    const onProgress = opt.onProgress || (() => {});
    const cancelled = opt.cancelled || (() => false);
    const t0 = Date.now();
    const pl = plan(p, size);
    let N = pl.n;
    const R = rng(p.seed);
    let last = Date.now();
    const maybeYield = async (frac) => {
      if (Date.now() - last > 30) {
        onProgress(frac); await tick(); last = Date.now();
        if (cancelled()) throw new Cancelled();
      }
    };

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

    // centre diffusion: thin the marks where the ball faces you, leave the rim as it is.
    // keep() = share of the original density kept; 1 at the rim, `centre` at the middle.
    // cross: falls off with how much the ball faces you (x and y alike).
    // hamburger: falls off mainly with height, so a band through the middle thins while
    // the top and bottom stay packed; a little of the facing term keeps the side rims crisp.
    const CV = Math.min(1, Math.max(0, p.centre / 100));
    const CE = 4 - 3.65 * Math.min(1, Math.max(0, p.centreReach / 100)); // reach 0 → tight centre spot, 1 → reaches the rim
    const HAM = p.centreMode === 'hamburger';
    const HBW = 0.15 + 0.6 * Math.min(1, Math.max(0, p.centreReach / 100)); // band half-height
    function keep(x, y, nz) {
      if (CV >= 1) return 1;
      let w;
      if (HAM) { const cy = Math.sqrt(Math.max(0, 1 - y * y)), u = y / HBW; w = Math.exp(-u * u) * (cy > 1e-6 ? Math.pow(nz / cy, 0.6) : 0); }
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
    const M = Math.round(Math.min(3.2e6, Math.max(40000, N * 14)));
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

    const iters = Math.round(4 + 40 * (1 - p.organic));
    const h = Math.sqrt((2 * Math.PI) / N), GMIN = -1.02, GS = Math.ceil(2.04 / h);
    const AX = new Float64Array(N), AY = new Float64Array(N), AC = new Int32Array(N);
    for (let it = 0; it < iters; it++) {
      const { start, items } = buildGrid(X, Y, N, GMIN, h, GS);
      AX.fill(0); AY.fill(0); AC.fill(0);
      for (let q = 0; q < m; q++) {
        const x = SX[q], y = SY[q];
        const cx = ((x - GMIN) / h) | 0, cy = ((y - GMIN) / h) | 0;
        let best = Infinity, bi = -1;
        for (let r = 0; r < GS; r++) {
          if (bi >= 0 && r > 1) { const lim = (r - 1) * h; if (lim * lim >= best) break; }
          const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
          for (let gy = y0; gy <= y1; gy++) {
            if (gy < 0 || gy >= GS) continue;
            const step = gy === y0 || gy === y1 ? 1 : x1 - x0 || 1;
            for (let gx = x0; gx <= x1; gx += step) {
              if (gx < 0 || gx >= GS) continue;
              const c = gy * GS + gx;
              for (let k = start[c], e = start[c + 1]; k < e; k++) {
                const s = items[k], dx = X[s] - x, dy = Y[s] - y, d = dx * dx + dy * dy;
                if (d < best) { best = d; bi = s; }
              }
            }
          }
        }
        AX[bi] += x; AY[bi] += y; AC[bi]++;
        if ((q & 0xffff) === 0) await maybeYield(0.04 + 0.82 * ((it + q / m) / iters));
      }
      for (let i = 0; i < N; i++) if (AC[i]) { X[i] = AX[i] / AC[i]; Y[i] = AY[i] / AC[i]; }
    }

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

    // ---------- 4. circle or line, never letting marks touch ----------
    const wantLine = new Uint8Array(N);
    for (let i = 0; i < N; i++) wantLine[i] = R() < p.lineShare ? 1 : 0;
    const perm = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
    const ls = [], cs2 = [];
    for (let i = 0; i < N; i++) (wantLine[i] ? ls : cs2).push(i);
    const order = perm(ls).concat(perm(cs2));   // lines claim space first

    const reach = halfMax + Math.max(rad, lw / 2);
    const cell = 2 * reach + gap + 1e-6, gdim = Math.max(1, Math.ceil(S / cell) + 1);
    const { start, items } = buildGrid(PX, PY, N, 0, cell, gdim);
    const shape = new Int8Array(N).fill(-2);      // -2 pending, 0 circle, 1 line, -1 dropped
    for (let oi = 0; oi < N; oi++) {
      const i = order[oi];
      const gx = Math.min(gdim - 1, Math.max(0, (PX[i] / cell) | 0));
      const gy = Math.min(gdim - 1, Math.max(0, (PY[i] / cell) | 0));
      let placed = false;
      for (let tryLine = wantLine[i]; tryLine >= 0 && !placed; tryLine--) {
        const hi = tryLine ? HALF[i] : 0, ri = tryLine ? lw / 2 : rad;
        const ax = PX[i] - UX[i] * hi, ay = PY[i] - UY[i] * hi, bx = PX[i] + UX[i] * hi, by = PY[i] + UY[i] * hi;
        let clash = false;
        for (let yy = gy - 1; yy <= gy + 1 && !clash; yy++) {
          if (yy < 0 || yy >= gdim) continue;
          for (let xx = gx - 1; xx <= gx + 1 && !clash; xx++) {
            if (xx < 0 || xx >= gdim) continue;
            const c = yy * gdim + xx;
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
      if ((oi & 0x3fff) === 0) await maybeYield(0.86 + 0.14 * (oi / N));
    }

    let circles = 0, lines = 0, dropped = 0;
    for (let i = 0; i < N; i++) shape[i] === 0 ? circles++ : shape[i] === 1 ? lines++ : dropped++;
    onProgress(1);
    return {
      size: S, plan: pl, grain: D, rad, lw, n: N, x: PX, y: PY, ux: UX, uy: UY, half: HALF, shape,
      circles, lines, dropped, ms: Date.now() - t0,
    };
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

  function bgRect(p, w) { return p.background === 'none' ? '' : `<rect width="${w}" height="${w}" fill="${esc(p.background)}"/>`; }

  function svg(res, p, mode = 'elements') {
    const S = res.size, dec = S <= 512 ? 2 : 1;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
      `<!-- Comput · sphere · ${S}px · ${res.circles + res.lines} marks · grain ${r2(res.grain)}px · seed ${p.seed} -->` +
      bgRect(p, S) + marks(res, p, mode, 1, dec) + `</svg>`;
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
    const groups = results.map((r, i) =>
      `<g class="c c${i}"${i === def ? '' : ' display="none"'} data-size="${r.size}">${marks(r, p, 'compact', V / r.size, 1)}</g>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}">` +
      `<!-- Comput · responsive sphere · detail levels ${sizes.join('/')}px · switch at ${t.join('/')}px · seed ${p.seed} -->` +
      `<style>${css}</style>` + bgRect(p, V) + groups + `</svg>`;
  }

  return { DEFAULTS, plan, generate, svg, responsiveSvg, thresholds, Cancelled };
})();
if (typeof module !== 'undefined') module.exports = Comput;
