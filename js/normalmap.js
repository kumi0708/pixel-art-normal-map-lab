// Outline-based normal map generation for pixel art.
// Pure functions, no DOM: usable from the browser and from Node (tests).
//
// Pipeline (per sprite / per animation frame):
//   alpha > 127 -> inside mask -> 1px transparent padding -> Euclidean distance transform
//   -> r = clamp(d / bevel) -> quarter-circle bevel  height = top * sqrt(1 - (1 - r)^2)
//   -> + detail * (luminance - mean luminance inside) -> 0 outside
//   -> Gaussian blur (sigma 0.7) -> central-difference gradient
//   -> n = normalize(-gx, gy, 1) -> rgb = (n * 0.5 + 0.5) * 255

export const SPRITE_DEFAULTS = Object.freeze({ bevel: 5, top: 12, detail: 1.5, sigma: 0.7 });
export const FLOOR_DEFAULTS = Object.freeze({
  bevel: 3, top: 2.5, detail: 1.0, sigma: 0.7, maskSigma: 0.8, gapPercentile: 30,
});
export const ALPHA_THRESHOLD = 127;

const INF = 1e20;

export function insideMask(rgba, w, h, threshold = ALPHA_THRESHOLD) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = rgba[i * 4 + 3] > threshold ? 1 : 0;
  return m;
}

// Rec.601 luma of RGB (alpha ignored), 0..1
export function luminance(rgba, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    L[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  }
  return L;
}

// 1D squared distance transform of a sampled function (Felzenszwalb & Huttenlocher 2012).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

// Exact Euclidean distance from every inside pixel to the nearest outside pixel.
// The mask is padded by one transparent pixel so the canvas border counts as an edge.
// pad = false reproduces the "sprite touches the canvas edge" bug (border is not an edge).
export function distanceTransform(mask, w, h, pad = true) {
  const W = w + 2, H = h + 2;
  const g = new Float64Array(W * H).fill(pad ? 0 : INF); // padding = outside (or not, when pad=false)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = mask[y * w + x] ? INF : 0;
  }
  const n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) f[x] = g[o + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[o + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(g[(y + 1) * W + x + 1]);
  }
  return out;
}

// scipy.ndimage 'reflect' boundary: (d c b a | a b c d | d c b a)
function reflect(i, n) {
  if (n === 1) return 0;
  const p = 2 * n;
  i = ((i % p) + p) % p;
  return i < n ? i : p - 1 - i;
}

// Separable Gaussian blur, kernel radius = int(4 * sigma + 0.5) like scipy.ndimage.gaussian_filter
export function gaussianBlur(src, w, h, sigma) {
  if (!(sigma > 0)) return Float32Array.from(src);
  const r = Math.max(1, Math.floor(4 * sigma + 0.5));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += (k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * src[y * w + reflect(x + i, w)];
      tmp[y * w + x] = a;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * tmp[reflect(y + i, h) * w + x];
      out[y * w + x] = a;
    }
  }
  return out;
}

// numpy.gradient semantics: central differences inside, one-sided at the borders.
export function gradient(hgt, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (w > 1) {
        if (x === 0) gx[i] = hgt[i + 1] - hgt[i];
        else if (x === w - 1) gx[i] = hgt[i] - hgt[i - 1];
        else gx[i] = (hgt[i + 1] - hgt[i - 1]) * 0.5;
      }
      if (h > 1) {
        if (y === 0) gy[i] = hgt[i + w] - hgt[i];
        else if (y === h - 1) gy[i] = hgt[i] - hgt[i - w];
        else gy[i] = (hgt[i + w] - hgt[i - w]) * 0.5;
      }
    }
  }
  return { gx, gy };
}

/**
 * Generate height + normal map for one sprite frame.
 * @returns {{w,h,inside,dist,ratio,rawHeight,height,normal,normalRGBA,meanLum}}
 *   normal: Float32Array xyz per pixel, y = "up" (OpenGL / Godot convention)
 *   normalRGBA: encoded PNG-ready bytes, flat = (128,128,255)
 */
export function computeMaps(rgba, w, h, opts = {}) {
  const o = { ...SPRITE_DEFAULTS, threshold: ALPHA_THRESHOLD, pad: true, ...opts };
  const inside = insideMask(rgba, w, h, o.threshold);
  const dist = distanceTransform(inside, w, h, o.pad);
  const L = luminance(rgba, w, h);

  let sum = 0, cnt = 0;
  for (let i = 0; i < w * h; i++) if (inside[i]) { sum += L[i]; cnt++; }
  const meanLum = cnt ? sum / cnt : 0; // guard: empty frame

  const ratio = new Float32Array(w * h);
  const rawHeight = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!inside[i]) continue;
    const r = o.bevel > 0 ? Math.min(1, Math.max(0, dist[i] / o.bevel)) : 1;
    ratio[i] = r;
    const bevelH = o.top * Math.sqrt(1 - (1 - r) * (1 - r)); // quarter circle
    rawHeight[i] = bevelH + o.detail * (L[i] - meanLum);
  }

  const height = gaussianBlur(rawHeight, w, h, o.sigma);
  const { gx, gy } = gradient(height, w, h);

  const normal = new Float32Array(w * h * 3);
  const normalRGBA = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let nx = -gx[i], ny = gy[i], nz = 1; // rows go down, so +gy points "up" in the map
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    normal[i * 3] = nx; normal[i * 3 + 1] = ny; normal[i * 3 + 2] = nz;
    normalRGBA[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
    normalRGBA[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    normalRGBA[i * 4 + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    normalRGBA[i * 4 + 3] = 255;
  }
  return { w, h, inside, dist, ratio, rawHeight, height, gx, gy, normal, normalRGBA, meanLum, params: o };
}

// numpy.percentile with linear interpolation
export function percentile(values, p) {
  const s = Float32Array.from(values).sort();
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * Seamless floor tile: tile 3x3, stones = blur(gray, 0.8) > 30th percentile of gray,
 * run the sprite pipeline with floor parameters, crop the centre tile.
 */
export function floorMaps(rgba, w, h, opts = {}) {
  const o = { ...FLOOR_DEFAULTS, ...opts };
  const W = w * 3, H = h * 3;
  const tiled = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = ((y % h) * w + (x % w)) * 4, d = (y * W + x) * 4;
      tiled[d] = rgba[s]; tiled[d + 1] = rgba[s + 1]; tiled[d + 2] = rgba[s + 2];
    }
  }
  const gray = luminance(tiled, W, H);
  for (let i = 0; i < gray.length; i++) gray[i] *= 255;
  const blurred = gaussianBlur(gray, W, H, o.maskSigma);
  const thr = percentile(gray, o.gapPercentile);
  for (let i = 0; i < W * H; i++) tiled[i * 4 + 3] = blurred[i] > thr ? 255 : 0;

  const m = computeMaps(tiled, W, H, { bevel: o.bevel, top: o.top, detail: o.detail, sigma: o.sigma });
  const crop = (arr, ch) => {
    const out = new arr.constructor(w * h * ch);
    for (let y = 0; y < h; y++) {
      const s = ((y + h) * W + w) * ch;
      out.set(arr.subarray(s, s + w * ch), y * w * ch);
    }
    return out;
  };
  return {
    w, h,
    inside: crop(m.inside, 1), dist: crop(m.dist, 1), ratio: crop(m.ratio, 1),
    rawHeight: crop(m.rawHeight, 1), height: crop(m.height, 1),
    normal: crop(m.normal, 3), normalRGBA: crop(m.normalRGBA, 4), params: o,
  };
}
