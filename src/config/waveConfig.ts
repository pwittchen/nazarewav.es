/**
 * Nazaré Waves Configuration
 *
 * This is the central configuration file for all wave and weather parameters.
 * Modify these values to adjust the wave simulation behavior.
 *
 * Nazaré is famous for its massive waves due to the Nazaré Canyon -
 * an underwater canyon that focuses and amplifies wave energy.
 */

export interface WaveConfig {
  // Wave Parameters
  waveHeight: number;        // Base wave height in meters (typical: 1-30m for Nazaré)
  wavePeriod: number;        // Time between wave crests in seconds (typical: 8-20s)
  waveDirection: number;     // Direction waves come from in degrees (0 = North, 90 = East)
  waveLength: number;        // Distance between wave crests in meters
  waveSpeed: number;         // Wave propagation speed multiplier

  // Secondary Wave (cross swell)
  secondaryWaveHeight: number;
  secondaryWavePeriod: number;
  secondaryWaveDirection: number;

  // Wind Parameters
  windSpeed: number;         // Wind speed in m/s (affects chop and spray)
  windDirection: number;     // Wind direction in degrees
  windChopIntensity: number; // Small wave chop caused by wind (0-1)

  // Canyon Effect (Nazaré specific)
  canyonAmplification: number;  // How much the canyon amplifies waves (1-3 typical)
  canyonFocusWidth: number;     // Width of the focused wave zone
  canyonDepthEffect: number;    // Depth effect on wave steepening (0-1)

  // Visual Parameters
  foamThreshold: number;     // Wave steepness at which foam appears (0-1)
  foamIntensity: number;     // Amount of foam/whitecaps (0-1)
  waterClarity: number;      // Water clarity/turbidity (0-1)

  // Display
  wireframe: boolean;        // Display as wireframe grid mesh (default: true)
  animateWaves: boolean;     // Enable natural wave movement (default: true)

  // Animation
  timeScale: number;         // Overall animation speed multiplier
}

export const defaultWaveConfig: WaveConfig = {
  // Wave Parameters - Default to moderate Nazaré conditions
  waveHeight: 8,
  wavePeriod: 14,
  waveDirection: 0,          // Waves coming from back, moving toward viewer
  waveLength: 200,
  waveSpeed: 1.0,

  // Secondary Wave
  secondaryWaveHeight: 2,
  secondaryWavePeriod: 8,
  secondaryWaveDirection: 30,

  // Wind Parameters
  windSpeed: 15,
  windDirection: 45,         // Northeast wind
  windChopIntensity: 0.3,

  // Canyon Effect
  canyonAmplification: 2.0,
  canyonFocusWidth: 0.4,
  canyonDepthEffect: 0.7,

  // Visual Parameters
  foamThreshold: 0.6,
  foamIntensity: 0.5,
  waterClarity: 0.7,

  // Display
  wireframe: true,           // Grid mesh by default
  animateWaves: true,        // Natural wave movement by default

  // Animation
  timeScale: 1.0,
};

// Preset configurations for different conditions
export const wavePresets = {
  calm: {
    ...defaultWaveConfig,
    waveHeight: 2,
    wavePeriod: 10,
    windSpeed: 5,
    windChopIntensity: 0.1,
    canyonAmplification: 1.2,
    foamIntensity: 0.2,
  },
  moderate: {
    ...defaultWaveConfig,
  },
  big: {
    ...defaultWaveConfig,
    waveHeight: 15,
    wavePeriod: 16,
    windSpeed: 25,
    windChopIntensity: 0.5,
    canyonAmplification: 2.5,
    foamIntensity: 0.7,
  },
  extreme: {
    ...defaultWaveConfig,
    waveHeight: 25,
    wavePeriod: 20,
    secondaryWaveHeight: 5,
    windSpeed: 40,
    windChopIntensity: 0.8,
    canyonAmplification: 3.0,
    foamIntensity: 0.9,
    canyonDepthEffect: 0.9,
  },
} as const;

// Configuration limits for UI sliders
export const configLimits = {
  waveHeight: { min: 0.5, max: 30, step: 0.5 },
  wavePeriod: { min: 4, max: 25, step: 1 },
  waveDirection: { min: 0, max: 360, step: 5 },
  waveLength: { min: 50, max: 500, step: 10 },
  waveSpeed: { min: 0.1, max: 3, step: 0.1 },
  secondaryWaveHeight: { min: 0, max: 10, step: 0.5 },
  secondaryWavePeriod: { min: 4, max: 15, step: 1 },
  secondaryWaveDirection: { min: 0, max: 360, step: 5 },
  windSpeed: { min: 0, max: 60, step: 1 },
  windDirection: { min: 0, max: 360, step: 5 },
  windChopIntensity: { min: 0, max: 1, step: 0.05 },
  canyonAmplification: { min: 1, max: 4, step: 0.1 },
  canyonFocusWidth: { min: 0.1, max: 1, step: 0.05 },
  canyonDepthEffect: { min: 0, max: 1, step: 0.05 },
  foamThreshold: { min: 0, max: 1, step: 0.05 },
  foamIntensity: { min: 0, max: 1, step: 0.05 },
  waterClarity: { min: 0, max: 1, step: 0.05 },
  timeScale: { min: 0.1, max: 3, step: 0.1 },
} as const;
