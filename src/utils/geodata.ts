/**
 * Real geodata of Nazaré baked by scripts/bake-nazare.mjs (see README, "Geodata").
 *
 * World frame: metres from the surf zone off Praia do Norte (39.6075 N, 9.0868 W),
 * true to scale and to the compass: +X = north, +Z = east, Y = up.
 */
import detailUrl from '../data/nazare-detail.bin?inline';
import surfaceUrl from '../data/nazare-surface.bin?inline';
import regionUrl from '../data/nazare-region.bin?inline';
import buildingsUrl from '../data/nazare-buildings.bin?inline';
import type { SeabedGrid } from './waveField';

function decode(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function heightGrid(dataUrl: string, layout: Omit<SeabedGrid, 'heights'>): SeabedGrid {
  const bytes = decode(dataUrl);
  const decimetres = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  return { ...layout, heights: Float32Array.from(decimetres, (v) => v / 10) };
}

/** 10 m terrain around town: EU-DEM land, EMODnet seabed, OSM coastline and moles */
export const detailGrid = heightGrid(detailUrl, { minX: -3500, minZ: -1500, cell: 10, nx: 681, nz: 381 });
/** 30 m regional grid out over the canyon, used by the wave solver */
export const regionGrid = heightGrid(regionUrl, { minX: -8000, minZ: -7800, cell: 30, nx: 561, nz: 351 });

/** Land cover from OSM on the detail grid: low 3 bits are a class, the rest flags */
export const surfaceClasses = decode(surfaceUrl);
export const SURFACE = { none: 0, beach: 1, forest: 2, urban: 3, farmland: 4, classMask: 7, road: 8, rock: 16 };

export interface Building {
  x: number;
  z: number;
  width: number;  // Along `angle`
  depth: number;
  angle: number;  // Radians from +X towards +Z
  levels: number; // 0 = not mapped
}

/** Every building footprint mapped in OSM, as its minimum-area rectangle */
export const buildings: Building[] = (() => {
  const bytes = decode(buildingsUrl);
  const data = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
  const list: Building[] = [];
  for (let i = 0; i + 5 < data.length; i += 6) {
    list.push({
      x: data[i],
      z: data[i + 1],
      width: data[i + 2] / 10,
      depth: data[i + 3] / 10,
      angle: data[i + 4] / 10000,
      levels: data[i + 5],
    });
  }
  return list;
})();
