// Renders every README image with the same modules the web app uses.
//   node tools/render-docs.mjs
// Output: docs/img/*.png (static PNG and animated APNG)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { computeMaps, floorMaps, gaussianBlur, luminance, percentile, FLOOR_DEFAULTS } from '../js/normalmap.js';
import { renderLit, lightAmount, LIGHT_DEFAULTS } from '../js/lighting.js';
import { SPRITES, makeFloorTile } from '../js/sprites.js';

const OUT = new URL('../docs/img/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const written = [];

// ================================================================ PNG / APNG encoding
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
// filter: Up for rows identical to the previous one (upscaled pixel art), Sub otherwise
function idat(w, h, rgba) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), r = y * stride;
    let same = y > 0;
    for (let i = 0; same && i < stride; i++) if (rgba[r + i] !== rgba[r - stride + i]) same = false;
    raw[o] = same ? 2 : 1;
    for (let i = 0; i < stride; i++) {
      raw[o + 1 + i] = same ? 0 : (rgba[r + i] - (i >= 4 ? rgba[r + i - 4] : 0)) & 255;
    }
  }
  return deflateSync(raw, { level: 9 });
}
function ihdr(w, h) { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return b; }
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = (img) => Buffer.concat([SIG, chunk('IHDR', ihdr(img.w, img.h)), chunk('IDAT', idat(img.w, img.h, img.d)), chunk('IEND', Buffer.alloc(0))]);
function apng(frames, delayMs) {
  const { w, h } = frames[0];
  const parts = [SIG, chunk('IHDR', ihdr(w, h))];
  const ac = Buffer.alloc(8); ac.writeUInt32BE(frames.length, 0); ac.writeUInt32BE(0, 4);
  parts.push(chunk('acTL', ac));
  let seq = 0;
  frames.forEach((f, i) => {
    const fc = Buffer.alloc(26);
    fc.writeUInt32BE(seq++, 0); fc.writeUInt32BE(w, 4); fc.writeUInt32BE(h, 8);
    fc.writeUInt16BE(delayMs, 20); fc.writeUInt16BE(1000, 22);
    parts.push(chunk('fcTL', fc));
    const data = idat(w, h, f.d);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ================================================================ tiny image helper
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
class Img {
  constructor(w, h, fill = [0, 0, 0, 0]) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) this.d.set(fill, i * 4); }
  set(x, y, c) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; this.d.set(c.length === 3 ? [...c, 255] : c, (y * this.w + x) * 4); }
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4; if (src.d[i + 3] > 0) this.set(dx + x, dy + y, src.d.subarray(i, i + 4));
    }
    return this;
  }
  rect(x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c); }
  frame(x0, y0, w, h, c) { for (let x = x0; x < x0 + w; x++) { this.set(x, y0, c); this.set(x, y0 + h - 1, c); } for (let y = y0; y < y0 + h; y++) { this.set(x0, y, c); this.set(x0 + w - 1, y, c); } }
  scale(s) {
    const o = new Img(this.w * s, this.h * s);
    for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
      const i = ((y / s | 0) * this.w + (x / s | 0)) * 4; o.d.set(this.d.subarray(i, i + 4), (y * o.w + x) * 4);
    }
    return o;
  }
}
const fromFn = (w, h, fn) => { const m = new Img(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y, y * w + x); if (c) m.set(x, y, c); } return m; };
const CHK = [hex('#221d3a'), hex('#1b1730')];
const checker = (w, h) => fromFn(w, h, (x, y) => CHK[(x + y) & 1]);
const onChecker = (img) => checker(img.w, img.h).blit(img, 0, 0);
const save = (name, img, s = 1) => { const b = png(s > 1 ? img.scale(s) : img); writeFileSync(new URL(name, OUT), b); written.push([name, b.length]); };
const saveAnim = (name, frames, s, delay) => { const b = apng(frames.map((f) => f.scale(s)), delay); writeFileSync(new URL(name, OUT), b); written.push([name, b.length]); };

/** lay images out on a grid: rows of images with gap px, dark background */
function grid(rows, gap = 3, bg = hex('#15122a')) {
  const colW = [], rowH = rows.map((r) => Math.max(...r.map((i) => i.h)));
  rows.forEach((r) => r.forEach((im, c) => { colW[c] = Math.max(colW[c] || 0, im.w); }));
  const W = colW.reduce((a, b) => a + b, 0) + gap * (colW.length + 1), H = rowH.reduce((a, b) => a + b, 0) + gap * (rows.length + 1);
  const g = new Img(W, H, bg);
  let y = gap;
  rows.forEach((r, ri) => {
    let x = gap;
    r.forEach((im, c) => { g.blit(im, x + ((colW[c] - im.w) >> 1), y + (rowH[ri] - im.h)); x += colW[c] + gap; });
    y += rowH[ri] + gap;
  });
  return g;
}

// ================================================================ colour maps
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function stops(list) {
  const cs = list.map(hex);
  return (t) => { t = Math.max(0, Math.min(1, t)) * (cs.length - 1); const i = Math.min(cs.length - 2, Math.floor(t)); return lerp(cs[i], cs[i + 1], t - i).map(Math.round); };
}
const magma = stops(['#0c0717', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf']);
const grayRamp = stops(['#0e0c18', '#f5f1ff']);
const plasma = stops(['#0d0887', '#5b02a3', '#9a179b', '#cb4678', '#eb7852', '#fbb32f', '#f0f921']);
const NEG = stops(['#1d1a33', '#3f6fff', '#a8d4ff']), POS = stops(['#1d1a33', '#ff7a2f', '#ffe0a0']);
const diverging = (t) => (t < 0 ? NEG(-t) : POS(t));

// ================================================================ helpers on sprites
const DEF = Object.fromEntries(SPRITES.map((d) => [d.id, d]));
const make = (id, f = 0) => DEF[id].make(f);
const maps = (p, params) => computeMaps(p.data, p.w, p.h, params);
const albedo = (p, m) => fromFn(p.w, p.h, (x, y, i) => (p.data[i * 4 + 3] > 127 ? [p.data[i * 4], p.data[i * 4 + 1], p.data[i * 4 + 2]] : null));
const normalImg = (m, flipG = false) => fromFn(m.w, m.h, (x, y, i) => [m.normalRGBA[i * 4], flipG ? 255 - m.normalRGBA[i * 4 + 1] : m.normalRGBA[i * 4 + 1], m.normalRGBA[i * 4 + 2]]);

/** light one sprite; light position relative to the sprite size, transparent outside */
function litImg(p, m, { lx = -0.5, ly = 0.15, steps = 6, z = LIGHT_DEFAULTS.z, radius = LIGHT_DEFAULTS.radius, flat = false, flipY = false, clay = false } = {}) {
  const n = p.w * p.h, al = new Float32Array(n * 3), nn = new Float32Array(n * 3), out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) al[i * 3 + c] = clay ? 0.78 : p.data[i * 4 + c] / 255;
    if (flat) { nn[i * 3 + 2] = 1; continue; }
    nn[i * 3] = m.normal[i * 3]; nn[i * 3 + 1] = (flipY ? 1 : -1) * m.normal[i * 3 + 1]; nn[i * 3 + 2] = m.normal[i * 3 + 2];
  }
  renderLit({ w: p.w, h: p.h, albedo: al, normal: nn, emissive: clay ? null : p.em, lights: [{ ...LIGHT_DEFAULTS, z, radius, x: p.w * lx, y: p.h * ly }], ambient: LIGHT_DEFAULTS.ambient, steps, out });
  return fromFn(p.w, p.h, (x, y, i) => (m.inside[i] ? out.subarray(i * 4, i * 4 + 3) : null));
}
const bgd = (img) => onChecker(img);

// ================================================================ 1. step-by-step pipeline (barrel)
{
  const p = make('barrel'), m = maps(p), { w, h } = p, P = m.params;
  const inside = (i) => m.inside[i];
  save('step1-input.png', bgd(albedo(p, m)), 8);
  // mask + 1px transparent padding ring (red)
  const mask = fromFn(w + 2, h + 2, (x, y) => {
    if (x === 0 || y === 0 || x === w + 1 || y === h + 1) return hex('#ff5d73');
    return m.inside[(y - 1) * w + (x - 1)] ? hex('#f4efe6') : hex('#2a2545');
  });
  save('step2-mask.png', mask, 8);
  let dmax = 0; for (const v of m.dist) dmax = Math.max(dmax, v);
  save('step3-distance.png', bgd(fromFn(w, h, (x, y, i) => (inside(i) ? magma(m.dist[i] / dmax) : null))), 8);
  save('step4-ratio.png', bgd(fromFn(w, h, (x, y, i) => (inside(i) ? magma(m.ratio[i]) : null))), 8);
  const bevelH = (i) => P.top * Math.sqrt(1 - (1 - m.ratio[i]) ** 2);
  save('step5-bevel.png', bgd(fromFn(w, h, (x, y, i) => (inside(i) ? plasma(bevelH(i) / P.top) : null))), 8);
  let dm = 1e-6; for (let i = 0; i < w * h; i++) if (inside(i)) dm = Math.max(dm, Math.abs(m.rawHeight[i] - bevelH(i)));
  save('step6-detail.png', bgd(fromFn(w, h, (x, y, i) => (inside(i) ? diverging((m.rawHeight[i] - bevelH(i)) / dm) : null))), 8);
  let hm = 1e-6; for (const v of m.rawHeight) hm = Math.max(hm, v);
  save('step7-height-raw.png', fromFn(w, h, (x, y, i) => plasma(m.rawHeight[i] / hm)), 8);
  save('step8-height-blur.png', fromFn(w, h, (x, y, i) => plasma(m.height[i] / hm)), 8);
  let gm = 1e-6; for (let i = 0; i < w * h; i++) gm = Math.max(gm, Math.abs(m.gx[i]), Math.abs(m.gy[i]));
  save('step9-gx.png', fromFn(w, h, (x, y, i) => diverging(m.gx[i] / gm)), 8);
  save('step10-gy.png', fromFn(w, h, (x, y, i) => diverging(m.gy[i] / gm)), 8);
  save('step11-normal.png', normalImg(m), 8);
  save('step12-lit.png', bgd(litImg(p, m)), 8);
  save('step12-clay.png', bgd(litImg(p, m, { clay: true })), 8);

  // cross-section chart through the middle row
  const row = 15, C = 18, S = 13, padT = 14, base = padT + Math.ceil(hm * S) + 6;
  const chart = new Img(w * C + 16, base + 8 + C, hex('#15122a'));
  for (let v = 0; v <= hm; v += 2) for (let x = 8; x < chart.w - 8; x += 2) chart.set(x, base - Math.round(v * S), hex('#2c2650'));
  for (let x = 0; x < w; x++) {
    const i = row * w + x;
    if (m.inside[i]) chart.rect(8 + x * C + 3, base - Math.round(Math.max(0, bevelH(i)) * S), C - 6, Math.round(Math.max(0, bevelH(i)) * S), hex('#3d3470'));
    const r = m.rawHeight[i];
    if (m.inside[i]) chart.rect(8 + x * C + 3, base - Math.round(r * S) - 1, C - 6, 3, hex('#8f7bff'));
    // albedo strip
    if (p.data[i * 4 + 3]) chart.rect(8 + x * C, base + 6, C, C, [p.data[i * 4], p.data[i * 4 + 1], p.data[i * 4 + 2]]);
  }
  let prev = null;
  for (let sx = 0; sx <= (w - 1) * C; sx++) { // blurred height as a smooth line
    const fx = sx / C, x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), t = fx - x0;
    const v = m.height[row * w + x0] * (1 - t) + m.height[row * w + x1] * t;
    const py = base - Math.round(v * S);
    for (let k = -1; k <= 1; k++) chart.set(8 + C / 2 + sx, py + k, hex('#ffb86b'));
    if (prev !== null) for (let yy = Math.min(prev, py); yy <= Math.max(prev, py); yy++) chart.set(8 + C / 2 + sx, yy, hex('#ffb86b'));
    prev = py;
  }
  chart.rect(8, base, w * C, 1, hex('#6a6090'));
  save('chart-cross-section.png', chart, 2);
}

// ================================================================ 2. lighting falloff chart
{
  const D = 80, X = 8, H = 190, padL = 10, base = H + 10;
  const c = new Img(D * X + padL * 2, base + 14, hex('#15122a'));
  for (let k = 1; k <= 6; k++) for (let x = padL; x < c.w - padL; x += 2) c.set(x, base - Math.round((k / 6) * H), hex('#2c2650'));
  for (let d = 0; d < D; d++) {
    const v = lightAmount(0, 0, 1, 0, 0, { ...LIGHT_DEFAULTS, x: d + 0.5, y: 0 }, 6);
    c.rect(padL + d * X + 1, base - Math.round(v * H), X - 2, Math.round(v * H), d < 70 ? hex('#5a3f9e') : hex('#2a2545'));
  }
  for (let sx = 0; sx < D * X; sx++) {
    const v = lightAmount(0, 0, 1, 0, 0, { ...LIGHT_DEFAULTS, x: sx / X, y: 0 }, 0);
    for (let k = -1; k <= 1; k++) c.set(padL + sx, base - Math.round(v * H) + k, hex('#ffb86b'));
  }
  for (const d of [10, 35, 70]) for (let y = 4; y < base; y += 3) c.set(padL + d * X, y, hex('#6ee7b7'));
  c.rect(padL, base, D * X, 2, hex('#6a6090'));
  save('chart-falloff.png', c, 1);
}

// ================================================================ 3. parameter sweeps
function sweep(name, id, list, key, extra = {}, litOpts = {}) {
  const p = make(id), lo = { lx: -0.25, ly: 0, z: 20, ...litOpts };
  const ms = list.map((v) => maps(p, { ...(DEF[id].params || {}), ...extra, [key]: v }));
  save(name, grid([ms.map((m) => normalImg(m)), ms.map((m) => bgd(litImg(p, m, { ...lo, clay: true }))), ms.map((m) => bgd(litImg(p, m, lo)))]), 5);
}
sweep('sweep-bevel.png', 'slime', [1, 3, 6, 10, 16], 'bevel', { top: 13 });
sweep('sweep-top.png', 'slime', [3, 8, 13, 24], 'top', { bevel: 6 });
sweep('sweep-detail.png', 'chest', [0, 1.5, 4, 8], 'detail', {}, { lx: -0.4, ly: -0.1 });
sweep('sweep-sigma.png', 'barrel', [0, 0.7, 1.5, 2.5], 'sigma');

// light steps & light height
{
  const p = make('slime'), m = maps(p, DEF.slime.params);
  save('sweep-steps.png', grid([[0, 2, 4, 6, 12].map((s) => bgd(litImg(p, m, { steps: s, lx: -0.3, ly: 0 })))]), 5);
  const b = make('barrel'), mb = maps(b);
  save('sweep-light-z.png', grid([[6, 14, 26, 60].map((z) => bgd(litImg(b, mb, { z, lx: -0.6, ly: 0.3 })))]), 5);
}

// ================================================================ 4. pitfalls
{
  // canvas edge: crate drawn edge-to-edge with cushion params, with and without the 1px padding
  const p = make('crate');
  const on = maps(p, { bevel: 5, top: 12 }), off = maps(p, { bevel: 5, top: 12, pad: false });
  const lp = { lx: -0.3, ly: -0.3, z: 18 };
  save('pitfall-padding.png', grid([[normalImg(off), normalImg(on)], [bgd(litImg(p, off, { ...lp, clay: true })), bgd(litImg(p, on, { ...lp, clay: true }))], [bgd(litImg(p, off, lp)), bgd(litImg(p, on, lp))]]), 5);
  // boxy: cushion vs boxy rule
  const cushion = maps(p, { bevel: 5, top: 12 }), boxy = maps(p, { bevel: 1.5, top: 3.6 });
  const lb = { lx: -0.4, ly: -0.2 };
  save('pitfall-boxy.png', grid([[normalImg(cushion), normalImg(boxy)], [bgd(litImg(p, cushion, { ...lb, clay: true })), bgd(litImg(p, boxy, { ...lb, clay: true }))], [bgd(litImg(p, cushion, lb)), bgd(litImg(p, boxy, lb))]]), 5);
  // flipped green
  const b = make('barrel'), mb = maps(b);
  save('pitfall-flip-green.png', grid([[normalImg(mb), normalImg(mb, true)], [bgd(litImg(b, mb, { lx: 0.5, ly: -0.6 })), bgd(litImg(b, mb, { lx: 0.5, ly: -0.6, flipY: true }))]]), 5);
}

// ================================================================ 5. floor tile
{
  const T = 64, fp = makeFloorTile(T), fm = floorMaps(fp.data, T, T), W = T * 3;
  const tile = fromFn(T, T, (x, y, i) => fp.data.subarray(i * 4, i * 4 + 3));
  save('floor1-tile.png', tile, 4);
  const tiled = fromFn(W, W, (x, y) => { const i = ((y % T) * T + (x % T)) * 4; return fp.data.subarray(i, i + 3); });
  const tRGBA = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { tRGBA.set(tiled.d.subarray(i * 4, i * 4 + 3), i * 4); tRGBA[i * 4 + 3] = 255; }
  const gray = luminance(tRGBA, W, W).map((v) => v * 255);
  const blurred = gaussianBlur(gray, W, W, FLOOR_DEFAULTS.maskSigma);
  const thr = percentile(gray, FLOOR_DEFAULTS.gapPercentile);
  const mark = (img) => { img.frame(T - 1, T - 1, T + 2, T + 2, hex('#ffb86b')); return img; };
  save('floor2-tiled.png', mark(tiled), 2);
  save('floor3-mask.png', mark(fromFn(W, W, (x, y, i) => (blurred[i] > thr ? hex('#f4efe6') : hex('#2a2545')))), 2);
  let hm = 1e-6; for (const v of fm.height) hm = Math.max(hm, v);
  save('floor4-height.png', fromFn(T, T, (x, y, i) => plasma(fm.height[i] / hm)), 4);
  save('floor5-normal.png', normalImg(fm), 4);
  // 2x2 repeat, lit by a light in the middle: no seams
  const R = T * 2, al = new Float32Array(R * R * 3), nn = new Float32Array(R * R * 3), out = new Uint8ClampedArray(R * R * 4);
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const i = y * R + x, f = (y % T) * T + (x % T);
    for (let c = 0; c < 3; c++) al[i * 3 + c] = fp.data[f * 4 + c] / 255;
    nn[i * 3] = fm.normal[f * 3]; nn[i * 3 + 1] = -fm.normal[f * 3 + 1]; nn[i * 3 + 2] = fm.normal[f * 3 + 2];
  }
  renderLit({ w: R, h: R, albedo: al, normal: nn, lights: [{ ...LIGHT_DEFAULTS, x: T, y: T, radius: 90 }], ambient: LIGHT_DEFAULTS.ambient, steps: 6, out });
  save('floor6-lit.png', fromFn(R, R, (x, y, i) => out.subarray(i * 4, i * 4 + 3)), 3);
}

// ================================================================ 6. per-frame animation maps
for (const id of ['slime', 'brazier']) {
  const fr = [0, 1, 2, 3].map((f) => { const p = make(id, f); return [p, maps(p, DEF[id].params)]; });
  save(`anim-${id}-frames.png`, grid([fr.map(([p, m]) => bgd(albedo(p, m))), fr.map(([, m]) => normalImg(m))]), 5);
}

// ================================================================ 7. full scene (static + animated)
const SW = 224, SH = 140, FT = 64;
const floorP = makeFloorTile(FT), floorM = floorMaps(floorP.data, FT, FT);
const ents = SPRITES.map((d) => {
  const frames = Array.from({ length: d.frames || 1 }, (_, f) => d.make(f));
  return { d, frames, maps: frames.map((p) => maps(p, d.params)), x: d.pos[0], y: d.pos[1], w: frames[0].w, h: frames[0].h };
}).sort((a, b) => a.y + a.h - (b.y + b.h));

function scene({ t = 0, light = null, flat = false, view = 'lit' }) {
  const N = SW * SH, al = new Float32Array(N * 3), nn = new Float32Array(N * 3), em = new Uint8Array(N), nr = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x, f = (y % FT) * FT + (x % FT);
    for (let c = 0; c < 3; c++) al[i * 3 + c] = floorP.data[f * 4 + c] / 255;
    nn[i * 3] = floorM.normal[f * 3]; nn[i * 3 + 1] = -floorM.normal[f * 3 + 1]; nn[i * 3 + 2] = floorM.normal[f * 3 + 2];
    nr.set(floorM.normalRGBA.subarray(f * 4, f * 4 + 4), i * 4);
  }
  for (const e of ents) {
    const cx = e.x + e.w / 2, cy = e.y + e.h - 2, rx = e.w * 0.46;
    for (let y = Math.floor(cy - 3.2); y <= cy + 3.2; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const q = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / 3.2) ** 2;
      if (q <= 1) for (let c = 0; c < 3; c++) al[(y * SW + x) * 3 + c] *= q < 0.45 ? 0.5 : 0.7;
    }
  }
  const lights = [];
  const fi = Math.floor(t * 6.67);
  for (const e of ents) {
    const k = fi % e.frames.length, p = e.frames[k], m = e.maps[k];
    for (let sy = 0; sy < p.h; sy++) for (let sx = 0; sx < p.w; sx++) {
      const si = sy * p.w + sx; if (!m.inside[si]) continue;
      const i = (e.y + sy) * SW + e.x + sx;
      for (let c = 0; c < 3; c++) al[i * 3 + c] = p.data[si * 4 + c] / 255;
      nn[i * 3] = m.normal[si * 3]; nn[i * 3 + 1] = -m.normal[si * 3 + 1]; nn[i * 3 + 2] = m.normal[si * 3 + 2];
      nr.set(m.normalRGBA.subarray(si * 4, si * 4 + 4), i * 4);
      em[i] = p.em[si];
    }
    if (e.d.light) {
      const fl = e.d.light.flicker ? 0.86 + 0.09 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 31.7 + 1.3) : 1;
      lights.push({ ...e.d.light, x: e.x + e.d.light.dx, y: e.y + e.d.light.dy, energy: e.d.light.energy * fl });
    }
  }
  const L = light || { x: SW / 2 + Math.cos(t * 0.9) * SW * 0.36, y: SH / 2 + Math.sin(t * 1.4) * SH * 0.3 };
  lights.unshift({ ...LIGHT_DEFAULTS, x: L.x, y: L.y });
  const img = new Img(SW, SH);
  if (view === 'normal') { img.d.set(nr); return img; }
  if (view === 'albedo') { for (let i = 0; i < N; i++) img.d.set([al[i * 3] * 255, al[i * 3 + 1] * 255, al[i * 3 + 2] * 255, 255], i * 4); return img; }
  if (flat) for (let i = 0; i < N; i++) { nn[i * 3] = 0; nn[i * 3 + 1] = 0; nn[i * 3 + 2] = 1; }
  renderLit({ w: SW, h: SH, albedo: al, normal: nn, emissive: em, lights, ambient: LIGHT_DEFAULTS.ambient, steps: 6, out: img.d });
  // light gizmo
  for (const [dx, dy, a] of [[0, 0, 1], [1, 0, 0.5], [-1, 0, 0.5], [0, 1, 0.5], [0, -1, 0.5]]) {
    const x = Math.floor(L.x) + dx, y = Math.floor(L.y) + dy, o = (y * SW + x) * 4;
    if (x >= 0 && y >= 0 && x < SW && y < SH) { img.d[o] += (255 - img.d[o]) * a; img.d[o + 1] += (245 - img.d[o + 1]) * a; img.d[o + 2] += (210 - img.d[o + 2]) * a; }
  }
  return img;
}
const still = { x: 100, y: 64 };
save('scene-lit.png', scene({ t: 0.3, light: still }), 3);
save('scene-flat.png', scene({ t: 0.3, light: still, flat: true }), 3);
save('scene-albedo.png', scene({ t: 0.3, view: 'albedo' }), 3);
save('scene-normal.png', scene({ t: 0.3, view: 'normal' }), 3);
{
  const F = 60, frames = [];
  for (let k = 0; k < F; k++) {
    const a = (k / F) * Math.PI * 2;
    frames.push(scene({ t: k * 0.07, light: { x: SW / 2 + Math.cos(a) * SW * 0.36, y: SH / 2 + Math.sin(a * 2) * SH * 0.28 } }));
  }
  saveAnim('hero.png', frames, 3, 70);
}

// ================================================================ 8. sprite turntable (light orbiting every sprite)
{
  const items = SPRITES.map((d) => { const p = d.make(0); return [p, maps(p, d.params)]; });
  const F = 36, frames = [];
  for (let k = 0; k < F; k++) {
    const a = (k / F) * Math.PI * 2;
    const lo = { lx: 0.5 + Math.cos(a) * 0.9, ly: 0.5 + Math.sin(a) * 0.75, z: 22 };
    frames.push(grid([items.map(([p, m]) => bgd(litImg(p, m, { ...lo, clay: true }))), items.map(([p, m]) => bgd(litImg(p, m, lo)))], 4));
  }
  saveAnim('turntable.png', frames, 4, 80);
  save('sprites-sheet.png', grid([
    items.map(([p, m]) => bgd(albedo(p, m))),
    items.map(([, m]) => normalImg(m)),
    items.map(([p, m]) => bgd(litImg(p, m, { lx: -0.6, ly: 0.2, clay: true }))),
    items.map(([p, m]) => bgd(litImg(p, m, { lx: -0.6, ly: 0.2 }))),
    items.map(([p, m]) => bgd(litImg(p, m, { lx: 1.6, ly: 0.2 }))),
  ], 4), 4);
}

for (const [n, b] of written) console.log(`${(b / 1024).toFixed(0).padStart(6)} KB  docs/img/${n}`);
