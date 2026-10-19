import * as THREE from 'three';

/**
 * Time of day and weather for the Nazaré scene.
 *
 * The sun position is computed for Nazaré (NOAA solar position equations), so the
 * sun rises over the land (+Z) and sets over the Atlantic (-Z). Sky, light and fog
 * colors are interpolated from keyframes indexed by sun elevation, then muted
 * towards an overcast grey by cloud cover.
 */

const NAZARE_LAT = 39.6017;
const NAZARE_LON = -9.0714;
const NAZARE_TIME_ZONE = 'Europe/Lisbon';

export type DayPhase = 'night' | 'dawn' | 'morning' | 'day' | 'dusk';

export interface SkyState {
  phase: DayPhase;
  isNight: boolean;                // Dark UI theme + lighthouse beam
  sunElevation: number;            // Degrees above the horizon
  sunDirection: THREE.Vector3;     // Unit vector towards the sun in scene space
  zenithColor: THREE.Color;
  horizonColor: THREE.Color;       // Also the fog color, so the sea fades into the sky
  sunColor: THREE.Color;
  sunIntensity: number;
  sunVisibility: number;           // Sun disc / glow strength (0 under overcast or below horizon)
  moonIntensity: number;
  skyLightColor: THREE.Color;      // Hemisphere light, sky side
  groundLightColor: THREE.Color;   // Hemisphere light, ground side
  skyLightIntensity: number;
  cloudCover: number;
  cloudLitColor: THREE.Color;
  cloudShadeColor: THREE.Color;
  starVisibility: number;
  environmentIntensity: number;    // Strength of sky reflections on water and terrain
}

// Local hour (0-24) in Nazaré for the given instant
export function nazareLocalHour(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: NAZARE_TIME_ZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return hour + minute / 60;
}

// Hours Nazaré local time is ahead of UTC on the given date (0 in winter, 1 in summer)
function nazareUtcOffset(date: Date): number {
  const offset = nazareLocalHour(date) - (date.getUTCHours() + date.getUTCMinutes() / 60);
  return ((offset + 36) % 24) - 12;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/**
 * Sun elevation/azimuth (degrees, azimuth clockwise from north) at Nazaré for a
 * local hour on the given date.
 */
export function sunPosition(localHour: number, date: Date = new Date()) {
  const utcHour = localHour - nazareUtcOffset(date);
  const gamma = (2 * Math.PI / 365) * (dayOfYear(date) - 1 + (utcHour - 12) / 24);

  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const trueSolarMinutes = utcHour * 60 + eqTime + 4 * NAZARE_LON;
  const hourAngle = THREE.MathUtils.degToRad(trueSolarMinutes / 4 - 180);
  const lat = THREE.MathUtils.degToRad(NAZARE_LAT);

  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosZenith, -1, 1)));
  const azimuth = (THREE.MathUtils.radToDeg(Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)
  )) + 180) % 360;

  return { elevation, azimuth, rising: hourAngle < 0 };
}

// Clear-sky keyframes by sun elevation (degrees). Dawn and dusk differ in tint.
interface SkyKey {
  elevation: number;
  zenith: string;
  horizonDawn: string;
  horizonDusk: string;
  sun: string;
}

const SKY_KEYS: SkyKey[] = [
  { elevation: -18, zenith: '#02040a', horizonDawn: '#070b17', horizonDusk: '#070b17', sun: '#000000' },
  { elevation: -10, zenith: '#060c1e', horizonDawn: '#1a2240', horizonDusk: '#1d1d3a', sun: '#000000' },
  { elevation: -4,  zenith: '#13254a', horizonDawn: '#6d5a7e', horizonDusk: '#7a4f66', sun: '#ff5a2a' },
  { elevation: 0,   zenith: '#2a4a7c', horizonDawn: '#f2a07e', horizonDusk: '#f2834a', sun: '#ff7a33' },
  { elevation: 6,   zenith: '#3a68a4', horizonDawn: '#f4c79e', horizonDusk: '#f6b57a', sun: '#ffb46a' },
  { elevation: 15,  zenith: '#3b73b6', horizonDawn: '#bcd3e6', horizonDusk: '#d4d4d0', sun: '#ffe2bc' },
  { elevation: 35,  zenith: '#2e6ab4', horizonDawn: '#b4d2ea', horizonDusk: '#b4d2ea', sun: '#fff6e8' },
  { elevation: 90,  zenith: '#235fae', horizonDawn: '#b8d6ee', horizonDusk: '#b8d6ee', sun: '#fffbf2' },
];

function sampleKeys(elevation: number, rising: boolean) {
  const e = THREE.MathUtils.clamp(elevation, SKY_KEYS[0].elevation, SKY_KEYS[SKY_KEYS.length - 1].elevation);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && e > SKY_KEYS[i + 1].elevation) i++;
  const a = SKY_KEYS[i];
  const b = SKY_KEYS[i + 1];
  const t = (e - a.elevation) / (b.elevation - a.elevation);
  const lerp = (x: string, y: string) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  return {
    zenith: lerp(a.zenith, b.zenith),
    horizon: rising ? lerp(a.horizonDawn, b.horizonDawn) : lerp(a.horizonDusk, b.horizonDusk),
    sun: lerp(a.sun, b.sun),
  };
}

function dayPhase(elevation: number, rising: boolean): DayPhase {
  if (elevation < -6) return 'night';
  if (elevation < 6) return rising ? 'dawn' : 'dusk';
  if (rising && elevation < 25) return 'morning';
  return 'day';
}

export const dayPhaseLabels: Record<DayPhase, string> = {
  night: 'Night',
  dawn: 'Dawn',
  morning: 'Morning',
  day: 'Day',
  dusk: 'Dusk',
};

export function weatherLabel(cloudCover: number): string {
  if (cloudCover < 0.15) return 'Clear';
  if (cloudCover < 0.45) return 'Partly cloudy';
  if (cloudCover < 0.8) return 'Cloudy';
  return 'Overcast';
}

export function computeSky(localHour: number, cloudCover: number, date: Date = new Date()): SkyState {
  const { elevation, azimuth, rising } = sunPosition(localHour, date);
  const elevRad = THREE.MathUtils.degToRad(elevation);
  const azRad = THREE.MathUtils.degToRad(azimuth);

  // Scene axes: +X = north, +Z = east, +Y = up
  const sunDirection = new THREE.Vector3(
    Math.cos(elevRad) * Math.cos(azRad),
    Math.sin(elevRad),
    Math.cos(elevRad) * Math.sin(azRad)
  ).normalize();

  const clear = sampleKeys(elevation, rising);
  const daylight = THREE.MathUtils.smoothstep(elevation, -12, 10); // 0 at night, 1 in daylight
  const sunUp = THREE.MathUtils.smoothstep(elevation, -3, 4);
  const overcast = Math.pow(cloudCover, 1.3);

  // Overcast sky: flat grey, brightness following the available daylight
  const greyLevel = 0.03 + 0.55 * daylight;
  const overcastSky = new THREE.Color().setRGB(greyLevel, greyLevel * 1.03, greyLevel * 1.08, THREE.SRGBColorSpace);

  const zenithColor = clear.zenith.clone().lerp(overcastSky.clone().multiplyScalar(0.9), overcast * 0.85);
  const horizonColor = clear.horizon.clone().lerp(overcastSky, overcast * 0.85);

  const sunColor = clear.sun.clone().lerp(new THREE.Color('#e8ecf0'), overcast * 0.6);
  const sunIntensity = sunUp * (0.6 + 1.6 * THREE.MathUtils.smoothstep(elevation, 0, 30)) * (1 - 0.75 * overcast);
  const moonIntensity = (1 - THREE.MathUtils.smoothstep(elevation, -10, -2)) * 0.35 * (1 - 0.7 * overcast);

  const skyLightColor = zenithColor.clone().lerp(horizonColor, 0.5);
  const groundLightColor = new THREE.Color('#0b2433').lerp(horizonColor, 0.15);
  // Clouds scatter sunlight, so overcast skies light the scene more evenly
  const skyLightIntensity = 0.12 + 0.85 * daylight + 0.25 * overcast * daylight;

  const cloudLitColor = new THREE.Color('#ffffff')
    .lerp(clear.sun, 0.45 * (1 - THREE.MathUtils.smoothstep(elevation, 4, 20)) * sunUp)
    .multiplyScalar(0.06 + 0.94 * daylight)
    .lerp(overcastSky.clone().multiplyScalar(1.1), overcast * 0.5);
  const cloudShadeColor = zenithColor.clone().lerp(overcastSky, 0.6).multiplyScalar(0.55 + 0.25 * daylight);

  return {
    phase: dayPhase(elevation, rising),
    isNight: elevation < -4,
    sunElevation: elevation,
    sunDirection,
    zenithColor,
    horizonColor,
    sunColor,
    sunIntensity,
    sunVisibility: THREE.MathUtils.smoothstep(elevation, -2, 1) * (1 - overcast * 0.9),
    moonIntensity,
    skyLightColor,
    groundLightColor,
    skyLightIntensity,
    cloudCover,
    cloudLitColor,
    cloudShadeColor,
    starVisibility: (1 - THREE.MathUtils.smoothstep(elevation, -14, -6)),
    environmentIntensity: 0.15 + 0.85 * daylight,
  };
}

/**
 * Water body colors (albedo, sRGB). Atlantic water off Nazaré is a deep blue-green;
 * it turns teal over the sandy shallows and glows green through thin wave crests.
 * WaveMesh and the FarOcean shader both blend these the same way (see waterAlbedo).
 */
export const waterPalette = {
  deep: new THREE.Color('#0a3346'),
  shallow: new THREE.Color('#1f6f6a'),
  crest: new THREE.Color('#2d8a7e'),
  murky: new THREE.Color('#40574a'),
};

// Low roughness so the sky and sun glint off the surface (Fresnel does the rest)
export const WATER_ROUGHNESS = 0.12;

// 1 over the sandy shallows, 0 in deep water (depth in meters, negative = land)
export function waterShallowness(depth: number): number {
  return 1 - THREE.MathUtils.smoothstep(depth, 2, 25);
}

// Shared blend: `shallow` 0 (deep) - 1 (shallows), `crest` 0 (trough) - 1 (crest top)
export function waterAlbedo(target: THREE.Color, shallow: number, crest: number, clarity: number): THREE.Color {
  target.copy(waterPalette.deep)
    .lerp(waterPalette.shallow, shallow * 0.85)
    .lerp(waterPalette.crest, crest * 0.6)
    .lerp(waterPalette.murky, (1 - clarity) * 0.45);
  return target;
}
