import { computeMaps, floorMaps, SPRITE_DEFAULTS } from './normalmap.js';
import { renderLit, LIGHT_DEFAULTS } from './lighting.js';
import { SPRITES, makeFloorTile } from './sprites.js';
import { I18N } from './i18n.js';

const SW = 224, SH = 140, FT = 64, MAX_PINNED = 6;
const $ = (s) => document.querySelector(s);

const state = {
  lang: localStorage.getItem('nml-lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
  view: 'lit', compare: false, flipY: false, spriteLights: true, animate: true,
  steps: LIGHT_DEFAULTS.steps, lightZ: LIGHT_DEFAULTS.z, radius: LIGHT_DEFAULTS.radius, energy: LIGHT_DEFAULTS.energy,
  lightColor: LIGHT_DEFAULTS.color.slice(), ambient: LIGHT_DEFAULTS.ambient.slice(),
};

// ------------------------------------------------------------ floor
const floorPix = makeFloorTile(FT);
const floor = floorMaps(floorPix.data, FT, FT);

// ------------------------------------------------------------ entities
let entities = [];
function makeEntity(def, frames, x, y) {
  const e = {
    def, name: def.name, frames, w: frames[0].w, h: frames[0].h, x, y,
    params: { ...SPRITE_DEFAULTS, ...(def.params || {}) },
    defaults: { ...SPRITE_DEFAULTS, ...(def.params || {}) },
    light: def.light || null, maps: [],
  };
  rebuild(e);
  return e;
}
function rebuild(e) { e.maps = e.frames.map((f) => computeMaps(f.data, f.w, f.h, e.params)); }
for (const d of SPRITES) {
  const n = d.frames || 1;
  const frames = Array.from({ length: n }, (_, i) => d.make(i));
  entities.push(makeEntity(d, frames, d.pos[0], d.pos[1]));
}
let selected = entities[0];
let frameIdx = 0;
const frameOf = (e) => (e.frames.length > 1 ? frameIdx % e.frames.length : 0);

// ------------------------------------------------------------ scene buffers
const N = SW * SH;
const albedo = new Float32Array(N * 3), normal = new Float32Array(N * 3), heightBuf = new Float32Array(N);
const nrgb = new Uint8ClampedArray(N * 4), emissive = new Uint8Array(N), owner = new Int16Array(N);

function compose() {
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x, fi = (y % FT) * FT + (x % FT);
    albedo[i * 3] = floorPix.data[fi * 4] / 255; albedo[i * 3 + 1] = floorPix.data[fi * 4 + 1] / 255; albedo[i * 3 + 2] = floorPix.data[fi * 4 + 2] / 255;
    normal[i * 3] = floor.normal[fi * 3]; normal[i * 3 + 1] = -floor.normal[fi * 3 + 1]; normal[i * 3 + 2] = floor.normal[fi * 3 + 2];
    heightBuf[i] = floor.height[fi];
    nrgb.set(floor.normalRGBA.subarray(fi * 4, fi * 4 + 4), i * 4);
    emissive[i] = 0; owner[i] = -1;
  }
  const order = entities.map((e, k) => [e, k]).sort((a, b) => a[0].y + a[0].h - (b[0].y + b[0].h));
  // soft blob shadows
  for (const [e] of order) {
    const cx = e.x + e.w / 2, cy = e.y + e.h - 2, rx = e.w * 0.46, ry = 3.2;
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const q = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (q > 1) continue;
      const k = q < 0.45 ? 0.5 : 0.7;
      const i = y * SW + x;
      albedo[i * 3] *= k; albedo[i * 3 + 1] *= k; albedo[i * 3 + 2] *= k;
    }
  }
  for (const [e, k] of order) {
    const fi = frameOf(e), f = e.frames[fi], m = e.maps[fi];
    for (let sy = 0; sy < e.h; sy++) for (let sx = 0; sx < e.w; sx++) {
      const si = sy * e.w + sx;
      if (!m.inside[si]) continue;
      const x = e.x + sx, y = e.y + sy;
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const i = y * SW + x;
      albedo[i * 3] = f.data[si * 4] / 255; albedo[i * 3 + 1] = f.data[si * 4 + 1] / 255; albedo[i * 3 + 2] = f.data[si * 4 + 2] / 255;
      normal[i * 3] = m.normal[si * 3]; normal[i * 3 + 1] = -m.normal[si * 3 + 1]; normal[i * 3 + 2] = m.normal[si * 3 + 2];
      heightBuf[i] = m.height[si];
      nrgb.set(m.normalRGBA.subarray(si * 4, si * 4 + 4), i * 4);
      emissive[i] = f.em[si]; owner[i] = k;
    }
  }
  if (state.flipY) for (let i = 0; i < N; i++) normal[i * 3 + 1] = -normal[i * 3 + 1];
}

// ------------------------------------------------------------ lights
let cursor = null; // {x,y} in scene px, null when the pointer is outside
const pinned = [];
function buildLights(t) {
  const base = { z: state.lightZ, radius: state.radius, energy: state.energy, color: state.lightColor };
  const L = [];
  const c = cursor || { x: SW / 2 + Math.cos(t * 0.45) * SW * 0.36, y: SH / 2 + Math.sin(t * 0.7) * SH * 0.3 };
  L.push({ ...base, x: c.x, y: c.y, kind: 'cursor' });
  for (const p of pinned) L.push({ ...base, x: p.x, y: p.y, kind: 'pin' });
  if (state.spriteLights) {
    for (const e of entities) {
      if (!e.light) continue;
      const fl = e.light.flicker ? 0.86 + 0.09 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 31.7 + 1.3) : 1;
      L.push({ x: e.x + e.light.dx, y: e.y + e.light.dy, z: e.light.z, radius: e.light.radius, color: e.light.color, energy: e.light.energy * fl, kind: 'sprite' });
    }
  }
  return L;
}

// ------------------------------------------------------------ render
const scene = $('#scene');
const sctx = scene.getContext('2d');
const img = sctx.createImageData(SW, SH);

function renderScene(t, lights) {
  const out = img.data;
  const v = state.view;
  if (v === 'lit' || v === 'light') {
    renderLit({
      w: SW, h: SH, albedo, normal, emissive, lights, ambient: state.ambient, steps: state.steps, out,
      splitX: state.compare ? SW / 2 : -1, white: v === 'light',
    });
  } else if (v === 'albedo') {
    for (let i = 0; i < N; i++) { out[i * 4] = albedo[i * 3] * 255; out[i * 4 + 1] = albedo[i * 3 + 1] * 255; out[i * 4 + 2] = albedo[i * 3 + 2] * 255; out[i * 4 + 3] = 255; }
  } else if (v === 'normal') {
    out.set(nrgb);
    if (state.flipY) for (let i = 0; i < N; i++) out[i * 4 + 1] = 255 - out[i * 4 + 1];
  } else if (v === 'height') {
    for (let i = 0; i < N; i++) { const g = Math.max(0, Math.min(255, (heightBuf[i] / 16) * 255)); out[i * 4] = g * 0.95; out[i * 4 + 1] = g * 0.92; out[i * 4 + 2] = g; out[i * 4 + 3] = 255; }
  }
  // light gizmos
  for (const L of lights) {
    if (L.kind === 'sprite') continue;
    const x = Math.floor(L.x), y = Math.floor(L.y);
    const dot = (dx, dy, a) => {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= SW || py >= SH) return;
      const o = (py * SW + px) * 4;
      out[o] += (255 - out[o]) * a; out[o + 1] += (245 - out[o + 1]) * a; out[o + 2] += (210 - out[o + 2]) * a;
    };
    dot(0, 0, 1); dot(1, 0, 0.5); dot(-1, 0, 0.5); dot(0, 1, 0.5); dot(0, -1, 0.5);
    if (L.kind === 'pin') { dot(2, 2, 0.35); dot(-2, -2, 0.35); dot(2, -2, 0.35); dot(-2, 2, 0.35); }
  }
  // selection brackets
  if (selected) {
    const { x, y, w, h } = selected;
    const put = (px, py) => {
      if (px < 0 || py < 0 || px >= SW || py >= SH) return;
      const o = (py * SW + px) * 4; out[o] = 255; out[o + 1] = 214; out[o + 2] = 102;
    };
    const x0 = x - 2, y0 = y - 2, x1 = x + w + 1, y1 = y + h + 1;
    for (let k = 0; k < 4; k++) {
      put(x0 + k, y0); put(x0, y0 + k); put(x1 - k, y0); put(x1, y0 + k);
      put(x0 + k, y1); put(x0, y1 - k); put(x1 - k, y1); put(x1, y1 - k);
    }
  }
  // split line
  if (state.compare && (v === 'lit' || v === 'light')) {
    for (let y = 0; y < SH; y += 2) { const o = (y * SW + SW / 2) * 4; out[o] = 255; out[o + 1] = 255; out[o + 2] = 255; }
  }
  sctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------ inspector
const insp = {
  albedo: $('#i-albedo'), dist: $('#i-dist'), height: $('#i-height'), normal: $('#i-normal'), lit: $('#i-lit'),
};
let litBufs = null;
function drawInspector() {
  const e = selected; if (!e) return;
  const fi = frameOf(e), f = e.frames[fi], m = e.maps[fi], w = e.w, h = e.h;
  const scale = Math.max(2, Math.floor(168 / Math.max(w, h)));
  for (const c of Object.values(insp)) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    c.style.width = `${w * scale}px`; c.style.height = `${h * scale}px`;
  }
  const put = (c, fill) => {
    const ctx = c.getContext('2d'), id = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) fill(i, id.data, i * 4);
    ctx.putImageData(id, 0, 0);
  };
  put(insp.albedo, (i, d, o) => { d[o] = f.data[o]; d[o + 1] = f.data[o + 1]; d[o + 2] = f.data[o + 2]; d[o + 3] = m.inside[i] ? 255 : 0; });
  put(insp.dist, (i, d, o) => {
    if (!m.inside[i]) { d[o + 3] = 0; return; }
    const r = m.ratio[i]; // magma-ish ramp
    d[o] = 40 + 215 * Math.min(1, r * 1.4); d[o + 1] = 20 + 220 * r * r; d[o + 2] = 90 + 120 * Math.sin(r * Math.PI) - 40 * r; d[o + 3] = 255;
  });
  let hmax = 1e-6; for (let i = 0; i < w * h; i++) hmax = Math.max(hmax, m.height[i]);
  put(insp.height, (i, d, o) => { const g = Math.max(0, (m.height[i] / hmax) * 255); d[o] = g; d[o + 1] = g; d[o + 2] = g; d[o + 3] = 255; });
  put(insp.normal, (i, d, o) => { d.set(m.normalRGBA.subarray(o, o + 4), o); if (state.flipY) d[o + 1] = 255 - d[o + 1]; });
  litBufs = { e, fi, f, m };
}
function drawInspectorLit(t) {
  if (!litBufs) return;
  const { e, f, m } = litBufs, w = e.w, h = e.h;
  const ctx = insp.lit.getContext('2d'), id = ctx.createImageData(w, h);
  const al = new Float32Array(w * h * 3), nn = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    al[i * 3] = f.data[i * 4] / 255; al[i * 3 + 1] = f.data[i * 4 + 1] / 255; al[i * 3 + 2] = f.data[i * 4 + 2] / 255;
    nn[i * 3] = m.normal[i * 3]; nn[i * 3 + 1] = (state.flipY ? 1 : -1) * m.normal[i * 3 + 1]; nn[i * 3 + 2] = m.normal[i * 3 + 2];
  }
  const R = Math.max(w, h);
  const lights = [{ x: w / 2 + Math.cos(t * 1.1) * R * 0.75, y: h / 2 + Math.sin(t * 1.1) * R * 0.6, z: state.lightZ * (R / 30), radius: state.radius * (R / 30), energy: state.energy, color: state.lightColor }];
  renderLit({ w, h, albedo: al, normal: nn, emissive: f.em, lights, ambient: state.ambient, steps: state.steps, out: id.data });
  for (let i = 0; i < w * h; i++) if (!m.inside[i]) id.data[i * 4 + 3] = 0;
  ctx.putImageData(id, 0, 0);
}

function readout(ev, c) {
  const e = selected; if (!e || !litBufs) return;
  const r = c.getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * e.w), y = Math.floor(((ev.clientY - r.top) / r.height) * e.h);
  if (x < 0 || y < 0 || x >= e.w || y >= e.h) return;
  const { m, f } = litBufs, i = y * e.w + x;
  const n = m.normalRGBA;
  $('#readout').innerHTML =
    `<span>(${x}, ${y})</span><span>α ${f.data[i * 4 + 3]} ${m.inside[i] ? 'inside' : 'outside'}</span>` +
    `<span>d ${m.dist[i].toFixed(2)}</span><span>r ${m.ratio[i].toFixed(2)}</span>` +
    `<span>h ${m.height[i].toFixed(2)}</span>` +
    `<span class="sw" style="--c:rgb(${n[i * 4]},${n[i * 4 + 1]},${n[i * 4 + 2]})">rgb(${n[i * 4]}, ${n[i * 4 + 1]}, ${n[i * 4 + 2]})</span>` +
    `<span>n (${m.normal[i * 3].toFixed(2)}, ${m.normal[i * 3 + 1].toFixed(2)}, ${m.normal[i * 3 + 2].toFixed(2)})</span>`;
}
for (const c of Object.values(insp)) c.addEventListener('pointermove', (ev) => readout(ev, c));

// ------------------------------------------------------------ sprite chips
function thumbURL(e) {
  const c = document.createElement('canvas'); c.width = e.w; c.height = e.h;
  const f = e.frames[0]; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.data), e.w, e.h), 0, 0);
  return c.toDataURL();
}
function renderChips() {
  const box = $('#chips'); box.innerHTML = '';
  for (const e of entities) {
    const b = document.createElement('button');
    b.className = 'chip' + (e === selected ? ' on' : '');
    b.title = e.name[state.lang] || e.name.en;
    b.innerHTML = `<img src="${thumbURL(e)}" alt=""><span>${b.title}</span>`;
    b.onclick = () => select(e);
    box.appendChild(b);
  }
}

// ------------------------------------------------------------ controls
const sliders = {
  bevel: { el: '#p-bevel', fmt: (v) => v.toFixed(1) }, top: { el: '#p-top', fmt: (v) => v.toFixed(1) },
  detail: { el: '#p-detail', fmt: (v) => v.toFixed(1) }, sigma: { el: '#p-sigma', fmt: (v) => v.toFixed(2) },
};
function syncParamUI() {
  for (const [k, s] of Object.entries(sliders)) {
    const el = $(s.el); el.value = selected.params[k];
    el.parentElement.querySelector('output').textContent = s.fmt(selected.params[k]);
  }
  $('#sel-name').textContent = selected.name[state.lang] || selected.name.en;
  $('#sel-size').textContent = `${selected.w}×${selected.h}px · ${selected.frames.length} frame${selected.frames.length > 1 ? 's' : ''}`;
}
let rebuildTimer = 0;
for (const [k, s] of Object.entries(sliders)) {
  $(s.el).addEventListener('input', (ev) => {
    selected.params[k] = parseFloat(ev.target.value);
    ev.target.parentElement.querySelector('output').textContent = s.fmt(selected.params[k]);
    cancelAnimationFrame(rebuildTimer);
    rebuildTimer = requestAnimationFrame(() => { rebuild(selected); dirty = true; drawInspector(); });
  });
}
$('#boxy').onclick = () => { selected.params.top = +(12 * selected.params.bevel / 5).toFixed(2); rebuild(selected); syncParamUI(); dirty = true; drawInspector(); };
$('#reset').onclick = () => { selected.params = { ...selected.defaults }; rebuild(selected); syncParamUI(); dirty = true; drawInspector(); };

const gsl = {
  steps: ['#g-steps', (v) => (v === 0 ? 'smooth' : v)], lightZ: ['#g-z', (v) => v], radius: ['#g-radius', (v) => v], energy: ['#g-energy', (v) => v.toFixed(2)],
};
for (const [k, [sel, fmt]] of Object.entries(gsl)) {
  const el = $(sel);
  el.value = state[k];
  const out = el.parentElement.querySelector('output');
  out.textContent = fmt(state[k]);
  el.addEventListener('input', () => { state[k] = parseFloat(el.value); out.textContent = fmt(state[k]); });
}
const toHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
$('#g-color').value = toHex(state.lightColor);
$('#g-ambient').value = toHex(state.ambient);
$('#g-color').addEventListener('input', (ev) => { state.lightColor = fromHex(ev.target.value); });
$('#g-ambient').addEventListener('input', (ev) => { state.ambient = fromHex(ev.target.value); });

const toggles = { compare: '#t-compare', flipY: '#t-flip', spriteLights: '#t-slights', animate: '#t-anim' };
for (const [k, sel] of Object.entries(toggles)) {
  const el = $(sel); el.checked = state[k];
  el.addEventListener('change', () => { state[k] = el.checked; if (k === 'flipY') { dirty = true; drawInspector(); } });
}
$('#clear-lights').onclick = () => { pinned.length = 0; };

document.querySelectorAll('.views button').forEach((b) => {
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b));
  });
});

function select(e) { selected = e; syncParamUI(); renderChips(); drawInspector(); }

// ------------------------------------------------------------ pointer on stage
const toScene = (ev) => {
  const r = scene.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) / r.width) * SW, y: ((ev.clientY - r.top) / r.height) * SH };
};
function hit(p) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= SW || y >= SH) return null;
  const k = owner[y * SW + x];
  return k >= 0 ? entities[k] : null;
}
let drag = null;
scene.addEventListener('pointermove', (ev) => {
  const p = toScene(ev);
  cursor = p;
  if (drag) {
    drag.e.x = Math.round(p.x - drag.ox); drag.e.y = Math.round(p.y - drag.oy);
    dirty = true;
  }
  scene.style.cursor = drag ? 'grabbing' : hit(p) ? 'grab' : 'crosshair';
});
scene.addEventListener('pointerleave', () => { if (!drag) cursor = null; });
scene.addEventListener('pointerdown', (ev) => {
  const p = toScene(ev);
  cursor = p;
  const e = hit(p);
  if (e) {
    drag = { e, ox: p.x - e.x, oy: p.y - e.y };
    scene.setPointerCapture(ev.pointerId);
    if (e !== selected) select(e);
  }
});
const endDrag = () => { drag = null; };
scene.addEventListener('pointerup', endDrag);
scene.addEventListener('pointercancel', endDrag);
scene.addEventListener('dblclick', (ev) => {
  const p = toScene(ev);
  if (pinned.length >= MAX_PINNED) pinned.shift();
  pinned.push(p);
});

// ------------------------------------------------------------ files
$('#upload').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; if (!file) return;
  const bmp = await createImageBitmap(file);
  let w = bmp.width, h = bmp.height;
  const s = Math.min(1, 128 / Math.max(w, h));
  w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(bmp, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const frame = { w, h, data, em: new Uint8Array(w * h) };
  const k = Math.min(3, Math.max(0.3, Math.max(w, h) / 30));
  const def = { name: { ja: file.name, en: file.name }, params: { bevel: +(5 * k).toFixed(1), top: +(12 * k).toFixed(1), detail: 1.5 } };
  const e = makeEntity(def, [frame], Math.round((SW - w) / 2), Math.round((SH - h) / 2));
  entities.push(e);
  select(e); dirty = true;
  ev.target.value = '';
});
function savePNG(w, h, fill, name) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), id = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) fill(i, id.data, i * 4);
  ctx.putImageData(id, 0, 0);
  c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
}
const baseName = () => (selected.def.id || (selected.name.en || 'sprite').replace(/\.[^.]+$/, '')).replace(/[^\w-]+/g, '_');
$('#dl-normal').onclick = () => {
  const m = selected.maps[frameOf(selected)];
  savePNG(selected.w, selected.h, (i, d, o) => d.set(m.normalRGBA.subarray(o, o + 4), o), `${baseName()}_normal.png`);
};
$('#dl-height').onclick = () => {
  const m = selected.maps[frameOf(selected)];
  let hmax = 1e-6; for (const v of m.height) hmax = Math.max(hmax, v);
  savePNG(selected.w, selected.h, (i, d, o) => { const g = Math.max(0, (m.height[i] / hmax) * 255); d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = 255; }, `${baseName()}_height.png`);
};

// ------------------------------------------------------------ i18n
function applyLang() {
  const T = I18N[state.lang];
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T[el.dataset.i18n]; });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = T[el.dataset.i18nHtml]; });
  $('#lang').textContent = state.lang === 'ja' ? 'EN' : '日本語';
  $('#readout').textContent = T.readoutIdle;
  syncParamUI(); renderChips();
}
$('#lang').onclick = () => { state.lang = state.lang === 'ja' ? 'en' : 'ja'; localStorage.setItem('nml-lang', state.lang); applyLang(); };

// ------------------------------------------------------------ loop
let dirty = true, lastFrameT = 0;
function tick(ms) {
  const t = ms / 1000;
  if (state.animate && ms - lastFrameT > 150) {
    lastFrameT = ms; frameIdx++; dirty = true;
    if (selected.frames.length > 1) drawInspector();
  }
  if (dirty) { compose(); dirty = false; }
  const lights = buildLights(state.animate ? t : 0);
  renderScene(t, lights);
  drawInspectorLit(t);
  requestAnimationFrame(tick);
}
applyLang();
drawInspector();
requestAnimationFrame(tick);
