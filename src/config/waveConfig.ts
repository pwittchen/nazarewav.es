/**
 * Nazaré Waves Configuration
 *
 * This is the central configuration file for all wave and weather parameters.
 * Modify these values to adjust the wave simulation behavior.
 *
 * Wave heights are offshore significant heights. What the swell turns into at
 * Praia do Norte is computed over the real seabed (see utils/waveField.ts): the
 * Nazaré Canyon refracts and reflects long-period swell along its northern rim,
 * focusing it on the beach.
 */

import { nazareLocalHour } from '../utils/sky';

export interface WaveConfig {
  // Wave Parameters
  waveHeight: number;        // Offshore significant wave height in meters (big days: 6-10m)
  wavePeriod: number;        // Peak period in seconds; sets wavelength and speed (best: 14-20s)
  waveDirection: number;     // Compass bearing the swell comes from (best: 290-315°)

  // Secondary Wave (cross swell)
  secondaryWaveHeight: number;
  secondaryWavePeriod: number;
  secondaryWaveDirection: number;

  // Wind Parameters
  windSpeed: number;         // Wind speed in m/s (affects chop and spray)
  windDirection: number;     // Wind direction in degrees
  windChopIntensity: number; // Small wave chop caused by wind (0-1)

  // Canyon Effect (Nazaré specific)
  canyonAmplification: number;  // Strength of the computed refraction (1 = real seabed, 0 = none)

  // Visual Parameters
  foamThreshold: number;     // Wave steepness at which foam appears (0-1)
  foamIntensity: number;     // Amount of foam/whitecaps (0-1)
  waterClarity: number;      // Water clarity/turbidity (0-1)

  // Sky & Weather (UI theme follows: dark at night, light in daylight)
  timeOfDay: number;         // Local Nazaré time in hours (0-24), drives the sun position
  cloudCover: number;        // Cloud cover (0 = clear sky, 1 = overcast)
  liveSky: boolean;          // Follow the current Nazaré time instead of timeOfDay slider (default: true)

  // Display
  wireframe: boolean;        // Display as wireframe grid mesh (default: false)
  animateWaves: boolean;     // Enable natural wave movement (default: true)
  waveColor: string;         // Color of the wireframe grid (hex string); solid water uses a realistic palette
  showCoast: boolean;        // Show the Nazaré coast: Praia do Norte, cliffs, fort & lighthouse (default: true)

  // Animation
  timeScale: number;         // Overall animation speed multiplier
}

export const defaultWaveConfig: WaveConfig = {
  // Wave Parameters - Default to moderate Nazaré conditions
  waveHeight: 3.5,
  wavePeriod: 14,
  waveDirection: 295,        // WNW, the usual Atlantic swell

  // Secondary Wave
  secondaryWaveHeight: 0.8,
  secondaryWavePeriod: 8,
  secondaryWaveDirection: 330,

  // Wind Parameters
  windSpeed: 8,
  windDirection: 45,         // Northeast wind (offshore)
  windChopIntensity: 0.3,

  // Canyon Effect
  canyonAmplification: 1,

  // Visual Parameters
  foamThreshold: 0.6,
  foamIntensity: 0.5,
  waterClarity: 0.7,

  // Sky & Weather
  timeOfDay: nazareLocalHour(),
  cloudCover: 0.2,
  liveSky: true,

  // Display
  wireframe: false,          // Solid water by default
  animateWaves: true,        // Natural wave movement by default
  waveColor: '#3be1f7',      // Cyan color by default
  showCoast: true,           // Coastline visible by default

  // Animation
  timeScale: 1.0,
};

/**
 * Camera viewpoints, in world metres. The shore view watches the beach break; big swells
 * break 400-1000 m out on the northern rim of the canyon (17-21 m deep for the biggest
 * sets), so the peak view looks north from over the canyon past the fort, the angle the
 * crowds on the headland see.
 */
export const cameraViews = {
  shore: { position: [720, 95, -520], target: [-200, 20, 180] },
  peak: { position: [-860, 110, 230], target: [-60, 0, -360] },
} as const satisfies Record<string, { position: readonly number[]; target: readonly number[] }>;
export type CameraView = keyof typeof cameraViews;

/** The viewpoint each preset switches to */
export const presetViews: Record<keyof typeof wavePresets, CameraView> = {
  calm: 'shore',
  moderate: 'shore',
  big: 'peak',
  extreme: 'peak',
};

// Preset configurations for different conditions
export const wavePresets = {
  calm: {
    ...defaultWaveConfig,
    waveHeight: 1.2,
    wavePeriod: 9,
    windSpeed: 4,
    windChopIntensity: 0.1,
    foamIntensity: 0.2,
  },
  moderate: {
    ...defaultWaveConfig,
  },
  big: {
    ...defaultWaveConfig,
    waveHeight: 6,
    wavePeriod: 16,
    waveDirection: 300,
    windSpeed: 6,
    foamIntensity: 0.7,
  },
  // The classic tow-in day: a long-period NW swell under light offshore wind
  extreme: {
    ...defaultWaveConfig,
    waveHeight: 9,
    wavePeriod: 18,
    waveDirection: 305,
    secondaryWaveHeight: 1.5,
    windSpeed: 5,
    windChopIntensity: 0.2,
    foamIntensity: 0.9,
  },
} as const;

// Configuration limits for UI sliders
export const configLimits = {
  waveHeight: { min: 0.5, max: 14, step: 0.5 },
  wavePeriod: { min: 4, max: 25, step: 1 },
  waveDirection: { min: 0, max: 360, step: 5 },
  secondaryWaveHeight: { min: 0, max: 5, step: 0.5 },
  secondaryWavePeriod: { min: 4, max: 15, step: 1 },
  secondaryWaveDirection: { min: 0, max: 360, step: 5 },
  windSpeed: { min: 0, max: 60, step: 1 },
  windDirection: { min: 0, max: 360, step: 5 },
  windChopIntensity: { min: 0, max: 1, step: 0.05 },
  canyonAmplification: { min: 0, max: 1.5, step: 0.05 },
  foamThreshold: { min: 0, max: 1, step: 0.05 },
  foamIntensity: { min: 0, max: 1, step: 0.05 },
  waterClarity: { min: 0, max: 1, step: 0.05 },
  timeOfDay: { min: 0, max: 24, step: 0.25 },
  cloudCover: { min: 0, max: 1, step: 0.05 },
  timeScale: { min: 0.1, max: 3, step: 0.1 },
} as const;
