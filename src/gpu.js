/* Comput GPU preview for scenes.
 *
 * While you drag, orbit or rotate, the exact engine (ray-march on the CPU, then Lloyd
 * relaxation of every mark) is too slow to keep up. This draws the same picture on the GPU
 * every frame:
 *   pass 1: ray-march the same shapes, shadows and contact shadows, and turn them into the
 *           logo's mark density (same light, shadow and rim model) plus the surface direction;
 *   pass 2: a fixed set of progressive blue-noise points, each shown when the density there
 *           is above its rank, drawn as circles (0) and pills (1) with the same size, length,
 *           direction and foreshortening as the exact render.
 * The exact render replaces it a moment after you stop.
 */
const ComputGPU = (() => {
  const MAX = 12, TILE_N = 4096;

  const VS_FULL = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP, 0., 1.); }`;

  const FS_DENSITY = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uAspect, uZoom; uniform vec2 uPan;
uniform vec3 uF, uR, uU, uLW, uLC;
uniform int uN; uniform vec4 uPS[${MAX}]; uniform vec4 uPT[${MAX}]; uniform mat3 uM[${MAX}];
uniform float uMelt, uGround, uGY, uSP, uRP, uInvert, uEdge; uniform vec4 uBS;
out vec4 o;
float sdShape(int t, float q, vec3 p){
  if (t == 1) { vec3 b = vec3(0.8, 0.8 * (0.25 + 1.5 * q), 0.8); float rr = 0.07; vec3 a = abs(p) - b + rr;
    return length(max(a, 0.)) + min(max(a.x, max(a.y, a.z)), 0.) - rr; }
  if (t == 2) { float r = 0.8, hh = 0.8 * (0.2 + 1.6 * q), rr = 0.05; vec2 d = vec2(length(p.xz) - r + rr, abs(p.y) - hh + rr);
    return min(max(d.x, d.y), 0.) + length(max(d, 0.)) - rr; }
  if (t == 3) { float R = 0.8, r = 0.08 + 0.4 * q; return length(vec2(length(p.xz) - R, p.y)) - r; }
  if (t == 4) { float hh = 1.4 * q; vec3 c = p; c.y -= clamp(c.y, -hh, hh); return length(c) - 0.42; }
  return length(p) - 1.;
}
float map(vec3 p){
  float d = 1e9, k = max(1e-4, uMelt);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    vec3 l = (uM[i] * (p - uPS[i].xyz)) / uPS[i].w;
    float e = sdShape(int(uPT[i].x), uPT[i].y, l) * uPS[i].w;
    if (uMelt <= 1e-4) d = min(d, e);
    else { float h = clamp(0.5 + 0.5 * (e - d) / k, 0., 1.); d = mix(e, d, h) - k * h * (1. - h); }
  }
  return d;
}
float softShadow(vec3 p){
  float res = 1., t = 0.02;
  for (int i = 0; i < 40; i++) {
    if (t > 5.) break;
    float d = map(p + uLW * t);
    if (d < 0.0015) return 0.;
    res = min(res, 10. * d / t); t += clamp(d, 0.015, 0.25);
  }
  return clamp(res, 0., 1.);
}
void main(){
  float i = gl_FragCoord.x, j = uRes.y - gl_FragCoord.y;
  float u = (i / uRes.x * 2. - 1.) * uAspect / uZoom + uPan.x;
  float v = (1. - j / uRes.y * 2.) / uZoom + uPan.y;
  vec3 ro = u * uR + v * uU - uF * 6.;
  vec3 c = ro - uBS.xyz; float b = dot(c, uF), cc = dot(c, c) - uBS.w * uBS.w, disc = b * b - cc;
  if (disc >= 0.) {
    float t = max(0., -b - sqrt(disc)), tEnd = -b + sqrt(disc); bool hit = false;
    for (int it = 0; it < 96; it++) {
      if (t >= tEnd) break;
      float d = map(ro + uF * t);
      if (d < 0.0008) { hit = true; break; }
      t += d * 0.9;
    }
    if (hit) {
      vec3 x = ro + uF * t; float e = 0.0015;
      vec3 n = normalize(vec3(map(x + vec3(e,0,0)) - map(x - vec3(e,0,0)), map(x + vec3(0,e,0)) - map(x - vec3(0,e,0)), map(x + vec3(0,0,e)) - map(x - vec3(0,0,e))));
      vec3 nc = vec3(dot(n, uR), dot(n, uU), -dot(n, uF));
      float sh = 1. - softShadow(x + n * 0.004);
      float occ = 0.; for (int a = 1; a <= 4; a++) { float hh = 0.04 * float(a); occ += (hh - map(x + n * hh)) / pow(2., float(a - 1)); }
      float ao = clamp(1. - 2.2 * occ, 0.35, 1.);
      float li = clamp(dot(nc, uLC), 0., 1.) * (1. - sh) * ao;
      float s2 = 1. - li, rim = 1. - max(0., nc.z), LT = 1. + uSP + uRP;
      float tl = (1. + uSP * s2 * s2 + uRP * pow(rim, 2.5)) / LT;
      if (uInvert > 0.5) tl = 1. - tl + 1. / LT;
      tl = min(1., tl + uEdge * 0.55 * pow(rim, 6.) * (1. - tl * 0.5));
      o = vec4(tl, nc.x * 0.5 + 0.5, nc.y * 0.5 + 0.5, max(0., nc.z));
      return;
    }
  }
  if (uGround > 0. && uF.y < -1e-3) {
    float t = (uGY - ro.y) / uF.y;
    if (t > 0.) {
      vec3 g = ro + uF * t;
      float fade = max(0., 1. - length(g.xz - uBS.xz) / (uBS.w * 1.5));
      if (fade > 0.) { float sh = (1. - softShadow(vec3(g.x, uGY + 0.002, g.z))) * fade * fade; o = vec4(sh * uGround * 0.9, 0.5, 0.5, 0.); return; }
    }
  }
  o = vec4(0., 0.5, 0.5, 0.);
}`;

  const VS_MARKS = `#version 300 es
precision highp float; precision highp int;
uniform highp sampler2D uTile; uniform int uTileN, uTilesX;
uniform vec2 uOut; uniform float uTilePx, uPx;
uniform sampler2D uDen;
uniform float uD, uLW, uLen, uShare, uWig, uFore; uniform int uDir;
in vec2 aC;
out vec2 vP; out vec2 vA; out vec2 vB; flat out float vR;
void main(){
  int ti = gl_InstanceID % uTileN, tile = gl_InstanceID / uTileN;
  vec4 t = texelFetch(uTile, ivec2(ti, 0), 0);
  vec2 pos = (vec2(float(tile % uTilesX), float(tile / uTilesX)) + t.xy) * uTilePx;
  vec4 d = texture(uDen, vec2(pos.x / uOut.x, 1. - pos.y / uOut.y));
  if (pos.x > uOut.x || pos.y > uOut.y || t.z >= d.r) { gl_Position = vec4(0., 0., 2., 1.); return; }
  // pills give way to circles where marks are packed, as the exact engine does
  float share = uShare * (0.17 + 0.6 * exp(-d.r / 0.22)) / 0.77;
  bool pill = fract(t.w * 7.137) < share;
  vec2 n = d.gb * 2. - 1.; float nz = d.a;
  vec2 dir; float l = length(n), ang = 6.2831853 * fract(t.w * 3.17 + 0.5);
  if (uDir == 1) { vec2 tt = vec2(-n.x * n.y, 1. - n.y * n.y); dir = tt / (length(tt) + 1e-6); }
  else if (uDir == 3) dir = vec2(0., -1.);
  else { dir = l < 0.03 ? vec2(cos(ang), sin(ang)) : n / l; if (uDir == 2) dir = vec2(-dir.y, dir.x); }
  dir.y = -dir.y;
  float w = (fract(t.w * 91.7) - 0.5) * 3.4 * uWig * 0.0174533, cw = cos(w), sw = sin(w);
  dir = vec2(dir.x * cw - dir.y * sw, dir.x * sw + dir.y * cw);
  float squash = 1. - uFore * (1. - nz);
  float hl = pill ? max(uD * uLen * squash * 0.5 - uLW * 0.5, 0.) : 0.;
  float rad = pill ? uLW * 0.5 : uD * 0.5;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 corner = pos + dir * aC.x * (hl + rad + uPx) + perp * aC.y * (rad + uPx);
  vP = corner; vA = pos - dir * hl; vB = pos + dir * hl; vR = rad;
  gl_Position = vec4(corner.x / uOut.x * 2. - 1., 1. - corner.y / uOut.y * 2., 0., 1.);
}`;

  const FS_MARKS = `#version 300 es
precision highp float;
in vec2 vP; in vec2 vA; in vec2 vB; flat in float vR;
uniform vec4 uColor; uniform float uPx;
out vec4 o;
void main(){
  vec2 pa = vP - vA, ba = vB - vA; float bb = dot(ba, ba);
  float h = bb > 0. ? clamp(dot(pa, ba) / bb, 0., 1.) : 0.;
  float d = length(pa - ba * h) - vR;
  float a = clamp(0.5 - d / uPx, 0., 1.);
  if (a <= 0.) discard;
  o = vec4(uColor.rgb * a * uColor.a, a * uColor.a);
}`;

  // progressive blue noise on a torus: every prefix is evenly spread (best-candidate sampling)
  function blueNoiseTile(n, seed) {
    let a = seed >>> 0 || 1;
    const R = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const G = 64, cells = Array.from({ length: G * G }, () => []), out = new Float32Array(n * 4);
    const nearest = (x, y) => {
      const cx = (x * G) | 0, cy = (y * G) | 0; let best = 4;
      for (let r = 0; r < G / 2; r++) {
        if (best < 4 && (r - 1) / G > Math.sqrt(best)) break;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const c = cells[((cy + dy + G) % G) * G + ((cx + dx + G) % G)];
          for (const k of c) {
            let ddx = Math.abs(out[4 * k] - x), ddy = Math.abs(out[4 * k + 1] - y);
            if (ddx > 0.5) ddx = 1 - ddx; if (ddy > 0.5) ddy = 1 - ddy;
            const d2 = ddx * ddx + ddy * ddy; if (d2 < best) best = d2;
          }
        }
      }
      return best;
    };
    for (let i = 0; i < n; i++) {
      let bx = R(), by = R();
      if (i > 0) {
        let bd = -1; const tries = Math.min(24, 4 + (i >> 6));
        for (let k = 0; k < tries; k++) { const x = R(), y = R(), d = nearest(x, y); if (d > bd) { bd = d; bx = x; by = y; } }
      }
      out[4 * i] = bx; out[4 * i + 1] = by; out[4 * i + 2] = (i + 0.5) / n; out[4 * i + 3] = R();
      cells[((by * G) | 0) * G + ((bx * G) | 0)].push(i);
    }
    return out;
  }

  function create(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    let P1, P2;
    try { P1 = prog(VS_FULL, FS_DENSITY); P2 = prog(VS_MARKS, FS_MARKS); } catch (e) { console.warn('Comput GPU preview off:', e.message); return null; }
    const U = (p, n) => gl.getUniformLocation(p, n);
    const tri = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tri); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao1 = gl.createVertexArray(); gl.bindVertexArray(vao1); gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    const l1 = gl.getAttribLocation(P1, 'aP'); gl.enableVertexAttribArray(l1); gl.vertexAttribPointer(l1, 2, gl.FLOAT, false, 0, 0);
    const vao2 = gl.createVertexArray(); gl.bindVertexArray(vao2); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const l2 = gl.getAttribLocation(P2, 'aC'); gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // blue-noise tile
    const tileTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tileTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TILE_N, 1, 0, gl.RGBA, gl.FLOAT, blueNoiseTile(TILE_N, 7));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // density target
    const denTex = gl.createTexture(), fbo = gl.createFramebuffer(); let dw = 0, dh = 0;
    const sizeDensity = (w, h) => {
      if (w === dw && h === dh) return; dw = w; dh = h;
      gl.bindTexture(gl.TEXTURE_2D, denTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, denTex, 0);
    };
    const hex = (h) => { h = h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h; const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
    const TYPES = { sphere: 0, cube: 1, cylinder: 2, ring: 3, capsule: 4 };

    // st: { C (engine), scene, p, W, H (output px), pw, ph (canvas px) }
    function render(st) {
      const { C, scene, p, W, H } = st, aspect = W / H;
      if (canvas.width !== st.pw || canvas.height !== st.ph) { canvas.width = st.pw; canvas.height = st.ph; }
      const shapes = (scene.shapes || []).slice(0, MAX);
      // ---- pass 1: density ----
      const long = Math.min(560, Math.max(st.pw, st.ph)), rw = aspect >= 1 ? long : Math.round(long * aspect), rh = Math.max(1, Math.round(rw / aspect));
      sizeDensity(rw, rh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, rw, rh); gl.disable(gl.BLEND);
      gl.clearColor(0, 0.5, 0.5, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (shapes.length) {
        gl.useProgram(P1);
        const { F, R, U: Up } = C.camera(scene), { zoom, panX, panY } = C.framing(scene);
        let L0 = p.iLightX, L1 = p.iLightY, L2 = 1; const ll = Math.hypot(L0, L1, L2); L0 /= ll; L1 /= ll; L2 /= ll;
        const LW = [L0 * R[0] + L1 * Up[0] - L2 * F[0], L0 * R[1] + L1 * Up[1] - L2 * F[1], L0 * R[2] + L1 * Up[2] - L2 * F[2]];
        const PS = new Float32Array(MAX * 4), PT = new Float32Array(MAX * 4), M = new Float32Array(MAX * 9);
        let bx = 0, by = 0, bz = 0; shapes.forEach((s) => { bx += s.x; by += s.y; bz += s.z; }); bx /= shapes.length; by /= shapes.length; bz /= shapes.length;
        let br = 0; const k = Math.max(1e-4, scene.melt || 0);
        shapes.forEach((s, i) => {
          PS.set([s.x, s.y, s.z, s.size], 4 * i); PT.set([TYPES[s.type] ?? 0, s.q ?? 0.5, 0, 0], 4 * i);
          M.set(C.rotMat(s.rx || 0, s.ry || 0, s.rz || 0), 9 * i);   // row-major upload = transpose = the inverse rotation
          br = Math.max(br, Math.hypot(s.x - bx, s.y - by, s.z - bz) + s.size * C.SHAPES[s.type].bound + k);
        });
        gl.uniform2f(U(P1, 'uRes'), rw, rh); gl.uniform1f(U(P1, 'uAspect'), aspect); gl.uniform1f(U(P1, 'uZoom'), zoom); gl.uniform2f(U(P1, 'uPan'), panX, panY);
        gl.uniform3fv(U(P1, 'uF'), F); gl.uniform3fv(U(P1, 'uR'), R); gl.uniform3fv(U(P1, 'uU'), Up); gl.uniform3fv(U(P1, 'uLW'), LW); gl.uniform3f(U(P1, 'uLC'), L0, L1, L2);
        gl.uniform1i(U(P1, 'uN'), shapes.length); gl.uniform4fv(U(P1, 'uPS'), PS); gl.uniform4fv(U(P1, 'uPT'), PT); gl.uniformMatrix3fv(U(P1, 'uM'), false, M);
        gl.uniform1f(U(P1, 'uMelt'), scene.melt || 0); gl.uniform1f(U(P1, 'uGround'), scene.ground ?? 0.6); gl.uniform1f(U(P1, 'uGY'), C.groundY(scene) - 0.004);
        gl.uniform1f(U(P1, 'uSP'), p.iShadowPacking); gl.uniform1f(U(P1, 'uRP'), p.iRimPacking); gl.uniform1f(U(P1, 'uInvert'), p.imgInvert ? 1 : 0); gl.uniform1f(U(P1, 'uEdge'), p.imgEdge);
        gl.uniform4f(U(P1, 'uBS'), bx, by, bz, br);
        gl.bindVertexArray(vao1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // ---- pass 2: marks ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, st.pw, st.ph);
      if (p.background === 'none') gl.clearColor(0, 0, 0, 0); else { const b = hex(p.background); gl.clearColor(b[0], b[1], b[2], 1); }
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!shapes.length) return;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(P2);
      const D = Math.max(0.3, p.markPx), ld = C.logoDensity(p);
      const Mmax = (p.ink * ld.lt * 0.835) / (D * D * ld.mean);                 // marks per px² where the density is full
      const tilePx = Math.sqrt(TILE_N / Mmax), tx = Math.ceil(W / tilePx), ty = Math.ceil(H / tilePx);
      const inst = Math.min(4e6, TILE_N * tx * ty);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tileTex); gl.uniform1i(U(P2, 'uTile'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, denTex); gl.uniform1i(U(P2, 'uDen'), 1);
      gl.uniform1i(U(P2, 'uTileN'), TILE_N); gl.uniform1i(U(P2, 'uTilesX'), tx);
      gl.uniform2f(U(P2, 'uOut'), W, H); gl.uniform1f(U(P2, 'uTilePx'), tilePx); gl.uniform1f(U(P2, 'uPx'), W / st.pw);
      gl.uniform1f(U(P2, 'uD'), D); gl.uniform1f(U(P2, 'uLW'), D * p.lineWeight); gl.uniform1f(U(P2, 'uLen'), p.lineLength);
      gl.uniform1f(U(P2, 'uShare'), p.lineShare); gl.uniform1f(U(P2, 'uWig'), p.wiggle); gl.uniform1f(U(P2, 'uFore'), p.foreshorten);
      gl.uniform1i(U(P2, 'uDir'), { burst: 0, follow: 1, rings: 2, flow: 2, vertical: 3 }[p.imgDirection] ?? 0);
      const col = hex(p.color); gl.uniform4f(U(P2, 'uColor'), col[0], col[1], col[2], 1);
      gl.bindVertexArray(vao2); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst);
      gl.bindVertexArray(null);
    }
    return { render, gl };
  }
  return { create };
})();
