/**
 * CoastalEnvironment - Reusable coastal environment wrapper
 *
 * Combines Shore and Lighthouse components into a single toggleable unit
 * with exposed parameters for customization.
 *
 * USAGE:
 * <CoastalEnvironment
 *   config={waveConfig}
 *   enabled={true}
 *   cliffHeight={55}
 *   cliffSteepness={18}
 *   beachWidth={100}
 *   rockDensity={1.0}
 *   lighthousePosition={[-80, 48, 160]}
 * />
 *
 * PERFORMANCE TUNING:
 * - Reduce rockDensity (0.5) for lower-end devices
 * - Reduce cliffSteepness for simpler cliff geometry
 * - Set enabled={false} to completely disable coastal rendering
 */

import type { WaveConfig } from '../config/waveConfig';
import { Shore } from './Shore';
import { Lighthouse } from './Lighthouse';

export interface CoastalEnvironmentProps {
  config: WaveConfig;

  /** Master toggle to enable/disable the entire coastal environment */
  enabled?: boolean;

  // === CLIFF PARAMETERS ===
  /** Height of the main cliff face in scene units (default: 55) */
  cliffHeight?: number;
  /** Displacement magnitude for cliff surface detail (default: 18) */
  cliffSteepness?: number;

  // === BEACH PARAMETERS ===
  /** Width of the beach section in scene units (default: 100) */
  beachWidth?: number;

  // === ROCK PARAMETERS ===
  /** Multiplier for rock count - use 0.5 for performance, 1.5 for detail (default: 1.0) */
  rockDensity?: number;

  // === LIGHTHOUSE PARAMETERS ===
  /** Position offset for the lighthouse/fort from default location */
  lighthousePosition?: [number, number, number];
}

/**
 * CoastalEnvironment renders the complete Nazaré coastal scene including:
 * - Multi-layered cliff faces with sedimentary strata
 * - Fort promontory with connecting rock formations
 * - Sandy beach with wet/dry gradient
 * - Underwater shelf for wave breaking
 * - Forte de São Miguel Arcanjo (lighthouse/fort)
 *
 * All geometry is procedurally generated using seeded randomness
 * for consistent, deterministic rendering across sessions.
 */
export function CoastalEnvironment({
  config,
  enabled = true,
  cliffHeight = 55,
  cliffSteepness = 18,
  beachWidth = 100,
  rockDensity = 1.0,
  lighthousePosition = [-80, 48, 160],
}: CoastalEnvironmentProps) {
  // Early return if disabled - no geometry rendered
  if (!enabled) {
    return null;
  }

  return (
    <group name="coastal-environment">
      {/* Shore terrain: cliffs, beach, rocks, underwater shelf */}
      <Shore
        config={config}
        cliffHeight={cliffHeight}
        cliffSteepness={cliffSteepness}
        beachWidth={beachWidth}
        rockDensity={rockDensity}
      />

      {/* Lighthouse/Fort: Forte de São Miguel Arcanjo */}
      <Lighthouse
        config={config}
        position={lighthousePosition}
      />
    </group>
  );
}

// Re-export individual components for direct use if needed
export { Shore } from './Shore';
export { Lighthouse } from './Lighthouse';
