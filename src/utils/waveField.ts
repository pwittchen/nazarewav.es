/**
 * Swell propagation over the real Nazaré bathymetry.
 *
 * For one swell direction and period this solves geometric optics on the regional
 * seabed grid, the same approach as the 2026 EGUsphere study of the canyon:
 *   - rays, refracted by the depth-dependent phase speed, give the energy density.
 *     Over the canyon rim the speed jump is strong enough to turn rays back onto the
 *     shelf, which builds the focus at Praia do Norte and the shadow over the canyon.
 *   - an eikonal solve gives the phase, so crests bend round to follow the shore.
 *   - shoaling from linear wave theory (group velocity).
 * The canyon needs no hand-placed amplification: long periods refract strongly over
 * it and short ones (< ~7 s) barely notice.
 *
 * This module is pure so that it can run outside the renderer.
 */

export interface SeabedGrid {
  minX: number;
  minZ: number;
  cell: number;
  nx: number;
  nz: number;
  heights: Float32Array; // Metres above sea level, negative = seabed. Index: j * nx + i (i: X, j: Z)
}

export interface WaveField {
  grid: SeabedGrid;
  /** Phase ahead of the offshore plane wave (radians) */
  phase: Float32Array;
  /** Local wave height / offshore height: shoaling x refraction, before depth-limited breaking */
  gain: Float32Array;
  k0: number;       // Deep-water wavenumber
  omega: number;    // Angular frequency
  dirX: number;     // Unit travel direction of the offshore swell
  dirZ: number;
}

export const GRAVITY = 9.81;
const MIN_DEPTH = 0.5;
const SPREAD = [-12, -6, 0, 6, 12]; // Degrees: real swell is not a single direction
const RAY_SPACING = 12;             // Metres between rays at the offshore boundary
const RAY_STEP = 15;                // Metres per integration step
const MAX_GAIN = 4;

/** Wavenumber for the given depth from the linear dispersion relation (Fenton & McKee, 1990) */
export function wavenumber(omega: number, depth: number) {
  const k0 = (omega * omega) / GRAVITY;
  const x = k0 * depth;
  const c = Math.pow(1 / Math.tanh(Math.pow(x, 0.75)), 2 / 3);
  return k0 * c;
}

/** Depth lookup table (geometric spacing) so the solvers avoid repeated pow/tanh */
function dispersionTable(omega: number) {
  const size = 256;
  const maxLog = Math.log(4000 / MIN_DEPTH);
  const k = new Float32Array(size);
  const cg = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const h = MIN_DEPTH * Math.exp((i / (size - 1)) * maxLog);
    k[i] = wavenumber(omega, h);
    const kh = k[i] * h;
    const n = kh > 20 ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
    cg[i] = (n * omega) / k[i];
  }
  const index = (depth: number) => {
    const t = (Math.log(Math.max(depth, MIN_DEPTH) / MIN_DEPTH) / maxLog) * (size - 1);
    return t < size - 1 ? t : size - 1.001;
  };
  return { k, cg, index };
}

function blur(data: Float32Array, nx: number, nz: number, passes: number) {
  const tmp = new Float32Array(data.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        tmp[row + i] = (data[row + (i > 0 ? i - 1 : 0)] + 2 * data[row + i] + data[row + (i < nx - 1 ? i + 1 : i)]) / 4;
      }
    }
    for (let j = 0; j < nz; j++) {
      const up = (j > 0 ? j - 1 : 0) * nx;
      const down = (j < nz - 1 ? j + 1 : j) * nx;
      const row = j * nx;
      for (let i = 0; i < nx; i++) data[row + i] = (tmp[up + i] + 2 * tmp[row + i] + tmp[down + i]) / 4;
    }
  }
}

/** Path density of the rays of one direction, relative to the offshore density */
function traceRays(grid: SeabedGrid, kTable: ReturnType<typeof dispersionTable>, omega: number, dirDeg: number, out: Float32Array) {
  const { minX, minZ, cell, nx, nz, heights } = grid;
  const a = (dirDeg * Math.PI) / 180;
  const dx0 = Math.sin(a);
  const dz0 = Math.cos(a);
  const sizeX = (nx - 1) * cell;
  const sizeZ = (nz - 1) * cell;
  const cx = minX + sizeX / 2;
  const cz = minZ + sizeZ / 2;
  const half = Math.hypot(sizeX, sizeZ) / 2;
  const count = Math.ceil((2 * half) / RAY_SPACING);
  const maxSteps = Math.ceil((2.5 * half) / RAY_STEP);
  const weight = (RAY_SPACING * RAY_STEP) / (cell * cell);

  const { k, index } = kTable;
  // Phase speed lookup on the depth grid
  const logC = new Float32Array(nx * nz);
  for (let n = 0; n < logC.length; n++) {
    const t = index(-heights[n]);
    const t0 = Math.floor(t);
    logC[n] = Math.log(omega / (k[t0] + (k[t0 + 1] - k[t0]) * (t - t0)));
  }

  for (let r = 0; r < count; r++) {
    const s = -half + (r + 0.5) * RAY_SPACING;
    let x = cx - dx0 * half + -dz0 * s;
    let z = cz - dz0 * half + dx0 * s;
    let tx = dx0;
    let tz = dz0;
    for (let step = 0; step < maxSteps; step++) {
      x += tx * RAY_STEP;
      z += tz * RAY_STEP;
      const fi = (x - minX) / cell;
      const fj = (z - minZ) / cell;
      const i = Math.floor(fi);
      const j = Math.floor(fj);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) {
        // Rays start outside the grid along the diagonal, keep going until they enter
        if (step * RAY_STEP < 1.2 * half) continue;
        break;
      }
      const idx = j * nx + i;
      if (heights[idx] > 0) break;
      const u = fi - i;
      const v = fj - j;
      const c00 = logC[idx], c10 = logC[idx + 1], c01 = logC[idx + nx], c11 = logC[idx + nx + 1];
      // Bilinear gradient of ln c
      const gx = ((c10 - c00) * (1 - v) + (c11 - c01) * v) / cell;
      const gz = ((c01 - c00) * (1 - u) + (c11 - c10) * u) / cell;
      // Ray curvature: the ray bends towards slower water
      const dn = -tz * gx + tx * gz; // Gradient along the ray normal (-tz, tx)
      const turn = -dn * RAY_STEP;
      const nxTx = tx + -tz * turn;
      const nzTz = tz + tx * turn;
      const len = Math.hypot(nxTx, nzTz);
      tx = nxTx / len;
      tz = nzTz / len;
      // Bilinear deposit
      out[idx] += weight * (1 - u) * (1 - v);
      out[idx + 1] += weight * u * (1 - v);
      out[idx + nx] += weight * (1 - u) * v;
      out[idx + nx + 1] += weight * u * v;
    }
  }
}

/** Fast-sweeping eikonal solve: phase = first arrival travel "distance" through k(depth) */
function solvePhase(grid: SeabedGrid, kTable: ReturnType<typeof dispersionTable>, dirX: number, dirZ: number, k0: number) {
  const { minX, minZ, cell, nx, nz, heights } = grid;
  const { k, index } = kTable;
  const S = new Float32Array(nx * nz).fill(1e9);
  const slow = new Float32Array(nx * nz);
  for (let n = 0; n < slow.length; n++) {
    if (heights[n] > 0) { slow[n] = -1; continue; }
    const t = index(-heights[n]);
    const t0 = Math.floor(t);
    slow[n] = k[t0] + (k[t0 + 1] - k[t0]) * (t - t0);
  }
  // The incoming plane wave sets the upstream edges
  const plane = (i: number, j: number) => k0 * (dirX * (minX + i * cell) + dirZ * (minZ + j * cell));
  for (let i = 0; i < nx; i++) {
    if (dirZ > 0 && slow[i] > 0) S[i] = plane(i, 0);
    if (dirZ < 0 && slow[(nz - 1) * nx + i] > 0) S[(nz - 1) * nx + i] = plane(i, nz - 1);
  }
  for (let j = 0; j < nz; j++) {
    if (dirX > 0 && slow[j * nx] > 0) S[j * nx] = plane(0, j);
    if (dirX < 0 && slow[j * nx + nx - 1] > 0) S[j * nx + nx - 1] = plane(nx - 1, j);
  }

  const update = (i: number, j: number) => {
    const n = j * nx + i;
    const f = slow[n];
    if (f < 0) return;
    const a = Math.min(i > 0 ? S[n - 1] : 1e9, i < nx - 1 ? S[n + 1] : 1e9);
    const b = Math.min(j > 0 ? S[n - nx] : 1e9, j < nz - 1 ? S[n + nx] : 1e9);
    if (a >= 1e9 && b >= 1e9) return;
    const fh = f * cell;
    let s: number;
    if (Math.abs(a - b) >= fh) {
      s = Math.min(a, b) + fh;
    } else {
      s = (a + b + Math.sqrt(2 * fh * fh - (a - b) * (a - b))) / 2;
    }
    if (s < S[n]) S[n] = s;
  };
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) update(i, j);
    for (let j = 0; j < nz; j++) for (let i = nx - 1; i >= 0; i--) update(i, j);
    for (let j = nz - 1; j >= 0; j--) for (let i = 0; i < nx; i++) update(i, j);
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) update(i, j);
  }

  // Keep the difference from the plane wave: small, smooth, and safe in a half-float texture.
  // Land inherits its neighbours so that the bilinear lookup stays continuous at the shore.
  const phase = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      phase[n] = S[n] < 1e8 ? S[n] - plane(i, j) : NaN;
    }
  }
  for (let pass = 0; pass < 12; pass++) {
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const n = j * nx + i;
        if (!Number.isNaN(phase[n])) continue;
        let sum = 0, c = 0;
        for (const m of [n - 1, n + 1, n - nx, n + nx]) {
          if (!Number.isNaN(phase[m])) { sum += phase[m]; c++; }
        }
        if (c) phase[n] = sum / c;
      }
    }
  }
  for (let n = 0; n < phase.length; n++) if (Number.isNaN(phase[n])) phase[n] = 0;
  return phase;
}

/**
 * Solves the swell over the seabed.
 * @param fromDeg compass bearing the swell comes from (Nazaré's best: ~290-315°)
 * @param period  peak period in seconds
 */
export function computeWaveField(grid: SeabedGrid, fromDeg: number, period: number): WaveField {
  const { nx, nz, heights } = grid;
  const omega = (2 * Math.PI) / period;
  const k0 = (omega * omega) / GRAVITY;
  // World: +X = north, +Z = east. A swell from bearing b travels along -(cos b, sin b).
  const dir = (from: number) => ((270 - from + 360) % 360);
  const a = (dir(fromDeg) * Math.PI) / 180;
  const dirX = Math.sin(a);
  const dirZ = Math.cos(a);

  const table = dispersionTable(omega);

  const density = new Float32Array(nx * nz);
  for (const spread of SPREAD) traceRays(grid, table, omega, dir(fromDeg + spread), density);
  for (let n = 0; n < density.length; n++) density[n] /= SPREAD.length;
  blur(density, nx, nz, 3);

  const cg0 = (GRAVITY / omega) / 2;
  const gain = new Float32Array(nx * nz);
  for (let n = 0; n < gain.length; n++) {
    if (heights[n] > 0) continue;
    const t = table.index(-heights[n]);
    const t0 = Math.floor(t);
    const cg = table.cg[t0] + (table.cg[t0 + 1] - table.cg[t0]) * (t - t0);
    const g = Math.sqrt((density[n] * cg0) / cg);
    gain[n] = g < MAX_GAIN ? g : MAX_GAIN;
  }
  blur(gain, nx, nz, 1);

  return { grid, phase: solvePhase(grid, table, dirX, dirZ, k0), gain, k0, omega, dirX, dirZ };
}

/**
 * A wave breaks when its height reaches this fraction of the depth. The textbook 0.78
 * holds on flat bottoms; for long-period swell (H/gT² ~ 0.005) on this ~1:40 shelf
 * Weggel's (1972) breaker index gives about 1.05-1.1.
 */
export const BREAKER_RATIO = 1.05;
/** Waves per set: sets of bigger waves roll through every SET_LENGTH periods */
export const SET_LENGTH = 12;

/** Offshore-to-local swell, written once here and mirrored in the FarOcean shader */
export function swellHeight(height: number, gain: number, focus: number, setPhase: number) {
  return height * (1 + (gain - 1) * focus) * (0.82 + 0.43 * Math.sin(setPhase));
}

export interface SwellShape {
  y: number;       // Surface elevation
  breaking: number; // 0 unbroken .. 1 fully broken
  crest: number;    // 0 trough .. 1 top of the crest
}

/**
 * Surface at one point: shoaling crests peak up and pitch forward as they near the
 * depth limit, and the height then stays capped at the breaker ratio.
 */
export function swellSurface(theta: number, unlimited: number, depth: number, out: SwellShape) {
  const limit = BREAKER_RATIO * Math.max(depth, 0);
  const ratio = limit > 0 ? unlimited / limit : 8;
  const height = unlimited / Math.pow(1 + ratio * ratio * ratio * ratio, 0.25);
  const t = Math.min(1, Math.max(0, (ratio - 0.45) / 0.55));
  const shoal = t * t * (3 - 2 * t);
  const crest = Math.pow(0.5 + 0.5 * Math.sin(theta - shoal * Math.cos(theta)), 1 + 4.5 * shoal);
  out.y = (height / 2) * (2 * crest - 1 + 0.45 * shoal);
  out.crest = crest;
  out.breaking = Math.min(1, Math.max(0, (ratio - 0.85) / 0.45));
  return out;
}
