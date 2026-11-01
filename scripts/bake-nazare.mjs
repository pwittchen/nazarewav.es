/**
 * Bakes real geodata of Nazaré into compact binaries under src/data.
 *
 *   node scripts/bake-nazare.mjs <rawDataDir>
 *
 * <rawDataDir> holds (see the "Geodata" section of the README for the sources):
 *   tiles/14_x_y.png  Terrarium elevation tiles (land, EU-DEM based)
 *   emodnet_grid.json EMODnet Bathymetry DTM (WCS GeoTIFF decoded to JSON)
 *   osm.json, bld.json, roads.json, landuse.json, beach.json   Overpass API dumps
 *
 * World frame: metres from ORIGIN, +X = north, +Z = east, Y = up.
 */
import fs from 'fs';
import path from 'path';
import { loadMosaic } from './lib-dem.mjs';

const raw = process.argv[2];
const outDir = path.resolve(import.meta.dirname, '../src/data');
const json = (f) => JSON.parse(fs.readFileSync(path.join(raw, f)));

export const ORIGIN = { lat: 39.6075, lon: -9.0868 };
const M_LAT = 110990;
const M_LON = 85790;
const toX = (lat) => (lat - ORIGIN.lat) * M_LAT;
const toZ = (lon) => (lon - ORIGIN.lon) * M_LON;
const toLat = (x) => ORIGIN.lat + x / M_LAT;
const toLon = (z) => ORIGIN.lon + z / M_LON;

// Detailed terrain around the town and the regional seabed used for the wave rays
const DETAIL = { minX: -3500, minZ: -1500, cell: 10, nx: 681, nz: 381 };
const REGION = { minX: -8000, minZ: -7800, cell: 30, nx: 561, nz: 351 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function grid(g) {
  return { ...g, data: new Float32Array(g.nx * g.nz), x: (i) => g.minX + i * g.cell, z: (j) => g.minZ + j * g.cell };
}

// ---- Coastline: stitched OSM ways closed around the land side -------------
function stitch(ways) {
  const segs = ways.map((w) => w.geometry.map((p) => [toX(p.lat), toZ(p.lon)]));
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const byStart = new Map(segs.map((s) => [key(s[0]), s]));
  const ends = new Set(segs.map((s) => key(s.at(-1))));
  const lines = [];
  const used = new Set();
  for (const s of segs) {
    if (used.has(s) || ends.has(key(s[0]))) continue;
    let line = [], cur = s;
    while (cur && !used.has(cur)) { used.add(cur); line = line.concat(cur); cur = byStart.get(key(cur.at(-1))); }
    lines.push(line);
  }
  for (const s of segs) if (!used.has(s)) lines.push(s); // closed islands
  return lines;
}

function pointInPolys(polys, x, z) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Scanline raster of polygons (lists of [x, z]) into a Uint8Array mask */
function rasterize(polys, g, value, mask) {
  for (let j = 0; j < g.nz; j++) {
    const z = g.minZ + j * g.cell;
    const hits = [];
    for (const poly of polys) {
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, za] = poly[a], [xb, zb] = poly[b];
        if ((za > z) !== (zb > z)) hits.push(xa + ((z - za) / (zb - za)) * (xb - xa));
      }
    }
    hits.sort((p, q) => p - q);
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const i0 = Math.max(0, Math.ceil((hits[h] - g.minX) / g.cell));
      const i1 = Math.min(g.nx - 1, Math.floor((hits[h + 1] - g.minX) / g.cell));
      for (let i = i0; i <= i1; i++) mask[j * g.nx + i] = value;
    }
  }
}

/** Euclidean-ish distance transform (two-pass chamfer) from cells where seed is true, in metres */
function distanceFrom(seed, g) {
  const { nx, nz, cell } = g;
  const d = new Float32Array(nx * nz).fill(1e9);
  for (let i = 0; i < d.length; i++) if (seed(i)) d[i] = 0;
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a);
    if (j > 0) { d[k] = Math.min(d[k], d[k - nx] + a); if (i > 0) d[k] = Math.min(d[k], d[k - nx - 1] + b); if (i < nx - 1) d[k] = Math.min(d[k], d[k - nx + 1] + b); }
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    if (i < nx - 1) d[k] = Math.min(d[k], d[k + 1] + a);
    if (j < nz - 1) { d[k] = Math.min(d[k], d[k + nx] + a); if (i < nx - 1) d[k] = Math.min(d[k], d[k + nx + 1] + b); if (i > 0) d[k] = Math.min(d[k], d[k + nx - 1] + b); }
  }
  return d;
}

function blur(data, nx, nz, passes) {
  let a = data, b = new Float32Array(data.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      b[j * nx + i] = (a[j * nx + Math.max(0, i - 1)] + 2 * a[j * nx + i] + a[j * nx + Math.min(nx - 1, i + 1)]) / 4;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      a[j * nx + i] = (b[Math.max(0, j - 1) * nx + i] + 2 * b[j * nx + i] + b[Math.min(nz - 1, j + 1) * nx + i]) / 4;
    }
  }
  return a;
}

// ---- Inputs ---------------------------------------------------------------
const dem = loadMosaic(path.join(raw, 'tiles'));
const emodnet = json('emodnet_grid.json'); // { W, H, lon0, lat0, dlon, dlat, data } decoded from the WCS GeoTIFF

function seabedAt(lat, lon) {
  const { W, H, lon0, lat0, dlon, dlat, data } = emodnet;
  const fx = clamp((lon - lon0) / dlon - 0.5, 0, W - 1.001);
  const fy = clamp((lat0 - lat) / dlat - 0.5, 0, H - 1.001);
  const ix = Math.floor(fx), iy = Math.floor(fy), a = fx - ix, b = fy - iy;
  const v = (x, y) => data[y * W + x];
  return (v(ix, iy) * (1 - a) + v(ix + 1, iy) * a) * (1 - b) + (v(ix, iy + 1) * (1 - a) + v(ix + 1, iy + 1) * a) * b;
}

const osm = json('osm.json').elements;
const coastWays = osm.filter((e) => e.tags?.natural === 'coastline');
const coast = stitch(coastWays);
console.log('coast lines', coast.map((l) => l.length));

// Land = everything east of the coastline. Open lines are closed around the east side.
const FAR = 30000;
const landPolys = coast.map((l) => {
  if (Math.hypot(l[0][0] - l.at(-1)[0], l[0][1] - l.at(-1)[1]) < 1) return l; // Islands, moles
  // The OSM extract ends at its bounding box: run both ends straight on, then close round the east
  const north = l[0][0] > l.at(-1)[0] ? l : [...l].reverse();
  const tangent = (p, q) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[0] - p[0]) / d, (q[1] - p[1]) / d]; };
  const n = tangent(north[12], north[0]);
  const s_ = tangent(north.at(-13), north.at(-1));
  const top = [north[0][0] + n[0] * FAR, north[0][1] + n[1] * FAR];
  const bottom = [north.at(-1)[0] + s_[0] * FAR, north.at(-1)[1] + s_[1] * FAR];
  return [top, ...north, bottom, [bottom[0], 2 * FAR], [top[0], 2 * FAR]];
});

function buildHeights(g, opts) {
  const out = grid(g);
  const land = new Uint8Array(g.nx * g.nz);
  rasterize(landPolys, g, 1, land);
  const seaDist = distanceFrom((k) => land[k] === 0, g);   // >0 on land
  const landDist = distanceFrom((k) => land[k] === 1, g);  // >0 at sea
  // Raw seabed first, smoothed, because EMODnet cells are ~115 m blocks
  const sea = new Float32Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const v = seabedAt(toLat(out.x(i)), toLon(out.z(j)));
    sea[j * g.nx + i] = Math.min(v, -0.5);
  }
  blur(sea, g.nx, g.nz, opts.blur);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i;
    const lat = toLat(out.x(i)), lon = toLon(out.z(j));
    if (land[k]) {
      out.data[k] = Math.max(0.3, dem.at(lat, lon)) * smooth(0, 16, seaDist[k]) + 0.3;
    } else {
      // EMODnet (~115 m cells) cannot resolve the swash zone: a ~1:40 beach face
      // meets the coastline and hands over to the surveyed depths within 200 m.
      const d = landDist[k];
      const nearshore = -0.2 - d / 40;
      out.data[k] = Math.min(-0.2, nearshore + (sea[k] - nearshore) * smooth(40, 200, d));
    }
  }
  return { out, land, seaDist, landDist };
}

const detail = buildHeights(DETAIL, { blur: 3 });
{
  // Round the waterline off, otherwise it shows the staircase of the land mask
  const soft = blur(Float32Array.from(detail.out.data), DETAIL.nx, DETAIL.nz, 3);
  for (let k = 0; k < soft.length; k++) {
    detail.out.data[k] += (soft[k] - detail.out.data[k]) * smooth(7, 2, Math.abs(detail.out.data[k]));
  }
}
const region = buildHeights(REGION, { blur: 1 });

// ---- Surface classes on the detail grid -----------------------------------
const CLASS = { none: 0, beach: 1, forest: 2, urban: 3, farmland: 4 };
const surface = new Uint8Array(DETAIL.nx * DETAIL.nz);
const poly = (e) => (e.geometry ?? []).map((p) => [toX(p.lat), toZ(p.lon)]);
const relPolys = (e) => (e.members ?? []).filter((m) => m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [toX(p.lat), toZ(p.lon)]));
const landuse = json('landuse.json').elements;
const polysOf = (filter) => landuse.filter((e) => filter(e.tags ?? {})).flatMap((e) => (e.type === 'relation' ? relPolys(e) : [poly(e)])).filter((p) => p.length > 2);
rasterize(polysOf((t) => ['farmland', 'meadow', 'orchard', 'vineyard', 'grass', 'farmyard'].includes(t.landuse)), DETAIL, CLASS.farmland, surface);
rasterize(polysOf((t) => t.landuse === 'forest' || t.natural === 'wood'), DETAIL, CLASS.forest, surface);
rasterize(polysOf((t) => ['residential', 'commercial', 'retail', 'industrial', 'construction', 'port'].includes(t.landuse)), DETAIL, CLASS.urban, surface);
const beachPolys = json('beach.json').elements.flatMap((e) => (e.type === 'relation' ? relPolys(e) : [poly(e)])).filter((p) => p.length > 2);
rasterize(beachPolys, DETAIL, CLASS.beach, surface);

// Roads: rasterised with their approximate carriageway width (stored in bit 3 of the surface byte)
const ROAD_BIT = 8;
const roads = json('roads.json').elements;
const widths = { trunk: 11, primary: 10, secondary: 9, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, pedestrian: 5 };
for (const r of roads) {
  const w = (widths[r.tags?.highway] ?? 6) + DETAIL.cell * 0.6;
  const pts = poly(r);
  for (let s = 1; s < pts.length; s++) {
    const [ax, az] = pts[s - 1], [bx, bz] = pts[s];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (DETAIL.cell / 2));
    for (let t = 0; t <= n; t++) {
      const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
      const r2 = Math.ceil(w / 2 / DETAIL.cell);
      const ci = Math.round((x - DETAIL.minX) / DETAIL.cell), cj = Math.round((z - DETAIL.minZ) / DETAIL.cell);
      for (let dj = -r2; dj <= r2; dj++) for (let di = -r2; di <= r2; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= DETAIL.nx || j >= DETAIL.nz) continue;
        if (Math.hypot(di, dj) * DETAIL.cell <= w / 2) surface[j * DETAIL.nx + i] |= ROAD_BIT;
      }
    }
  }
}

// ---- Harbour: breakwaters (their OSM polygons are narrower than a cell, so dilate) ----
const moles = osm.filter((e) => e.tags?.man_made === 'breakwater' || (e.tags?.man_made === 'pier' && e.geometry?.length > 8));
const ROCK_BIT = 16;
for (const m of moles) {
  const pts = poly(m);
  const crest = m.tags.man_made === 'breakwater' ? 6 : 3.5;
  for (let s = 1; s < pts.length; s++) {
    const [ax, az] = pts[s - 1], [bx, bz] = pts[s];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
    for (let t = 0; t <= n; t++) {
      const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
      const ci = Math.round((x - DETAIL.minX) / DETAIL.cell), cj = Math.round((z - DETAIL.minZ) / DETAIL.cell);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= DETAIL.nx || j >= DETAIL.nz) continue;
        const k = j * DETAIL.nx + i;
        detail.out.data[k] = Math.max(detail.out.data[k], crest - Math.hypot(di, dj) * 1.5);
        surface[k] |= ROCK_BIT;
      }
    }
  }
}

// ---- Buildings ------------------------------------------------------------
function footprint(pts) {
  // Minimum-area rectangle over the hull edges, which gives the street alignment
  let best = null;
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  for (let i = 1; i < pts.length; i++) {
    const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) {
      const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a, w: u1 - u0, d: v1 - v0, mu: (u0 + u1) / 2, mv: (v0 + v1) / 2, c, s };
  }
  return { x: cx + best.mu * best.c - best.mv * best.s, z: cz + best.mu * best.s + best.mv * best.c, w: best.w, d: best.d, a: best.a };
}
const bld = json('bld.json').elements.filter((e) => e.geometry?.length > 3);
const buildings = [];
for (const b of bld) {
  const f = footprint(poly(b));
  if (f.w < 2 || f.d < 2 || f.w > 150 || f.d > 150) continue;
  const levels = parseInt(b.tags['building:levels'] ?? '0', 10) || 0;
  buildings.push([f.x, f.z, f.w, f.d, f.a, levels]);
}
const bb = new Int16Array(buildings.length * 6);
buildings.forEach(([x, z, w, d, a, l], i) => {
  bb[i * 6] = Math.round(x); bb[i * 6 + 1] = Math.round(z);
  bb[i * 6 + 2] = Math.round(w * 10); bb[i * 6 + 3] = Math.round(d * 10);
  bb[i * 6 + 4] = Math.round(((a % Math.PI) * 10000)); bb[i * 6 + 5] = l;
});

// ---- Output ---------------------------------------------------------------
function quantize(g) {
  // Decimetres; seabed clamps at -3276 m which is far deeper than the region
  const a = new Int16Array(g.data.length);
  for (let i = 0; i < a.length; i++) a[i] = Math.round(clamp(g.data[i], -3200, 3200) * 10);
  return a;
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'nazare-detail.bin'), Buffer.from(quantize(detail.out).buffer));
fs.writeFileSync(path.join(outDir, 'nazare-surface.bin'), Buffer.from(surface));
fs.writeFileSync(path.join(outDir, 'nazare-region.bin'), Buffer.from(quantize(region.out).buffer));
fs.writeFileSync(path.join(outDir, 'nazare-buildings.bin'), Buffer.from(bb.buffer));

const fort = osm.find((e) => e.tags?.historic === 'fort' || e.tags?.name === 'Forte de São Miguel Arcanjo');
console.log('fort outline', JSON.stringify(poly(fort).map(([x, z]) => [Math.round(x), Math.round(z)])));
const at = (g, x, z) => g.data[Math.round((z - g.minZ) / g.cell) * g.nx + Math.round((x - g.minX) / g.cell)];
console.log('heights', [[-335, 145], [-342, 124], [-228, 855], [-320, 914], [-251, 1058], [-518, 1144], [-380, 400], [-300, 600]].map(([x, z]) => [x, z, +at(detail.out, x, z).toFixed(1)].join(':')).join(' '));
for (const x of [2000, 1000, 0, -200, -600, -800, -1000, -1500, -2000, -2400]) {
  let z = 2000;
  while (z > -1400 && at(detail.out, x, z) >= 0) z -= 10;
  console.log('shore at x', x, 'z', z);
}
const P = (lat, lon) => [Math.round(toX(lat)), Math.round(toZ(lon))];
console.log('grids', { DETAIL, REGION });
console.log('landmarks', {
  fort: P(39.60448, -9.08511), light: P(39.60442, -9.08535), santuario: P(39.60545, -9.07683), memoria: P(39.60462, -9.07615),
  funTop: P(39.60524, -9.07447), funBottom: P(39.60283, -9.07346),
});
console.log('buildings', buildings.length);
