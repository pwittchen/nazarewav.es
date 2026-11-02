/**
 * Swell propagation over the real Nazaré bathymetry.
 *
 * For one swell direction and period this follows Hope et al., "Focusing of Swell at
 * the Nazaré Submarine Canyon" (EGUsphere, 2026, docs/egusphere-2026-2778.pdf): the
 * waves are not channelled up the canyon but refracted and reflected along its northern
 * edge, and the reflection interferes with the incident swell in beams onto Praia do Norte.
 *   - rays, refracted by the depth-dependent phase speed, give the energy density. The
 *     shelf slopes down towards the rim, turning rays so they meet it more obliquely.
 *   - at the rim (the 50 m contour, where the study put its reflecting boundary) rays
 *     split by the reflection coefficient of a trench (plane-wave approximation of Kirby
 *     & Dalrymple, 1983): long-period swell at oblique incidence is reflected, totally
 *     above the critical angle; short periods (< ~7 s) and near-normal incidence pass.
 *     That leaves the shadow over the canyon that the study's buoys and cameras measured.
 *   - an eikonal solve gives the incident phase, so crests bend round to follow the shore.
 *     Reflected rays carry their own phase, and the two are summed coherently near the
 *     rim, incoherently further away (the crossing pattern decorrelates with distance).
 *   - shoaling from linear wave theory (group velocity).
 * The canyon needs no hand-placed amplification.
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
  /** Local wave height / offshore height: shoaling x refraction, incident and reflected energy, before breaking */
  gain: Float32Array;
  /**
   * Coherent part of the wave reflected off the canyon edge, relative to the incident wave
   * (complex amplitude ratio, magnitude < 1). Zero away from the rim. See crossedSwell().
   */
  crossRe: Float32Array;
  crossIm: Float32Array;
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
/** Standard deviation of SPREAD in radians: sets how far from the rim the crossing pattern stays coherent */
const SPREAD_SIGMA = Math.sqrt(SPREAD.reduce((s, d) => s + d * d, 0) / SPREAD.length) * (Math.PI / 180);

// Canyon edge, after the boundary of the study's BEM model and the trench of its Fig. 4
const EDGE_DEPTH = 50;     // Contour the reflecting boundary follows
const EDGE_SHELF = 90;     // Metres back onto the shelf where the shelf depth h1 is read
const EDGE_CANYON = 150;   // Metres into the canyon where the canyon depth h2 is read
const CANYON_WIDTH = 250;  // Trench width L
const STEEP_SLOPE = 0.05;  // A ray turned back where the seabed is steeper than this (~3°, above the shelf's 2.4°) was reflected too
const MAX_BOUNCES = 3;
const MIN_WEIGHT = 0.02;   // Reflected rays weaker than this are dropped
const MAX_CROSS = 0.95;    // Keeps the combined phase continuous where the reflection is as strong as the swell

/** Wavenumber for the given depth from the linear dispersion relation (Fenton & McKee, 1990) */
export function wavenumber(omega: number, depth: number) {
  const k0 = (omega * omega) / GRAVITY;
  const x = k0 * depth;
  const c = Math.pow(1 / Math.tanh(Math.pow(x, 0.75)), 2 / 3);
  return k0 * c;
}

/** Group velocity over phase velocity, n = Cg / C */
function groupRatio(kh: number) {
  return kh > 20 ? 0.5 : 0.5 * (1 + (2 * kh) / Math.sinh(2 * kh));
}

/**
 * Complex reflection coefficient R = a_r / a_i of a symmetric trench, shelf depth h1,
 * canyon depth h2, width L, for a wave meeting its edge at the given incidence angle
 * (cosine, 1 = head on): the plane-wave approximation of Kirby & Dalrymple (1983) used
 * by the 2026 study. The along-edge wavenumber is conserved; past the critical angle the
 * cross-canyon wavenumber turns imaginary and the wave is totally reflected (|R| -> 1,
 * the rest tunnels through as an evanescent wave).
 */
export function trenchReflection(omega: number, h1: number, h2: number, cosInc: number, width = CANYON_WIDTH) {
  const k1 = wavenumber(omega, h1);
  const k2 = wavenumber(omega, h2);
  const cos = Math.min(1, Math.max(0, cosInc));
  const along = k1 * Math.sqrt(1 - cos * cos);
  // Matching surface elevation and mass flux (C Cg dη/dx) at each wall: α = C Cg m
  const ccg = (k: number, h: number) => ((omega / k) ** 2) * groupRatio(k * h);
  const a1 = ccg(k1, h1) * k1 * cos;
  const m2sq = k2 * k2 - along * along;
  const m2 = Math.sqrt(Math.abs(m2sq));
  // α2 is real for a propagating wave over the canyon, imaginary for an evanescent one
  const a2re = m2sq >= 0 ? ccg(k2, h2) * m2 : 0;
  const a2im = m2sq >= 0 ? 0 : ccg(k2, h2) * m2;
  // Single step: Rs = (α1 - α2) / (α1 + α2)
  const den = (a1 + a2re) ** 2 + a2im ** 2;
  const rsRe = ((a1 - a2re) * (a1 + a2re) - a2im * a2im) / den;
  const rsIm = (-a2im * (a1 + a2re) - (a1 - a2re) * a2im) / den;
  // Both walls: R = Rs (1 - E) / (1 - Rs² E), E = exp(2i m2 L), the far wall reflecting with -Rs
  const eRe = m2sq >= 0 ? Math.cos(2 * m2 * width) : Math.exp(-2 * m2 * width);
  const eIm = m2sq >= 0 ? Math.sin(2 * m2 * width) : 0;
  const nRe = rsRe * (1 - eRe) + rsIm * eIm;
  const nIm = rsIm * (1 - eRe) - rsRe * eIm;
  const rs2Re = rsRe * rsRe - rsIm * rsIm;
  const rs2Im = 2 * rsRe * rsIm;
  const dRe = 1 - (rs2Re * eRe - rs2Im * eIm);
  const dIm = -(rs2Re * eIm + rs2Im * eRe);
  const dd = dRe * dRe + dIm * dIm;
  if (dd < 1e-12) return { re: rsRe, im: rsIm }; // Rs² E -> 1 only at grazing incidence, where R -> Rs
  return { re: (nRe * dRe + nIm * dIm) / dd, im: (nIm * dRe - nRe * dIm) / dd };
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
    cg[i] = (groupRatio(k[i] * h) * omega) / k[i];
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

/** What the rays leave on the grid, summed over the directions of the spread */
interface RayDeposits {
  incident: Float32Array;  // Path density of rays not (yet) reflected by the canyon edge
  reflected: Float32Array; // Path density of reflected rays
  // Phase of the reflected rays relative to the incident wave (central direction only): sum of
  // weight x coherence x exp(iΔ), and of the weight, so that |mean| < 1 where branches disagree
  // or the reflection has travelled too far to stay in step with the swell
  phaseRe: Float32Array;
  phaseIm: Float32Array;
  phaseWeight: Float32Array;
}

interface Ray {
  x: number; z: number;
  tx: number; tz: number;
  weight: number;
  reflected: boolean;
  distance: number; // Since the reflection
  phase: number;    // Absolute phase, tracked once reflected
  bounces: number;
  depth: number;    // At the previous step
  inside: boolean;  // Has entered the grid
}

/**
 * Traces the rays of one direction. Rays refract with the depth-dependent phase speed and
 * split where they cross the canyon edge going deeper: the reflected part, |R|², turns back
 * onto the shelf with its own phase; the transmitted part carries on over the canyon.
 * @param incidentPhase absolute phase of the incident wave on the grid, to anchor the phase
 *   of reflected rays; only passed for the central direction
 */
function traceRays(grid: SeabedGrid, kTable: ReturnType<typeof dispersionTable>, omega: number, dirDeg: number,
  out: RayDeposits, incidentPhase: Float64Array | null) {
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

  const sample = (field: ArrayLike<number>, x: number, z: number) => {
    const fi = Math.min(nx - 1.001, Math.max(0, (x - minX) / cell));
    const fj = Math.min(nz - 1.001, Math.max(0, (z - minZ) / cell));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, n = j * nx + i;
    return (field[n] * (1 - u) + field[n + 1] * u) * (1 - v) + (field[n + nx] * (1 - u) + field[n + nx + 1] * u) * v;
  };
  const depthAt = (x: number, z: number) => -sample(heights, x, z);

  const stack: Ray[] = [];
  for (let r = 0; r < count; r++) {
    const s = -half + (r + 0.5) * RAY_SPACING;
    stack.push({
      x: cx - dx0 * half + -dz0 * s, z: cz - dz0 * half + dx0 * s, tx: dx0, tz: dz0,
      weight: 1, reflected: false, distance: 0, phase: 0, bounces: 0, depth: 0, inside: false,
    });
    while (stack.length) march(stack.pop()!);
  }

  function march(ray: Ray) {
    let { x, z, tx, tz, weight: w, reflected, distance, phase } = ray;
    let { depth: lastDepth, inside } = ray;
    for (let step = 0; step < maxSteps; step++) {
      const px = x, pz = z;
      x += tx * RAY_STEP;
      z += tz * RAY_STEP;
      const fi = (x - minX) / cell;
      const fj = (z - minZ) / cell;
      const i = Math.floor(fi);
      const j = Math.floor(fj);
      if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) {
        // Rays start outside the grid along the diagonal, keep going until they enter
        if (!inside && step * RAY_STEP < 1.2 * half) continue;
        return;
      }
      const idx = j * nx + i;
      if (heights[idx] > 0) return;
      const u = fi - i;
      const v = fj - j;
      const c00 = logC[idx], c10 = logC[idx + 1], c01 = logC[idx + nx], c11 = logC[idx + nx + 1];
      // Bilinear gradient of ln c
      const gx = ((c10 - c00) * (1 - v) + (c11 - c01) * v) / cell;
      const gz = ((c01 - c00) * (1 - u) + (c11 - c10) * u) / cell;
      // Depth and its gradient (pointing deeper)
      const h00 = heights[idx], h10 = heights[idx + 1], h01 = heights[idx + nx], h11 = heights[idx + nx + 1];
      const depth = -((h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v);
      const sx = -((h10 - h00) * (1 - v) + (h11 - h01) * v) / cell;
      const sz = -((h01 - h00) * (1 - u) + (h11 - h10) * u) / cell;
      const slope = Math.hypot(sx, sz);
      // Reflected rays carry their phase: k ds, with k = omega / c
      const kHere = omega / Math.exp((c00 + c10 + c01 + c11) / 4);
      const lastPhase = phase;
      if (reflected) {
        phase += kHere * RAY_STEP;
        distance += RAY_STEP;
      }

      if (inside && lastDepth < EDGE_DEPTH && depth >= EDGE_DEPTH && slope > 1e-3 && ray.bounces < MAX_BOUNCES) {
        // Crossing the canyon edge into deeper water: split by the trench reflection coefficient
        const ex = sx / slope, ez = sz / slope;
        const cosInc = tx * ex + tz * ez;
        const h1 = Math.max(2, Math.min(lastDepth, depthAt(px - ex * EDGE_SHELF, pz - ez * EDGE_SHELF)));
        const h2 = Math.max(depth, depthAt(x + ex * EDGE_CANYON, z + ez * EDGE_CANYON));
        if (cosInc > 0 && h2 > 1.5 * h1) {
          const R = trenchReflection(omega, h1, h2, cosInc);
          const energy = R.re * R.re + R.im * R.im;
          if (w * energy > MIN_WEIGHT) {
            stack.push({
              x: px, z: pz, tx: tx - 2 * cosInc * ex, tz: tz - 2 * cosInc * ez,
              weight: w * energy, reflected: true, distance: 0,
              phase: incidentPhase ? (reflected ? lastPhase : sample(incidentPhase, px, pz)) + Math.atan2(R.im, R.re) : 0,
              bounces: ray.bounces + 1, depth: lastDepth, inside: true,
            });
          }
          w *= 1 - energy;
          if (w < MIN_WEIGHT * 0.1) return;
        }
      }
      inside = true;
      lastDepth = depth;

      // Ray curvature: the ray bends towards slower water
      const descent = tx * sx + tz * sz;
      const dn = -tz * gx + tx * gz; // Gradient along the ray normal (-tz, tx)
      const turn = -dn * RAY_STEP;
      const nxTx = tx + -tz * turn;
      const nzTz = tz + tx * turn;
      const len = Math.hypot(nxTx, nzTz);
      tx = nxTx / len;
      tz = nzTz / len;

      // A ray that refraction turns back up a steep slope is reflected as well (total internal
      // reflection on a smooth rim); it picks up a quarter period at the turning point
      if (!reflected && slope > STEEP_SLOPE && descent > 0 && tx * sx + tz * sz <= 0) {
        reflected = true;
        distance = 0;
        if (incidentPhase) phase = sample(incidentPhase, x, z) - Math.PI / 2;
      }

      // Bilinear deposit
      const wd = weight * w;
      const w00 = wd * (1 - u) * (1 - v), w10 = wd * u * (1 - v), w01 = wd * (1 - u) * v, w11 = wd * u * v;
      const density = reflected ? out.reflected : out.incident;
      density[idx] += w00; density[idx + 1] += w10; density[idx + nx] += w01; density[idx + nx + 1] += w11;
      if (reflected && incidentPhase) {
        // The study sums incident and reflected coherently per wave component and incoherently
        // across components: over the spread of directions the two drift out of step with the
        // distance from the reflection, the faster the shorter the wave, L = λ / (2σ)
        const lag = (distance * kHere * SPREAD_SIGMA) / Math.PI;
        const coherence = Math.exp(-lag * lag);
        const delta = phase - sample(incidentPhase, x, z);
        const c = coherence * Math.cos(delta), s = coherence * Math.sin(delta);
        const re = out.phaseRe, im = out.phaseIm, pw = out.phaseWeight;
        re[idx] += w00 * c; re[idx + 1] += w10 * c; re[idx + nx] += w01 * c; re[idx + nx + 1] += w11 * c;
        im[idx] += w00 * s; im[idx + 1] += w10 * s; im[idx + nx] += w01 * s; im[idx + nx + 1] += w11 * s;
        pw[idx] += w00; pw[idx + 1] += w10; pw[idx + nx] += w01; pw[idx + nx + 1] += w11;
      }
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
  const phase = solvePhase(grid, table, dirX, dirZ, k0);
  const incidentPhase = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      incidentPhase[j * nx + i] = phase[j * nx + i] + k0 * (dirX * (grid.minX + i * grid.cell) + dirZ * (grid.minZ + j * grid.cell));
    }
  }

  const size = nx * nz;
  const rays: RayDeposits = {
    incident: new Float32Array(size), reflected: new Float32Array(size),
    phaseRe: new Float32Array(size), phaseIm: new Float32Array(size), phaseWeight: new Float32Array(size),
  };
  for (const spread of SPREAD) traceRays(grid, table, omega, dir(fromDeg + spread), rays, spread === 0 ? incidentPhase : null);
  for (const density of [rays.incident, rays.reflected]) {
    for (let n = 0; n < size; n++) density[n] /= SPREAD.length;
    blur(density, nx, nz, 3);
  }
  // Light blur only: the phase pattern repeats every few cells
  for (const a of [rays.phaseRe, rays.phaseIm, rays.phaseWeight]) blur(a, nx, nz, 1);

  const cg0 = (GRAVITY / omega) / 2;
  const gain = new Float32Array(size);
  const crossRe = new Float32Array(size);
  const crossIm = new Float32Array(size);
  for (let n = 0; n < size; n++) {
    if (heights[n] > 0) continue;
    const t = table.index(-heights[n]);
    const t0 = Math.floor(t);
    const cg = table.cg[t0] + (table.cg[t0 + 1] - table.cg[t0]) * (t - t0);
    const incident = rays.incident[n];
    const reflected = rays.reflected[n];
    // Mean energy, incident and reflected summed incoherently
    const g = Math.sqrt(((incident + reflected) * cg0) / cg);
    gain[n] = g < MAX_GAIN ? g : MAX_GAIN;

    const weight = rays.phaseWeight[n];
    if (reflected < 1e-4 || weight < 1e-4) continue;
    const ratio = incident > 1e-6 ? Math.min(MAX_CROSS, Math.sqrt(reflected / incident)) : MAX_CROSS;
    const amplitude = ratio / weight;
    crossRe[n] = rays.phaseRe[n] * amplitude;
    crossIm[n] = rays.phaseIm[n] * amplitude;
  }
  blur(gain, nx, nz, 1);

  return { grid, phase, gain, crossRe, crossIm, k0, omega, dirX, dirZ };
}

export interface CrossedSwell {
  gain: number;     // Local height / offshore height, with the interference of the reflection
  shift: number;    // Phase of the combined wave ahead of the incident one (radians)
  crossing: number; // 0 one wave train .. ~1 two trains crossing at equal height
}

/**
 * The incident and reflected waves summed, a + a_r e^{iΔ}, as one wave of local height and
 * phase: peaks where they meet in phase, gaps between, the beams towards Praia do Norte.
 * Normalized so that the mean energy stays that of `gain`. Mirrored in the FarOcean shader.
 */
export function crossedSwell(gain: number, crossRe: number, crossIm: number, out: CrossedSwell) {
  const re = 1 + crossRe;
  const mag2 = crossRe * crossRe + crossIm * crossIm;
  out.gain = gain * Math.sqrt((re * re + crossIm * crossIm) / (1 + mag2));
  out.shift = Math.atan2(crossIm, re);
  out.crossing = Math.sqrt(mag2);
  return out;
}

/**
 * A wave breaks when its height reaches this fraction of the depth. The textbook 0.78
 * holds on flat bottoms; for long-period swell (H/gT² ~ 0.005) on this ~1:40 shelf
 * Weggel's (1972) breaker index gives about 1.05-1.1.
 */
export const BREAKER_RATIO = 1.05;
/**
 * Crossing seas, as the incident and reflected swell are at the peak, hold steeper and
 * higher crests before they break than one wave train (McAllister et al., Nature 2024,
 * cited by the 2026 study for Nazaré's pyramid peaks; up to ~80% steeper in deep water).
 * Here a modest share of that raises the depth limit where two trains cross at equal height.
 */
export const CROSSING_BREAKER = 0.25;
/** Waves per set: sets of bigger waves roll through every SET_LENGTH periods */
export const SET_LENGTH = 12;
/** Distinct sets before the sequence repeats (~30 min at 18 s) */
export const SET_CYCLE = 8;
/** omega * t is wrapped at this, a whole cycle of sets, so that the envelope stays continuous */
export const SET_WRAP = 2 * Math.PI * SET_LENGTH * SET_CYCLE;

/**
 * Set heights relative to the significant height Hs, as a real sea state has them.
 * Individual waves follow the Rayleigh distribution, P(H > h) = exp(-2 (h / Hs)²): each
 * set peaks at a quantile of the biggest of its SET_LENGTH waves, the waves in between
 * swell up to it from the lull, and the whole cycle is scaled so that the mean of its
 * highest third is exactly Hs. That leaves the mean wave at 0.62 Hs and the biggest at
 * 1.52 Hs, the Rayleigh values (0.625, and sqrt(ln 96 / 2) = 1.51 for 96 waves).
 */
const SET_SPREAD = 2;
const SET_ORDER = [5, 3, 1, 6, 0, 4, 2, 7]; // Rank of each set in the cycle: big and small ones mixed
export const { SET_PEAKS, SET_LULL } = (() => {
  const quantile = (p: number) => Math.sqrt(-Math.log(1 - Math.pow(p, 1 / SET_LENGTH)) / 2);
  const ranked = SET_ORDER.map((r) => 1 + (quantile((r + 0.5) / SET_CYCLE) - 1) * SET_SPREAD);
  const lull = 0.35;
  const heights: number[] = [];
  for (const peak of ranked) {
    for (let m = 0; m < SET_LENGTH; m++) heights.push(lull + (peak - lull) * Math.sin((Math.PI * (m + 0.5)) / SET_LENGTH) ** 2);
  }
  heights.sort((a, b) => b - a);
  const third = heights.slice(0, Math.round(heights.length / 3));
  const hs = third.reduce((a, b) => a + b) / third.length;
  return { SET_PEAKS: ranked.map((p) => p / hs), SET_LULL: lull / hs };
})();

/** Height of the waves at this phase relative to Hs: the set they belong to and where in it */
export function setEnvelope(theta: number) {
  // Half a set in: see swellClockStart()
  const u = theta / (2 * Math.PI * SET_LENGTH) + 0.5;
  const n = Math.floor(u);
  const peak = SET_PEAKS[((n % SET_CYCLE) + SET_CYCLE) % SET_CYCLE];
  const b = Math.sin(Math.PI * (u - n));
  return SET_LULL + (peak - SET_LULL) * b * b;
}

/** Where the outer peak breaks on big days, on the northern rim of the canyon */
export const PEAK = { x: -150, z: -450 };

/**
 * omega * t to start a newly solved field at: the set clock is anchored so that the peak
 * is in the middle of a set (the first of the cycle) with the biggest set of the cycle
 * next. Sets then follow the statistics above; only the moment we start watching is chosen.
 */
export function swellClockStart(field: WaveField) {
  const { grid } = field;
  const i = Math.round((PEAK.x - grid.minX) / grid.cell);
  const j = Math.round((PEAK.z - grid.minZ) / grid.cell);
  const n = j * grid.nx + i;
  const { shift } = crossedSwell(1, field.crossRe[n], field.crossIm[n], { gain: 0, shift: 0, crossing: 0 });
  const phase = field.k0 * (field.dirX * PEAK.x + field.dirZ * PEAK.z) + field.phase[n] + shift;
  return ((phase % SET_WRAP) + SET_WRAP) % SET_WRAP;
}

/** Offshore-to-local swell, written once here and mirrored in the FarOcean shader */
export function swellHeight(height: number, gain: number, focus: number, theta: number) {
  return height * (1 + (gain - 1) * focus) * setEnvelope(theta);
}

export interface SwellShape {
  y: number;       // Surface elevation
  breaking: number; // 0 unbroken .. 1 fully broken
  crest: number;    // 0 trough .. 1 top of the crest
}

/**
 * Surface at one point: shoaling crests peak up and pitch forward as they near the
 * depth limit, and the height then stays capped at the breaker ratio (higher where
 * the reflected swell crosses the incident one, `crossing` of crossedSwell()).
 */
export function swellSurface(theta: number, unlimited: number, depth: number, crossing: number, out: SwellShape) {
  const limit = BREAKER_RATIO * (1 + CROSSING_BREAKER * crossing) * Math.max(depth, 0);
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
