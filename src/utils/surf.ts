/**
 * When the waves at Praia do Norte can be surfed, and how.
 *
 * Small or short-period swell does not make a rideable wave, and strong wind, above all
 * onshore (from the west: the beach faces the Atlantic), blows the faces apart. Big days
 * are surfed by tow-in: a jet ski whips the surfer into waves too fast to paddle for.
 */

import type { WaveConfig } from '../config/waveConfig';

export type SurfStyle = 'paddle' | 'tow';

export interface Surfability {
  surfable: boolean;
  /** Why not, or how it is surfed */
  reason: string;
  style: SurfStyle;
}

export const SURF_LIMITS = {
  minHeight: 1,        // m, offshore significant height
  minPeriod: 7,        // s, shorter is weak wind swell
  maxWind: 15,         // m/s from any direction (gale)
  maxOnshoreWind: 9,   // m/s, onshore component
  towHeight: 6,        // m, tow-in from here up
};

/** Wind component blowing onto the beach, m/s (direction is where the wind comes from) */
export function onshoreWind(windSpeed: number, windFromDeg: number) {
  return windSpeed * Math.cos(((windFromDeg - 270) * Math.PI) / 180);
}

export function surfability(config: Pick<WaveConfig, 'showCoast' | 'waveHeight' | 'wavePeriod' | 'windSpeed' | 'windDirection'>): Surfability {
  const style: SurfStyle = config.waveHeight >= SURF_LIMITS.towHeight ? 'tow' : 'paddle';
  const no = (reason: string): Surfability => ({ surfable: false, reason, style });
  if (!config.showCoast) return no('Turn on the Nazaré coast: waves only break over its seabed');
  if (config.waveHeight < SURF_LIMITS.minHeight) return no(`Too small: under ${SURF_LIMITS.minHeight} m of swell`);
  if (config.wavePeriod < SURF_LIMITS.minPeriod) return no(`Period under ${SURF_LIMITS.minPeriod} s: weak, choppy wind swell`);
  if (config.windSpeed > SURF_LIMITS.maxWind) return no(`Blown out: wind over ${SURF_LIMITS.maxWind} m/s`);
  if (onshoreWind(config.windSpeed, config.windDirection) > SURF_LIMITS.maxOnshoreWind) return no('Blown out by onshore wind');
  return {
    surfable: true,
    reason: style === 'tow' ? 'Tow-in surfers with jet skis at the canyon peak' : 'Paddle surfers at Praia do Norte',
    style,
  };
}
