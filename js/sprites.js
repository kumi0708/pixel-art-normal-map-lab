// Procedural pixel-art sprites (all drawn in code: palette ramps + ordered dithering + selective outline).

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const ramp_ = (a) => a.map(hex);

export const PAL = {
  wood: ramp_(['#26130f', '#47231a', '#6b3a24', '#93552f', '#b9773f', '#dca163']),
  iron: ramp_(['#17161f', '#2d2e42', '#4b5069', '#7a84a0', '#b7c0d6', '#e8eef8']),
  gold: ramp_(['#3f210b', '#7b4a12', '#b9801c', '#e5b73a', '#fbe57a', '#fffbd2']),
  slime: ramp_(['#0b2f35', '#0f5257', '#17806f', '#2fb383', '#7de2a0', '#d4ffd2']),
  red: ramp_(['#33091a', '#661225', '#a01f30', '#d33f3a', '#f07655', '#ffb48a']),
  cream: ramp_(['#4c3829', '#7d6149', '#b3946f', '#dcc39a', '#f6e8c8', '#fffaf0']),
  amethyst: ramp_(['#1b0d36', '#36196e', '#5b2fae', '#8c58e2', '#bf98ff', '#efe0ff']),
  aqua: ramp_(['#08243a', '#0f4670', '#1979aa', '#35b2dc', '#8ae6fa', '#e4fdff']),
  stone: ramp_(['#15151d', '#262633', '#3c3e52', '#575b73', '#7c8299', '#a9afc3']),
  moss: ramp_(['#1a2a17', '#2d4524', '#476a2f', '#6f913c']),
  glass: ramp_(['#22304e', '#3d5a80', '#6f94b4', '#b2d3e4', '#effaff']),
  potion: ramp_(['#33092f', '#64125a', '#a42382', '#de4fb0', '#ff94d6', '#ffe0f2']),
  flame: ramp_(['#5e1010', '#b3300e', '#e86a14', '#ffaa22', '#ffe066', '#fffbe0']),
};
const INK = hex('#120a1a');
const WHITE = hex('#fffdf6');

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

export function hash(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** pick a colour from a ramp with 4x4 ordered dithering */
export function ramp(r, t, x, y, dither = 0.9) {
  const f = t * (r.length - 1) + BAYER[(y & 3) * 4 + (x & 3)] * dither;
  return r[Math.max(0, Math.min(r.length - 1, Math.round(f)))];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Pix {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.em = new Uint8Array(w * h);
  }
  set(x, y, c, em = 0) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const i = y * this.w + x;
    this.data[i * 4] = c[0]; this.data[i * 4 + 1] = c[1]; this.data[i * 4 + 2] = c[2]; this.data[i * 4 + 3] = 255;
    this.em[i] = em;
  }
  has(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[(y * this.w + x) * 4 + 3] > 0;
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  /** fill every pixel whose centre passes test(px,py) with color(x,y) */
  shape(test, color, em = 0) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (test(x + 0.5, y + 0.5)) this.set(x, y, color(x, y), em);
      }
    }
  }
  /** selective outline: darkened version of the neighbouring colour */
  outline(k = 0.74) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.has(x, y)) continue;
        const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dx, dy]) => this.has(x + dx, y + dy));
        if (!nb.length) continue;
        let c = [0, 0, 0];
        for (const [dx, dy] of nb) { const q = this.get(x + dx, y + dy); c = [c[0] + q[0], c[1] + q[1], c[2] + q[2]]; }
        c = c.map((v) => v / nb.length);
        add.push([x, y, mix(c, INK, k)]);
      }
    }
    for (const [x, y, c] of add) this.set(x, y, c);
  }
}

function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function line(p, x0, y0, x1, y1, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    p.set(x, y, color(x, y, t));
  }
}

// ---------------------------------------------------------------- sprites

function barrel() {
  const w = 22, h = 28, p = new Pix(w, h), cx = 11, top = 4, bot = 26.5;
  const W = PAL.wood, I = PAL.iron, G = PAL.gold;
  const hwAt = (py) => 7.4 + 2.3 * Math.sin(Math.PI * clamp((py - top) / (bot - top), 0, 1));
  p.shape((px, py) => py >= top && py <= bot && Math.abs(px - cx) <= hwAt(py), (x, y) => {
    const px = x + 0.5, py = y + 0.5, v = (py - top) / (bot - top), hw = hwAt(py), u = (px - cx) / hw;
    const shade = 0.6 - 0.34 * u * u - 0.12 * u;
    const bandA = v > 0.12 && v < 0.24, bandB = v > 0.76 && v < 0.88;
    if (bandA || bandB) {
      const bv = bandA ? (v - 0.12) / 0.12 : (v - 0.76) / 0.12;
      if (bv > 0.3 && bv < 0.75 && (Math.abs(Math.abs(u) - 0.55) < 0.08 || Math.abs(u) < 0.06)) return G[4];
      return ramp(I, shade + (bv < 0.3 ? 0.22 : 0) - (bv > 0.75 ? 0.15 : 0), x, y);
    }
    const a = (Math.asin(clamp(u, -1, 1)) / (Math.PI / 2) + 1) * 3.5, s = Math.floor(a), fr = a - s;
    let t = shade + (hash(s, 0, 3) - 0.5) * 0.14;
    if (fr < 0.17 && s > 0) t -= 0.34;
    if (hash(x, y, 7) < 0.09) t -= 0.14;
    if (hash(x, Math.floor(y / 3), 11) < 0.05) t += 0.12;
    return ramp(W, t, x, y);
  });
  // lid
  p.shape((px, py) => ((px - cx) / 8.4) ** 2 + ((py - top) / 2.9) ** 2 <= 1, (x, y) => {
    const dx = (x + 0.5 - cx) / 8.4, dy = (y + 0.5 - top) / 2.9, rr = Math.hypot(dx, dy);
    if (rr > 0.78) return ramp(W, 0.86 - 0.22 * dx - (dy > 0 ? 0.25 : 0), x, y, 0.5);
    let t = 0.36 + (hash(Math.floor((x + 0.5) / 3), 0, 9) - 0.5) * 0.12;
    if (Math.floor(x + 0.5) % 3 === 0) t -= 0.12;
    return ramp(W, t, x, y);
  });
  p.set(cx - 3, top, PAL.iron[2]); p.set(cx - 3, top - 1, PAL.iron[4]); // bung
  p.outline();
  return p;
}

function slime(f = 0) {
  const w = 30, h = 26, p = new Pix(w, h), S = PAL.slime;
  const sq = [0, 0.06, 0.11, 0.05][f % 4];
  const cx = 15, base = 23.5, rx = 11.6 * (1 + sq * 0.8), ry = 19 * (1 - sq), cy = base - ry * 0.45;
  const shapeT = (px, py) => {
    const dx = (px - cx) / rx;
    if (py <= cy) { const dy = (py - cy) / (cy - (base - ry)); return dx * dx + dy * dy <= 1; }
    const dy = (py - cy) / (base - cy);
    return dx * dx + dy ** 4 <= 1 && py <= base;
  };
  p.shape(shapeT, (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = (px - cx) / rx, dyn = (py - cy) / ry;
    let t = 0.52 - 0.32 * dyn - 0.1 * dx;
    const e = dx * dx + (dyn * 1.4) ** 2;
    t -= 0.18 * e ** 2;
    if (py > base - 1.5) t -= 0.12;
    return ramp(S, t, x, y);
  });
  const hx = cx - rx * 0.48, hy = cy - ry * 0.32;
  p.shape((px, py) => ((px - hx) / 2.6) ** 2 + ((py - hy) / 1.6) ** 2 <= 1, () => S[5]);
  p.set(hx + 3, hy + 1, S[4]); p.set(hx - 2, hy + 3, S[4]);
  // bubbles
  for (const [bx, by, br] of [[cx + 6, cy + 4, 1.7], [cx - 7, cy + 6, 1.1], [cx + 2, cy + 7, 0.8]]) {
    p.shape((px, py) => Math.hypot(px - bx, py - by) <= br, (x, y) => ramp(S, Math.hypot(x + 0.5 - bx, y + 0.5 - by) > br - 0.8 ? 0.85 : 0.6, x, y, 0));
  }
  // face
  const ey = Math.round(cy + 1 + sq * 4);
  for (const ex of [cx - 4.5, cx + 3.5]) {
    p.shape((px, py) => ((px - ex - 0.5) / 1.8) ** 2 + ((py - ey) / 2.5) ** 2 <= 1, () => hex('#f2fff0'));
    p.set(ex + 1, ey, hex('#0b1416')); p.set(ex + 1, ey + 1, hex('#0b1416')); p.set(ex, ey + 1, hex('#0b1416'));
    p.set(ex, ey, hex('#24343a'));
    p.set(ex + 1, ey - 1, WHITE);
  }
  p.set(cx - 7, ey + 3, hex('#ff8fa4')); p.set(cx - 8, ey + 3, hex('#e36d8c'));
  p.set(cx + 6, ey + 3, hex('#ff8fa4')); p.set(cx + 7, ey + 3, hex('#e36d8c'));
  for (const [mx, my] of [[cx - 2, ey + 3], [cx - 1, ey + 4], [cx, ey + 4], [cx + 1, ey + 3]]) p.set(mx, my, hex('#0c2a2c'));
  p.outline(0.7);
  return p;
}

function crate() {
  const w = 24, h = 24, p = new Pix(w, h), W = PAL.wood;
  p.shape((px, py) => px > 1 && px < 23 && py > 1 && py < 23, (x, y) => {
    const lx = x - 1, ly = y - 1; // 0..21
    const frame = lx < 3 || lx > 18 || ly < 3 || ly > 18;
    if (frame) {
      if ((lx === 1 || lx === 20) && (ly === 1 || ly === 20)) return PAL.iron[4];
      let t = 0.7 + (hash(lx < 3 || lx > 18 ? lx : 0, ly < 3 || ly > 18 ? ly : 0, 2) - 0.5) * 0.06;
      if (lx === 0 || ly === 0) t += 0.14;
      if (lx === 2 || ly === 2 || lx === 19 || ly === 19) t -= 0.32;
      if (lx === 21 || ly === 21) t -= 0.15;
      if (hash(x, y, 5) < 0.07) t -= 0.12;
      return ramp(W, t, x, y);
    }
    const dd = Math.abs(lx + ly - 21);
    if (dd < 2.2) {
      let t = 0.66 - (lx + ly - 21 > 0 ? 0.08 : 0);
      if (dd > 1.4) t -= 0.3;
      return ramp(W, t, x, y);
    }
    let t = 0.4 + (hash(Math.floor((ly - 3) / 4), 0, 5) - 0.5) * 0.14;
    if ((ly - 3) % 4 === 3) t -= 0.26;
    if (hash(x, y, 8) < 0.08) t -= 0.12;
    return ramp(W, t, x, y);
  });
  p.outline();
  return p;
}

function potion() {
  const w = 18, h = 26, p = new Pix(w, h), cx = 9, bcy = 17.5, br = 7.3, level = 14;
  const body = (px, py) => Math.hypot(px - cx, py - bcy) <= br;
  p.shape((px, py) => body(px, py) || (py > 4 && py < 12 && Math.abs(px - cx) <= 2.6), (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = (px - cx) / br, dy = (py - bcy) / br;
    if (y >= level && body(px, py)) {
      let t = 0.58 - 0.25 * dx - 0.15 * dy;
      if (y === level) t = 0.92;
      return ramp(PAL.potion, t, x, y, 0.45);
    }
    return ramp(PAL.glass, 0.45 - 0.25 * dx + (y < 12 ? 0.1 : 0), x, y);
  });
  p.shape((px, py) => py > 3 && py < 5 && Math.abs(px - cx) <= 3.6, (x, y) => ramp(PAL.glass, 0.7 - 0.1 * (x - cx), x, y, 0)); // lip
  p.shape((px, py) => py > 0.5 && py < 3.5 && Math.abs(px - cx) <= 2.2, (x, y) => ramp(PAL.wood, y === 1 ? 0.95 : 0.7 - 0.12 * (x - cx), x, y, 0)); // cork
  for (const [gx, gy] of [[4, 15], [4, 16], [4, 17], [5, 13], [7, 6], [7, 7], [7, 8]]) p.set(gx, gy, PAL.glass[4]);
  for (const [bx, by] of [[11, 19], [12, 17], [10, 21], [8, 18]]) p.set(bx, by, PAL.potion[4]);
  p.set(12, 16, PAL.potion[5]);
  p.outline();
  return p;
}

function crystal() {
  const w = 30, h = 32, p = new Pix(w, h);
  // rock base
  p.shape((px, py) => ((px - 15) / 13) ** 2 + ((py - 27.5) / 3.6) ** 2 <= 1, (x, y) => {
    const dx = (x + 0.5 - 15) / 13, dy = (y + 0.5 - 27.5) / 3.6;
    let t = 0.5 - 0.3 * dy - 0.12 * dx + (hash(x >> 1, y, 4) - 0.5) * 0.3;
    return ramp(PAL.stone, t, x, y);
  });
  const prisms = [
    [21.5, 27, 3.2, 11, 3.5, PAL.amethyst],
    [8.5, 27, 3, 9, -3.6, PAL.aqua],
    [15, 27.5, 4.3, 15.5, 0.4, PAL.amethyst],
    [10.5, 28.5, 2.2, 4.5, -1.6, PAL.aqua],
    [20, 28.8, 2, 4.5, 1.8, PAL.amethyst],
  ];
  for (const [cx, by, hw, hg, tilt, R] of prisms) {
    const pts = [[cx - hw, by], [cx + hw, by], [cx + hw + tilt, by - hg], [cx + tilt, by - hg - hw * 1.5], [cx - hw + tilt, by - hg]];
    p.shape((px, py) => inPoly(px, py, pts), (x, y) => {
      const px = x + 0.5, py = y + 0.5, k = clamp((by - py) / hg, 0, 1.4);
      const c = cx + tilt * Math.min(k, 1), q = (px - c) / hw;
      let t = q < 0 ? 0.74 + 0.08 * k : 0.42 + 0.08 * k;
      if (Math.abs(q) < 0.2) t = 0.95;
      if (k > 1) t += 0.08;
      if (Math.abs(q) > 0.78) t -= 0.18;
      if (hash(x, y, 13) < 0.035) t = 1;
      return ramp(R, t, x, y, 0.6);
    });
  }
  p.outline(0.7);
  return p;
}

function chest() {
  const w = 30, h = 24, p = new Pix(w, h), W = PAL.wood, G = PAL.gold;
  const inside = (px, py) => {
    if (px < 2 || px > 28 || py < 2.5 || py > 22) return false;
    if (py < 6) {
      const cxs = px < 6 ? 6 : px > 24 ? 24 : null;
      if (cxs !== null) return Math.hypot(px - cxs, py - 6) <= 3.5;
    }
    return true;
  };
  p.shape(inside, (x, y) => {
    const strap = (x >= 4 && x <= 5) || (x >= 24 && x <= 25);
    if (y === 10) return W[0];
    if (y === 11 || y === 21) return ramp(G, y === 11 ? 0.72 : 0.45, x, y, 0);
    if (x >= 13 && x <= 16 && y >= 7 && y <= 14) {
      if ((x === 14 || x === 15) && (y === 10 || y === 11)) return PAL.iron[0];
      if ((x === 14 || x === 15) && y === 12) return PAL.iron[1];
      const edge = x === 13 || x === 16 || y === 7 || y === 14;
      return ramp(G, edge ? 0.5 : 0.85 - (x - 13) * 0.06, x, y, 0);
    }
    if (strap) {
      if ((y === 7 || y === 14 || y === 18) && (x === 4 || x === 25)) return G[5];
      return ramp(G, (y < 10 ? 0.72 : 0.55) - (x === 5 || x === 25 ? 0.12 : 0), x, y, 0.4);
    }
    let t = y < 10 ? 0.62 + (y < 5 ? 0.14 : 0) : 0.45;
    if (y === 6 || y === 15 || y === 18) t -= 0.28;
    if (hash(x, y, 21) < 0.08) t -= 0.12;
    t -= (x - 15) * 0.006;
    return ramp(W, t, x, y);
  });
  p.outline();
  return p;
}

function mushroom() {
  const w = 24, h = 26, p = new Pix(w, h), cx = 12;
  // stem
  p.shape((px, py) => py > 11 && py < 24.5 && Math.abs(px - cx) <= 3 + (py > 20 ? (py - 20) * 0.55 : 0) + Math.sin(py * 0.6) * 0.3, (x, y) => {
    const px = x + 0.5, py = y + 0.5, u = (px - cx) / 3.5;
    let t = 0.72 - 0.3 * u * u - 0.16 * u;
    if (py < 15.5) t -= 0.3;
    return ramp(PAL.cream, t, x, y);
  });
  // cap
  const capT = (px, py) => {
    const dx = (px - cx) / 10.6, dy = (py - 11.5) / 9.5;
    return (py <= 11.5 && dx * dx + dy * dy <= 1) || (py > 11.5 && py < 13.5 && Math.abs(dx) <= 1 - (py - 11.5) * 0.12 && Math.abs(dx) > 0.55);
  };
  p.shape(capT, (x, y) => {
    const px = x + 0.5, py = y + 0.5, dx = (px - cx) / 10.6, dy = (py - 11.5) / 9.5;
    let t = 0.58 - 0.35 * dy - 0.14 * dx - 0.15 * dx * dx;
    if (py > 10.5) t -= 0.25;
    return ramp(PAL.red, t, x, y);
  });
  // gills
  p.shape((px, py) => py > 11.5 && py < 13.5 && Math.abs(px - cx) < 6, (x, y) => ramp(PAL.cream, (x % 2 ? 0.3 : 0.45) - (y - 12) * 0.12, x, y, 0));
  for (const [sx, sy, sr] of [[8, 5.5, 2.1], [15, 4.2, 1.5], [17.5, 9, 2.1], [5.5, 10, 1.3], [12.2, 8.6, 1.3]]) {
    p.shape((px, py) => Math.hypot(px - sx, (py - sy) * 1.15) <= sr && capT(px, py), (x, y) => ramp(PAL.cream, 0.95 - 0.25 * (x + 0.5 - sx) / sr - 0.2 * (y + 0.5 - sy) / sr, x, y, 0.4));
  }
  for (const [gx, gy] of [[6, 24], [7, 23], [6, 23], [17, 24], [18, 23], [18, 24], [16, 24], [9, 24]]) p.set(gx, gy, ramp(PAL.moss, 0.6 + hash(gx, gy) * 0.4, gx, gy, 0));
  p.outline();
  return p;
}

function brazier(f = 0) {
  const w = 22, h = 31, p = new Pix(w, h), cx = 11, I = PAL.iron;
  const leg = (x, y, t) => ramp(I, 0.5 - t * 0.2, x, y, 0);
  line(p, 6, 20, 3, 28, leg); line(p, 7, 20, 4, 28, leg);
  line(p, 16, 20, 19, 28, leg); line(p, 15, 20, 18, 28, leg);
  line(p, 11, 21, 11, 28, leg); line(p, 10, 21, 10, 28, leg);
  for (const fx of [2, 3, 4, 5, 9, 10, 11, 12, 17, 18, 19, 20]) p.set(fx, 29, I[1]);
  // bowl
  p.shape((px, py) => py >= 14 && ((px - cx) / 8.6) ** 2 + ((py - 14) / 7) ** 2 <= 1, (x, y) => {
    const u = (x + 0.5 - cx) / 8.6;
    if (y <= 15) return ramp(I, 0.85 - 0.25 * u, x, y, 0.3);
    if (y === 17) return ramp(PAL.gold, 0.6 - 0.25 * u, x, y, 0.4);
    return ramp(I, 0.5 - 0.3 * u * u - 0.12 * u, x, y);
  });
  // embers
  p.shape((px, py) => py > 12.5 && py < 14 && Math.abs(px - cx) <= 7.2, (x, y) => ramp(PAL.flame, hash(x, y + f, 31) * 0.6, x, y, 0), 1);
  // flame (animated)
  p.shape((px, py) => {
    if (py > 13 || py < 1) return false;
    const k = (13 - py) / 12;
    const hw = 6.4 * Math.pow(1 - k, 0.75) * (1 + 0.22 * Math.sin(k * 9 + f * 1.7));
    const xo = 1.6 * Math.sin(k * 5 + f * 1.3) * k;
    return Math.abs(px - cx - xo) <= hw && hw > 0.6;
  }, (x, y) => {
    const py = y + 0.5, k = (13 - py) / 12;
    const hw = 6.4 * Math.pow(1 - k, 0.75) * (1 + 0.22 * Math.sin(k * 9 + f * 1.7));
    const xo = 1.6 * Math.sin(k * 5 + f * 1.3) * k;
    const heat = 1.05 - (Math.abs(x + 0.5 - cx - xo) / hw) * 0.7 - k * 0.6;
    return ramp(PAL.flame, heat, x, y + f);
  }, 1);
  p.outline(0.7);
  // keep the flame outline emissive-ish (warm, unlit)
  for (let y = 0; y < 14; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (p.data[i * 4 + 3] && !p.em[i] && y < 12) p.em[i] = 1;
  }
  return p;
}

export const SPRITES = [
  { id: 'barrel', name: { ja: '樽', en: 'Barrel' }, make: barrel, pos: [22, 14] },
  { id: 'crate', name: { ja: '木箱', en: 'Crate' }, make: crate, pos: [64, 20], params: { bevel: 1.5, top: 3.6, detail: 1.5 } },
  { id: 'chest', name: { ja: '宝箱', en: 'Chest' }, make: chest, pos: [104, 20], params: { bevel: 3, top: 7.2, detail: 1.5 } },
  { id: 'crystal', name: { ja: 'クリスタル', en: 'Crystal' }, make: crystal, pos: [170, 10], light: { dx: 15, dy: 14, z: 14, color: [0.62, 0.45, 1], energy: 0.7, radius: 46 } },
  { id: 'slime', name: { ja: 'スライム', en: 'Slime' }, make: slime, frames: 4, pos: [80, 90], params: { bevel: 6, top: 13, detail: 1.5 } },
  { id: 'mushroom', name: { ja: 'キノコ', en: 'Mushroom' }, make: mushroom, pos: [26, 86] },
  { id: 'potion', name: { ja: 'ポーション', en: 'Potion' }, make: potion, pos: [190, 92], params: { bevel: 4, top: 10, detail: 1.5 }, light: { dx: 9, dy: 18, z: 10, color: [1, 0.35, 0.78], energy: 0.45, radius: 30 } },
  { id: 'brazier', name: { ja: '火鉢', en: 'Brazier' }, make: brazier, frames: 4, pos: [136, 82], light: { dx: 11, dy: 7, z: 20, color: [1, 0.56, 0.26], energy: 1.35, radius: 84, flicker: true } },
];

// ---------------------------------------------------------------- floor

/** seamless cobblestone tile (wrapped Voronoi) */
export function makeFloorTile(size = 48) {
  const p = new Pix(size, size);
  const cells = 4, cs = size / cells, pts = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    pts.push([(i + 0.2 + hash(i, j, 41) * 0.6) * cs, (j + 0.2 + hash(i, j, 43) * 0.6) * cs, j * cells + i]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let f1 = 1e9, f2 = 1e9, id = 0;
    for (const [qx, qy, qid] of pts) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const d = Math.hypot(x + 0.5 - qx - ox * size, (y + 0.5 - qy - oy * size) * 1.12);
        if (d < f1) { f2 = f1; f1 = d; id = qid; } else if (d < f2) f2 = d;
      }
    }
    const gap = f2 - f1;
    if (gap < 1.3) { p.set(x, y, ramp(PAL.stone, 0.05, x, y, 0.4)); continue; }
    const hv = hash(id, 0, 47);
    let t = 0.42 + hv * 0.22 + (hash(x >> 1, y >> 1, id) - 0.5) * 0.1;
    if (gap < 3) t -= 0.12; // stone edges
    // light from top-left baked very lightly
    let c = ramp(PAL.stone, t, x, y, 0.7);
    if (hv > 0.86 && gap < 3.6) c = ramp(PAL.moss, 0.4 + hash(x, y, 3) * 0.5, x, y, 0.5);
    if (hash(x, y, 77) < 0.004) c = PAL.stone[5];
    p.set(x, y, c);
  }
  return p;
}
