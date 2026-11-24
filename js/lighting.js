// Per-pixel 2D point lighting with a normal map (CPU version of the canvas_item shader).
//
//   to_light = (light.xy - pixel, light.z)
//   falloff  = clamp(1 - |to_light.xy| / radius, 0, 1) ^ 1.2
//   lit      = falloff * max(dot(n, normalize(to_light)), 0)
//   lit      = ceil(lit * steps) / steps          (toon bands, steps > 0)
//   color    = albedo * (ambient + light_color * energy * lit)

export const LIGHT_DEFAULTS = Object.freeze({
  ambient: [0.24, 0.25, 0.33],
  color: [1.0, 0.8, 0.56],
  energy: 1.6,
  z: 26,
  radius: 70,
  steps: 6,
});

/** Light intensity reaching one pixel (no colour). n is screen-space (y down). */
export function lightAmount(nx, ny, nz, px, py, light, steps) {
  const dx = light.x - px, dy = light.y - py;
  const d2 = dx * dx + dy * dy;
  const R = light.radius;
  if (d2 >= R * R) return 0;
  const f = Math.pow(1 - Math.sqrt(d2) / R, 1.2);
  const len = Math.sqrt(d2 + light.z * light.z);
  const dot = (nx * dx + ny * dy + nz * light.z) / len;
  if (dot <= 0) return 0;
  let lit = f * dot;
  if (steps > 0) lit = Math.ceil(lit * steps) / steps;
  return lit;
}

/**
 * Shade a whole buffer.
 * albedo: Float32 rgb 0..1, normal: Float32 xyz screen-space (y down),
 * emissive: Uint8 (1 = unlit full-bright), out: Uint8ClampedArray rgba.
 * opts.flatLeft: use the flat normal (0,0,1) for x < splitX (comparison mode).
 * opts.white: ignore albedo (show the light only).
 */
export function renderLit({ w, h, albedo, normal, emissive, lights, ambient, steps, out, splitX = -1, white = false }) {
  const nL = lights.length;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const ar = white ? 0.85 : albedo[i * 3], ag = white ? 0.85 : albedo[i * 3 + 1], ab = white ? 0.85 : albedo[i * 3 + 2];
      if (emissive && emissive[i] && !white) {
        out[o] = ar * 255; out[o + 1] = ag * 255; out[o + 2] = ab * 255; out[o + 3] = 255;
        continue;
      }
      let nx, ny, nz;
      if (x < splitX) { nx = 0; ny = 0; nz = 1; }
      else { nx = normal[i * 3]; ny = normal[i * 3 + 1]; nz = normal[i * 3 + 2]; }
      let r = ambient[0], g = ambient[1], b = ambient[2];
      const px = x + 0.5;
      for (let l = 0; l < nL; l++) {
        const L = lights[l];
        const lit = lightAmount(nx, ny, nz, px, py, L, steps);
        if (lit > 0) {
          const k = L.energy * lit;
          r += L.color[0] * k; g += L.color[1] * k; b += L.color[2] * k;
        }
      }
      out[o] = ar * r * 255; out[o + 1] = ag * g * 255; out[o + 2] = ab * b * 255; out[o + 3] = 255;
    }
  }
}
