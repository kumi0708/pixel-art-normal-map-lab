// Renders the README images with the same modules the web app uses: node tools/render-docs.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { computeMaps, floorMaps } from '../js/normalmap.js';
import { renderLit, LIGHT_DEFAULTS } from '../js/lighting.js';
import { SPRITES, makeFloorTile } from '../js/sprites.js';

const out = new URL('../docs/', import.meta.url);
mkdirSync(out, { recursive: true });

function png(w, h, rgba) {
  const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function upscale(src, w, h, s) {
  const d = new Uint8ClampedArray(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) {
    const i = ((y / s | 0) * w + (x / s | 0)) * 4, o = (y * w * s + x) * 4;
    d[o] = src[i]; d[o + 1] = src[i + 1]; d[o + 2] = src[i + 2]; d[o + 3] = src[i + 3];
  }
  return d;
}

// ---------- lit scene
const SW = 224, SH = 140, FT = 64;
const fp = makeFloorTile(FT), fm = floorMaps(fp.data, FT, FT);
const al = new Float32Array(SW * SH * 3), nn = new Float32Array(SW * SH * 3), em = new Uint8Array(SW * SH);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const i = y * SW + x, f = (y % FT) * FT + (x % FT);
  for (let c = 0; c < 3; c++) al[i * 3 + c] = fp.data[f * 4 + c] / 255;
  nn[i * 3] = fm.normal[f * 3]; nn[i * 3 + 1] = -fm.normal[f * 3 + 1]; nn[i * 3 + 2] = fm.normal[f * 3 + 2];
}
const lights = [{ x: 98, y: 66, ...LIGHT_DEFAULTS }];
const ents = SPRITES.map((d) => ({ d, p: d.make(1) })).sort((a, b) => a.d.pos[1] + a.p.h - (b.d.pos[1] + b.p.h));
for (const { d, p } of ents) {
  const m = computeMaps(p.data, p.w, p.h, d.params);
  const [ex, ey] = d.pos;
  const cx = ex + p.w / 2, cy = ey + p.h - 2, rx = p.w * 0.46;
  for (let y = Math.floor(cy - 3.2); y <= cy + 3.2; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const q = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / 3.2) ** 2;
    if (q <= 1) for (let c = 0; c < 3; c++) al[(y * SW + x) * 3 + c] *= q < 0.45 ? 0.5 : 0.7;
  }
  for (let sy = 0; sy < p.h; sy++) for (let sx = 0; sx < p.w; sx++) {
    const si = sy * p.w + sx; if (!m.inside[si]) continue;
    const i = (ey + sy) * SW + ex + sx;
    for (let c = 0; c < 3; c++) al[i * 3 + c] = p.data[si * 4 + c] / 255;
    nn[i * 3] = m.normal[si * 3]; nn[i * 3 + 1] = -m.normal[si * 3 + 1]; nn[i * 3 + 2] = m.normal[si * 3 + 2];
    em[i] = p.em[si];
  }
  if (d.light) lights.push({ x: ex + d.light.dx, y: ey + d.light.dy, ...d.light });
}
const lit = new Uint8ClampedArray(SW * SH * 4);
renderLit({ w: SW, h: SH, albedo: al, normal: nn, emissive: em, lights, ambient: LIGHT_DEFAULTS.ambient, steps: 6, out: lit });
writeFileSync(new URL('scene.png', out), png(SW * 4, SH * 4, upscale(lit, SW, SH, 4)));

// ---------- sprite sheet: albedo / normal / lit-from-left / lit-from-right
const pad = 4, rowH = 36;
const W = SPRITES.reduce((a, d) => a + d.make(0).w + pad, pad), H = rowH * 4 + pad * 5;
const sheet = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) sheet.set([24, 21, 38, 255], i * 4);
let ox = pad;
for (const d of SPRITES) {
  const p = d.make(0), m = computeMaps(p.data, p.w, p.h, d.params), n = p.w * p.h;
  const a = new Float32Array(n * 3), sn = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) a[i * 3 + c] = p.data[i * 4 + c] / 255;
    sn[i * 3] = m.normal[i * 3]; sn[i * 3 + 1] = -m.normal[i * 3 + 1]; sn[i * 3 + 2] = m.normal[i * 3 + 2];
  }
  const rows = [p.data, m.normalRGBA];
  for (const lx of [-0.6, 1.6]) {
    const o = new Uint8ClampedArray(n * 4);
    renderLit({ w: p.w, h: p.h, albedo: a, normal: sn, emissive: p.em, lights: [{ ...LIGHT_DEFAULTS, x: p.w * lx, y: p.h * 0.2 }], ambient: LIGHT_DEFAULTS.ambient, steps: 6, out: o });
    rows.push(o);
  }
  rows.forEach((src, r) => {
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x;
      if (r !== 1 && !m.inside[i]) continue;
      sheet.set(src.subarray(i * 4, i * 4 + 3), (((pad + r * (rowH + pad)) + y) * W + ox + x) * 4);
    }
  });
  ox += p.w + pad;
}
writeFileSync(new URL('sprites.png', out), png(W * 4, H * 4, upscale(sheet, W, H, 4)));
console.log('wrote docs/scene.png, docs/sprites.png');
