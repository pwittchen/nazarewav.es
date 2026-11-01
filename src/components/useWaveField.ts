import { useEffect, useState } from 'react';
import { computeWaveField, type WaveField } from '../utils/waveField';
import { regionGrid } from '../utils/geodata';

const SOLVE_DELAY_MS = 250; // Takes a fifth of a second, so wait for sliders to settle

/** The swell solved over the seabed for the current direction and period */
export function useWaveField(fromDeg: number, period: number): WaveField {
  const [field, setField] = useState(() => computeWaveField(regionGrid, fromDeg, period));
  useEffect(() => {
    const timer = setTimeout(() => setField(computeWaveField(regionGrid, fromDeg, period)), SOLVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fromDeg, period]);
  return field;
}
