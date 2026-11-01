/**
 * The Nazaré coast, from real geodata (see utils/geodata.ts): EU-DEM land heights,
 * the EMODnet seabed and OSM coastline, land cover and buildings, 1:1 and north-true.
 *
 * World orientation: +X = north, +Z = east (land), -Z = open Atlantic.
 *
 * Landmarks are at their surveyed positions:
 *   - Praia do Norte: the long NNE beach, from the fort up towards Vale Furado
 *   - Sítio: 110 m plateau on a narrow E-W ridge ending at the fort
 *   - Forte de São Miguel Arcanjo and the Farol da Nazaré on the western tip
 *   - Nazaré Canyon: its head reaches the south side of the fort
 *   - Nazaré town on the flats below the Sítio, the Praia da Nazaré crescent, the harbour
 *
 * The DEM has a 25 m resolution, which the thin spur under the fort falls through,
 * so that one piece of rock is modelled here.
 */
import { detailGrid, regionGrid, surfaceClasses, SURFACE, type Building } from './geodata';
import type { SeabedGrid } from './waveField';

export { SURFACE };
export type { Building };

/** Extent of the terrain mesh */
export const TERRAIN_BOUNDS = {
  minX: detailGrid.minX,
  maxX: detailGrid.minX + (detailGrid.nx - 1) * detailGrid.cell,
  minZ: detailGrid.minZ,
  maxZ: detailGrid.minZ + (detailGrid.nz - 1) * detailGrid.cell,
};

export const FORT_POSITION = { x: -335, z: 145 };
export const FORT_GROUND = 38;
// Rock ridge carrying the road from the fort up to the Sítio
const FORT_RIDGE_END = { x: -300, z: 470, height: 66 };

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

function sampleGrid(g: SeabedGrid, x: number, z: number) {
  const fx = clamp((x - g.minX) / g.cell, 0, g.nx - 1.001);
  const fz = clamp((z - g.minZ) / g.cell, 0, g.nz - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const n = j * g.nx + i;
  const h = g.heights;
  return (h[n] * (1 - u) + h[n + 1] * u) * (1 - v) + (h[n + g.nx] * (1 - u) + h[n + g.nx + 1] * u) * v;
}

/** Height straight from the baked grids, with no modelled detail on top */
export function surveyedHeight(x: number, z: number) {
  const b = TERRAIN_BOUNDS;
  const inside = x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  return sampleGrid(inside ? detailGrid : regionGrid, x, z);
}

/** Raw land-cover byte at a point (see SURFACE) */
export function surfaceAt(x: number, z: number) {
  const i = Math.round((x - detailGrid.minX) / detailGrid.cell);
  const j = Math.round((z - detailGrid.minZ) / detailGrid.cell);
  if (i < 0 || j < 0 || i >= detailGrid.nx || j >= detailGrid.nz) return 0;
  return surfaceClasses[j * detailGrid.nx + i];
}

/** Largo de Nossa Senhora da Nazaré, the square of the Sítio east of the Santuário */
export const LARGO = { minX: -316, maxX: -214, minZ: 884, maxZ: 1040 };

export const SANCTUARY = { x: -228, z: 855 };
export const ERMIDA = { x: -320, z: 914 };

/** Ascensor da Nazaré: 318 m of track from the town to the Sítio */
const FUNICULAR_LOWER = { x: -518, z: 1144 };
const FUNICULAR_UPPER = { x: -251, z: 1058 };
export const FUNICULAR = {
  lower: { ...FUNICULAR_LOWER, y: surveyedHeight(FUNICULAR_LOWER.x, FUNICULAR_LOWER.z) + 1 },
  upper: { ...FUNICULAR_UPPER, y: surveyedHeight(FUNICULAR_UPPER.x, FUNICULAR_UPPER.z) },
};

/** Harbour entrance lights on the moles (OSM), red to port entering from the sea */
export const HARBOUR_LIGHTS = [
  { x: -1856, z: 883, color: '#c22a20' },
  { x: -1964, z: 775, color: '#2fa84a' },
];

/** Waterline Z on the town side for a given X, marching in from the sea over the bay */
export function townShoreZ(x: number) {
  let z = 1500;
  while (z > 500 && surveyedHeight(x, z) > 0) z -= 4;
  return z;
}

/** Terrain height (meters above sea level, negative = seabed) */
export function terrainHeight(x: number, z: number) {
  let h = surveyedHeight(x, z);

  // Weathered ground below the DEM's resolution; beaches and the sea stay smooth
  const land = smoothstep(2, 14, h);
  if (land > 0) h += land * 1.4 * fbm(x * 0.05, z * 0.05, 3);

  // Rock ridge out to the fort, flattened into the courtyard at its end
  const { dist, u } = segmentDistance(x, z, FORT_POSITION.x, FORT_POSITION.z, FORT_RIDGE_END.x, FORT_RIDGE_END.z);
  if (dist < 80) {
    const rough = 6 * fbm(x * 0.03, z * 0.03, 3);
    const width = lerp(34, 60, u) + rough;
    const top = lerp(FORT_GROUND, FORT_RIDGE_END.height, smoothstep(0.06, 1, u));
    const rock = top * smoothstep(width + 26, width - 4, dist);
    const crag = rock + 7 * smoothstep(0.2, 0.8, rock / top) * (1 - rock / top) * fbm(x * 0.09, z * 0.09, 3);
    h = Math.max(h, crag);
    const fortDist = Math.hypot(x - FORT_POSITION.x, z - FORT_POSITION.z);
    h = lerp(h, FORT_GROUND, smoothstep(34, 22, fortDist));
  }

  // Cutting through the cliff top for the funicular track
  const { lower, upper } = FUNICULAR;
  const f = segmentDistance(x, z, lower.x, lower.z, upper.x, upper.z);
  if (f.dist < 8 && f.u > 0.02 && f.u < 0.97) {
    const trackY = lerp(lower.y, upper.y, f.u) - 0.6;
    if (h > trackY) h = lerp(h, trackY, smoothstep(8, 4, f.dist));
  }

  return h;
}

/** Square area of the animated ocean, also covered by the shore map texture */
export const OCEAN_BOUNDS = { minX: -2400, minZ: -2400, size: 4800 };
export const SHORE_MAP_SEABED_RANGE = { min: -50, max: 10 };

/** RGBA texture data: G = seabed height (normalized). Fine depths for the far-ocean shader. */
export function createShoreMapData(resolution: number) {
  const data = new Uint8Array(resolution * resolution * 4);
  const { minX, minZ, size } = OCEAN_BOUNDS;
  const { min, max } = SHORE_MAP_SEABED_RANGE;
  for (let j = 0; j < resolution; j++) {
    const z = minZ + ((j + 0.5) / resolution) * size;
    for (let i = 0; i < resolution; i++) {
      const x = minX + ((i + 0.5) / resolution) * size;
      const idx = (j * resolution + i) * 4;
      data[idx + 1] = Math.round(clamp((surveyedHeight(x, z) - min) / (max - min), 0, 1) * 255);
      data[idx + 3] = 255;
    }
  }
  return data;
}
