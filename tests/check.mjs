// Numeric checks taken from the article's worked examples. Run: node tests/check.mjs
import assert from 'node:assert/strict';
import { computeMaps, floorMaps } from '../js/normalmap.js';
import { lightAmount, LIGHT_DEFAULTS } from '../js/lighting.js';
import { makeFloorTile, SPRITES } from '../js/sprites.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

// a round, hard-edged 30px sprite in a 44px canvas
const S = 44, cx = 22, cy = 22, R = 15;
const rgba = new Uint8ClampedArray(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  const i = (y * S + x) * 4;
  if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= R) { rgba[i] = 180; rgba[i + 1] = 120; rgba[i + 2] = 80; rgba[i + 3] = 255; }
}
const m = computeMaps(rgba, S, S);
const px = (x, y) => [...m.normalRGBA.subarray((y * S + x) * 4, (y * S + x) * 4 + 3)];
const row = cy - 1;
const xs = [...Array(S).keys()].filter((x) => m.inside[row * S + x]);
const ys = [...Array(S).keys()].filter((y) => m.inside[y * S + cx]);

test('normal map has the sprite size', () => assert.equal(m.normalRGBA.length, S * S * 4));
test('leftmost inside pixel faces left (R < 100)', () => assert.ok(px(xs[0], row)[0] < 100, px(xs[0], row)));
test('rightmost inside pixel faces right (R > 156)', () => assert.ok(px(xs.at(-1), row)[0] > 156));
test('one pixel below the top edge faces up (G > 156)', () => assert.ok(px(cx, ys[0] + 1)[1] > 156));
test('pixels > 5px outside are flat (128,128,255) ±1', () => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > R + 5) {
      const [r, g, b] = px(x, y);
      assert.ok(Math.abs(r - 128) <= 1 && Math.abs(g - 128) <= 1 && Math.abs(b - 255) <= 1, `${x},${y}: ${r},${g},${b}`);
    }
  }
});

const L = (dist) => ({ x: dist, y: 0, z: LIGHT_DEFAULTS.z, radius: LIGHT_DEFAULTS.radius });
test('flat normal 10px from the light -> band 5/6', () => assert.equal(lightAmount(0, 0, 1, 0, 0, L(10), 6), 5 / 6));
test('flat normal 35px from the light -> band 2/6', () => assert.equal(lightAmount(0, 0, 1, 0, 0, L(35), 6), 2 / 6));
test('70px or more -> no light', () => assert.equal(lightAmount(0, 0, 1, 0, 0, L(70), 6), 0));
test('smooth value at 10px ≈ 0.776', () => assert.ok(Math.abs(lightAmount(0, 0, 1, 0, 0, L(10), 0) - 0.776) < 0.002));

test('light on the left lights the left half more', () => {
  const light = { x: cx - 40, y: cy, z: 26, radius: 70 };
  let left = 0, right = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; if (!m.inside[i]) continue;
    const v = lightAmount(m.normal[i * 3], -m.normal[i * 3 + 1], m.normal[i * 3 + 2], x + 0.5, y + 0.5, light, 0);
    if (x < cx) left += v; else right += v;
  }
  assert.ok(left > right, `${left} vs ${right}`);
});

test('sprite touching the canvas edge still gets a bevel there (1px padding)', () => {
  const w = 20, h = 20, a = new Uint8ClampedArray(w * h * 4).fill(255);
  const mm = computeMaps(a, w, h);
  assert.ok(mm.normalRGBA[(10 * w) * 4] < 100, 'left column should face left');
});

test('empty frame does not produce NaN', () => {
  const mm = computeMaps(new Uint8ClampedArray(8 * 8 * 4), 8, 8);
  assert.ok(mm.normal.every(Number.isFinite));
});

test('floor tile is seamless (opposite edges match)', () => {
  const t = makeFloorTile(48), f = floorMaps(t.data, 48, 48);
  // generate the tile once more shifted by one period: values at x=0 vs neighbours across the seam are continuous
  let diff = 0;
  for (let y = 0; y < 48; y++) diff += Math.abs(f.height[y * 48] - f.height[y * 48 + 47]);
  assert.ok(diff / 48 < 2.5, `mean seam step ${diff / 48}`);
});

test('all built-in sprites generate finite maps', () => {
  for (const d of SPRITES) for (let k = 0; k < (d.frames || 1); k++) {
    const p = d.make(k), mm = computeMaps(p.data, p.w, p.h, d.params);
    assert.ok(mm.normal.every(Number.isFinite), d.id);
  }
});

console.log(`\n${passed} checks passed`);
