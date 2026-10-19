/**
 * Procedural terrain for the Nazaré coastline.
 *
 * World orientation (matches the wave model in WaveMesh):
 *   -Z = open Atlantic (west), +Z = land (east)
 *   +X = north (Praia do Norte), -X = south (Sítio headland + fort)
 *
 * Landmarks:
 *   - Praia do Norte: long sandy beach along z ≈ 152, backed by dunes and pine forest
 *   - Sítio plateau: ~80m high ochre sandstone cliffs at the south end of the beach
 *   - Promontório: lower rock spur jutting into the sea, topped by the
 *     Forte de São Miguel Arcanjo and its red lighthouse
 *   - Nazaré Canyon: deep trench whose head points at the beach (x ≈ 0)
 *   - Sítio cliff edge (x ≈ -465): the plateau drops south into Nazaré bay, with the
 *     Largo, Santuário, Ermida da Memória and the Ascensor funicular down to the town
 *   - Nazaré town: dense grid of houses on the flats between the crescent town beach
 *     (Praia da Nazaré) and the escarpment behind it, ending at the harbour breakwater
 */

export const TERRAIN_BOUNDS = { minX: -1100, maxX: 1100, minZ: -80, maxZ: 900 };

// Rock spur holding the fort, joined to the plateau by a ridge
export const SPUR = { x: -208, z: 40, rx: 42, rz: 34 };
const SPUR_RIDGE_END = { x: -225, z: 125 };
export const FORT_POSITION = { x: -205, z: 36 };
export const FORT_GROUND = 36;

export function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// Works with edge0 > edge1 too (reversed ramp), like GLSL
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix: number, iz: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

/** Fractal noise in roughly [-1, 1] */
export function fbm(x: number, z: number, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq + i * 17.3, z * freq - i * 9.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Deterministic PRNG so the coast looks the same on every load */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from (x, z) to the segment a-b, plus the 0..1 position along it */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const u = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return { dist: Math.hypot(x - (ax + u * dx), z - (az + u * dz)), u };
}

/**
 * Z coordinate of the waterline: Praia do Norte in the north, then south of the
 * headland the coast recedes into the sheltered crescent of Nazaré bay.
 */
export function shoreZ(x: number) {
  return 152 + 5 * Math.sin(x * 0.005) + 4 * fbm(x * 0.01, 3.7, 3)
    + 390 * smoothstep(-470, -800, x)
    // Sand piling up against the harbour breakwater at the south end
    - 40 * smoothstep(-850, -1100, x);
}

/** 0 = Praia do Norte / dunes, 1 = Nazaré town and its beach south of the Sítio */
export function townMask(x: number) {
  return smoothstep(-470, -540, x);
}

/** X of the Sítio's south cliff edge, overlooking the town (calmer where the Largo stands) */
export function southCliffX(z: number) {
  const calm = 1 - 0.85 * Math.exp(-(((z - 390) / 110) ** 2));
  return -465 + (15 * fbm(z * 0.01, 4.4, 4) + 5 * fbm(z * 0.05, 7.7, 2)) * calm;
}

/** Signed distance (positive = inside) to the Sítio plateau outline */
export function plateauDistance(x: number, z: number) {
  // North cliff line facing Praia do Norte, running diagonally inland
  const northEdge = -182 + 0.2 * Math.max(0, z - 80) + 14 * fbm(z * 0.012, 11.3, 4) + 5 * fbm(z * 0.05, 2.2, 2);
  // West cliff line facing the open ocean, with headlands and coves
  const westEdge = 72 + 22 * fbm(x * 0.008, 5.1, 4) + 6 * fbm(x * 0.04, 8.8, 2);
  const sitio = Math.min(northEdge - x, z - westEdge, x - southCliffX(z));
  // Escarpment behind the town, where the plateau continues south (Pederneira)
  const escarpment = z - (790 + 25 * fbm(x * 0.008, 6.6, 3));
  return Math.max(sitio, Math.min(northEdge - x, escarpment));
}

// Rock strata: flattens heights into ledges of the given step size
function terrace(h: number, step: number) {
  const q = h / step;
  const floor = Math.floor(q);
  return (floor + smoothstep(0.3, 0.7, q - floor)) * step;
}

function plateauTop(x: number, z: number) {
  return 82 + 8 * fbm(x * 0.006, z * 0.006, 3) - 0.02 * Math.max(0, z - 300);
}

/** Largo de Nossa Senhora da Nazaré: the big paved square of the Sítio */
export const LARGO = { minX: -448, maxX: -372, minZ: 332, maxZ: 436 };

/** Road from the Largo down the ridge to the fort (Estrada do Farol) */
export const ROAD: [number, number][] = [
  [-206, 53], [-216, 90], [-225, 125], [-262, 190], [-330, 262], [-385, 318], [-410, 332],
];

export function roadDistance(x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < ROAD.length; i++) {
    const [ax, az] = ROAD[i - 1];
    const [bx, bz] = ROAD[i];
    best = Math.min(best, segmentDistance(x, z, ax, az, bx, bz).dist);
  }
  return best;
}

/** Ascensor da Nazaré: funicular from the town up the cliff to the Sítio */
export const FUNICULAR = {
  lower: { x: -600, y: 7, z: 425 },
  upper: { x: -447, y: plateauTop(-447, 418), z: 418 },
};

/** North breakwater of the Porto de Abrigo, closing the bay in the south */
export const BREAKWATER = { x: -1062, length: 230 };

/** Pedra do Guilhim: big rock at the foot of the Sítio cliff where the town beach starts */
export const GUILHIM = { x: -494, z: 150, rx: 16, rz: 11 };

/** Terrain height (meters above sea level, negative = seabed) */
export function terrainHeight(x: number, z: number) {
  const d = z - shoreZ(x);
  const n = 1.2 * fbm(x * 0.03, z * 0.03, 3);
  let h: number;

  if (d < 0) {
    // Seabed shelving off the beach, dropping to deep water offshore
    h = d * 0.3 - smoothstep(-120, -320, d) * 150 + n;
    // Head of the Nazaré Canyon - keeps water deep right up to the beach
    h -= 28 * Math.exp(-(x * x) / (70 * 70)) * smoothstep(-15, -140, d);
  } else {
    // Beach -> dunes -> pine forest hinterland
    const beach = 4.5 * smoothstep(0, 60, d) + d * 0.01;
    const duneMask = smoothstep(45, 85, d);
    const dunes = duneMask * (7 + 5 * fbm(x * 0.025, z * 0.025, 4) + 3 * Math.abs(fbm(x * 0.07, z * 0.05, 2)));
    const inland = smoothstep(90, 600, d) * 22 + duneMask * 6 * fbm(x * 0.006, z * 0.006, 3);
    h = beach + dunes + inland + n;
    // Town flats: wide beach, the seafront avenue, then streets gently rising inland
    const town = townMask(x);
    if (town > 0) {
      const urban = 3.6 * smoothstep(0, 65, d) + 0.03 * Math.max(0, d - 80) + 0.3 * n;
      h = lerp(h, urban, town);
    }
  }

  // Sítio plateau: near-vertical sandstone faces with strata ledges and a scree apron
  const s = plateauDistance(x, z);
  if (s > -40) {
    const sn = s + 5 * fbm(x * 0.05, z * 0.05, 3);
    const t = smoothstep(-4, 10, sn);
    const face = 4 * t * (1 - t);
    let cliff = lerp(h, plateauTop(x, z), t);
    cliff = lerp(cliff, terrace(cliff, 7), face * 0.6) + face * 4 * fbm(x * 0.12, z * 0.12, 3);
    const scree = smoothstep(-34, -4, sn) ** 2 * (1 - t) * (7 + 4 * fbm(x * 0.07, z * 0.07, 2));
    h = Math.max(h, cliff + scree);
  }

  // Rock promontory below the plateau, flattened where the fort stands
  const fortDist = Math.hypot(x - FORT_POSITION.x, z - FORT_POSITION.z);
  const sx = (x - SPUR.x) / SPUR.rx;
  const sz = (z - SPUR.z) / SPUR.rz;
  const ds = 1 - Math.sqrt(sx * sx + sz * sz) + 0.2 * fbm(x * 0.03, z * 0.03, 3) + 0.08 * fbm(x * 0.1, z * 0.1, 2);
  if (ds > -0.3) {
    const t = Math.max(smoothstep(-0.1, 0.35, ds), smoothstep(26, 18, fortDist));
    const top = lerp(FORT_GROUND + 3 * fbm(x * 0.04, z * 0.04, 2), FORT_GROUND, smoothstep(28, 16, fortDist));
    const face = 4 * t * (1 - t);
    let spur = lerp(h, top, t);
    spur = lerp(spur, terrace(spur, 5), face * 0.5) + face * 5 * fbm(x * 0.11, z * 0.11, 3);
    h = Math.max(h, spur);
  }

  // Ridge climbing from the promontory up to the plateau
  const rdx = SPUR_RIDGE_END.x - SPUR.x;
  const rdz = SPUR_RIDGE_END.z - SPUR.z;
  const u = clamp(((x - SPUR.x) * rdx + (z - SPUR.z) * rdz) / (rdx * rdx + rdz * rdz), 0, 1);
  const ridgeDist = Math.hypot(x - (SPUR.x + u * rdx), z - (SPUR.z + u * rdz)) + 5 * fbm(x * 0.06, z * 0.06, 2);
  if (ridgeDist < 30) {
    const t = smoothstep(28, 10, ridgeDist);
    const ridge = lerp(FORT_GROUND, plateauTop(x, z), u) + 3 * fbm(x * 0.08, z * 0.08, 2);
    h = Math.max(h, lerp(h, ridge, t) + 4 * t * (1 - t) * fbm(x * 0.13, z * 0.13, 2));
  }

  // Pedra do Guilhim
  const gx = (x - GUILHIM.x) / GUILHIM.rx;
  const gz = (z - GUILHIM.z) / GUILHIM.rz;
  const dg = 1 - Math.sqrt(gx * gx + gz * gz) + 0.25 * fbm(x * 0.08, z * 0.08, 3);
  if (dg > -0.3) {
    const rock = 18 * smoothstep(-0.1, 0.6, dg) + 3 * fbm(x * 0.2, z * 0.2, 2) - 2;
    h = Math.max(h, lerp(h, rock, smoothstep(-0.3, 0.1, dg)));
  }

  // Breakwater: rock-armoured mole running out into the bay
  const bwShore = shoreZ(BREAKWATER.x);
  const bw = segmentDistance(x, z, BREAKWATER.x, bwShore + 20, BREAKWATER.x, bwShore - BREAKWATER.length).dist;
  if (bw < 14) {
    h = Math.max(h, 3.2 - (bw / 8) ** 2 * 5 + 0.5 * fbm(x * 0.3, z * 0.3, 2));
  }

  // Cutting through the cliff top for the funicular track
  const { lower, upper } = FUNICULAR;
  const f = segmentDistance(x, z, lower.x, lower.z, upper.x, upper.z);
  if (f.dist < 7 && f.u > 0.02 && f.u < 0.97) {
    const trackY = lerp(lower.y, upper.y, f.u) - 0.6;
    if (h > trackY) h = lerp(h, trackY, smoothstep(7, 4, f.dist));
  }

  return h;
}

/** 0..1 mask of the breakwater crest (for rock coloring) */
export function breakwaterMask(x: number, z: number) {
  const bwShore = shoreZ(BREAKWATER.x);
  const bw = segmentDistance(x, z, BREAKWATER.x, bwShore + 5, BREAKWATER.x, bwShore - BREAKWATER.length).dist;
  return smoothstep(12, 9, bw);
}

/**
 * How much of the open-ocean swell survives at a given seabed height.
 * 1 = deep water (full waves), 0 = dry land / swash zone.
 */
export function shoreAttenuation(seabed: number) {
  return smoothstep(-1, -20, seabed);
}

/**
 * Wave damping over the shallows: the shore attenuation plus a breaking limit
 * keeping wave height below ~0.8x the local depth, so troughs never cut into the seabed.
 * (Keep in sync with FarOcean shader.)
 */
export function waveDamping(seabed: number, amplitude: number) {
  if (seabed >= 0) return 0;
  return shoreAttenuation(seabed) * Math.min(1, (-seabed * 0.8) / Math.max(amplitude, 0.001));
}

/** Whitewater in the surf zone where waves are breaking (keep in sync with FarOcean shader) */
export function surfFoam(attenuation: number, phase: number) {
  const band = smoothstep(0, 0.12, attenuation) * (1 - smoothstep(0.35, 0.9, attenuation));
  // Lines of whitewater rolling in with each wave
  const lines = Math.pow(0.5 + 0.5 * Math.sin(phase * 2), 3);
  return band * (0.35 + 0.65 * lines);
}

/** Square area covered by the shore map texture used by the far-ocean shader */
export const SHORE_MAP_BOUNDS = { minX: -450, minZ: -450, size: 900 };
export const SHORE_MAP_SEABED_RANGE = { min: -50, max: 10 };

/**
 * RGBA texture data: R = wave attenuation, G = seabed height (normalized).
 */
export function createShoreMapData(resolution: number) {
  const data = new Uint8Array(resolution * resolution * 4);
  const { minX, minZ, size } = SHORE_MAP_BOUNDS;
  const { min, max } = SHORE_MAP_SEABED_RANGE;
  for (let j = 0; j < resolution; j++) {
    const z = minZ + ((j + 0.5) / resolution) * size;
    for (let i = 0; i < resolution; i++) {
      const x = minX + ((i + 0.5) / resolution) * size;
      const h = terrainHeight(x, z);
      const idx = (j * resolution + i) * 4;
      data[idx] = Math.round(shoreAttenuation(h) * 255);
      data[idx + 1] = Math.round(clamp((h - min) / (max - min), 0, 1) * 255);
      data[idx + 2] = 0;
      data[idx + 3] = 255;
    }
  }
  return data;
}
