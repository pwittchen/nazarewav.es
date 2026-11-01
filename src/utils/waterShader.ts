import { GRAVITY } from './waveField';

/**
 * Wind sea and surface detail shared by WaveMesh and FarOcean.
 * Chop is a handful of incommensurate wave trains spread around the wind direction,
 * which never line up into a visible grid the way a product of sines does.
 */
const CHOP_TRAINS = [
  { k: 0.042, spread: -0.5, amp: 0.45 },
  { k: 0.071, spread: 0.35, amp: 0.3 },
  { k: 0.113, spread: -0.2, amp: 0.17 },
  { k: 0.167, spread: 0.65, amp: 0.08 },
];

export interface ChopTrain {
  kx: number;
  kz: number;
  omega: number;
  amp: number;
}

/** Trains running downwind for a meteorological wind direction (where it blows from) */
export function chopTrains(windFromDeg: number): ChopTrain[] {
  const downwind = ((windFromDeg + 180) * Math.PI) / 180;
  return CHOP_TRAINS.map(({ k, spread, amp }) => {
    const a = downwind + spread;
    return { kx: k * Math.cos(a), kz: k * Math.sin(a), omega: Math.sqrt(GRAVITY * k), amp };
  });
}

/** GLSL value noise, shared by the foam break-up and the ripples */
export const NOISE_GLSL = `
  float waterHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x),
               mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float waterFbm(vec2 p) {
    return 0.5 * waterNoise(p) + 0.3 * waterNoise(p * 2.13 + 7.1) + 0.2 * waterNoise(p * 4.37 + 3.3);
  }
`;

/**
 * Small ripples perturbing the shading normal per pixel: the wave meshes are metres
 * coarse, and without this the sun and sky reflect off an unnaturally smooth surface.
 * Expects `vXZ` and `uTime`.
 */
export const RIPPLE_NORMAL_GLSL = `
  {
    vec2 rp = vXZ * 0.11;
    float rt = uTime * 0.35;
    float r0 = waterFbm(rp + vec2(rt, -rt * 0.6));
    float rx = waterFbm(rp + vec2(rt + 0.35, -rt * 0.6));
    float rz = waterFbm(rp + vec2(rt, -rt * 0.6 + 0.35));
    vec3 rippleWorld = vec3(r0 - rx, 0.0, r0 - rz) * 0.5;
    normal = normalize(normal + (viewMatrix * vec4(rippleWorld, 0.0)).xyz);
  }
`;
