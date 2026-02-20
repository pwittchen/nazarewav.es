import type { WaveConfig } from '../config/waveConfig';

export interface ForecastEntry {
  datetime: string;
  dayName: string;
  hour: number;
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  windSpeed: number;
  windDirection: number;
}

interface WindData {
  datetime: string;
  windSpeed: number;
  windDirection: number;
}

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
];
const WAVE_URL = 'https://micro.windguru.cz/?s=75856&m=gfswh';
const WIND_URL = 'https://micro.windguru.cz/?s=75856&m=gfs';

function parseWindguruText(waveText: string, windText: string): ForecastEntry[] {
  const entries: ForecastEntry[] = [];

  try {
    // Extract content from <pre> tag
    const wavePreMatch = waveText.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    const windPreMatch = windText.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);

    const waveContent = wavePreMatch ? wavePreMatch[1] : waveText;
    const windContent = windPreMatch ? windPreMatch[1] : windText;

    // Parse wind data first into a map for quick lookup
    const windDataMap = new Map<string, WindData>();
    const windLines = windContent.split('\n');

    for (const line of windLines) {
      const match = line.match(/^\s*(\w{3})\s+(\d+)\.\s+(\d+)h\s+(\d+)\s+\d+\s+\w+\s+(\d+)/);
      if (match) {
        const [, dayName, dayNum, hourStr, windSpeedStr, windDirStr] = match;
        const key = `${dayName} ${dayNum}. ${hourStr}h`;
        windDataMap.set(key, {
          datetime: key,
          windSpeed: parseInt(windSpeedStr),
          windDirection: parseInt(windDirStr),
        });
      }
    }

    // Parse wave data and combine with wind data
    const waveLines = waveContent.split('\n');

    for (const line of waveLines) {
      const match = line.match(/^\s*(\w{3})\s+(\d+)\.\s+(\d+)h\s+([\d.]+)\s+\w+\s+(\d+)\s+(\d+)/);
      if (match) {
        const [, dayName, dayNum, hourStr, waveHeightStr, waveDirStr, wavePeriodStr] = match;
        const key = `${dayName} ${dayNum}. ${hourStr}h`;
        const windData = windDataMap.get(key);

        entries.push({
          datetime: key,
          dayName,
          hour: parseInt(hourStr),
          waveHeight: parseFloat(waveHeightStr),
          wavePeriod: parseInt(wavePeriodStr),
          waveDirection: parseInt(waveDirStr),
          windSpeed: windData?.windSpeed || 10,
          windDirection: windData?.windDirection || 45,
        });
      }
    }
  } catch (e) {
    console.error('Error parsing Windguru data:', e);
  }

  return entries;
}

async function fetchWithProxy(url: string): Promise<string> {
  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(proxy + encodeURIComponent(url));
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      console.warn(`Proxy ${proxy} failed:`, e);
    }
  }
  throw new Error('All CORS proxies failed');
}

function generateFallbackForecast(): ForecastEntry[] {
  const entries: ForecastEntry[] = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dayName = days[date.getDay()];
    const dayNum = date.getDate();

    for (let h = 0; h < 24; h += 3) {
      const variation = Math.sin(d * 0.8 + h * 0.1) * 0.5 + 0.5;
      entries.push({
        datetime: `${dayName} ${dayNum}. ${h}h`,
        dayName,
        hour: h,
        waveHeight: Math.round((3 + variation * 12) * 10) / 10,
        wavePeriod: Math.round((10 + variation * 8) * 10) / 10,
        waveDirection: Math.round(280 + Math.sin(d) * 40),
        windSpeed: Math.round((5 + variation * 20) * 10) / 10,
        windDirection: Math.round(45 + Math.cos(d * 0.5) * 40),
      });
    }
  }

  return entries;
}

export interface ForecastResult {
  entries: ForecastEntry[];
  error: string | null;
}

export async function fetchForecastData(): Promise<ForecastResult> {
  try {
    const [waveText, windText] = await Promise.all([
      fetchWithProxy(WAVE_URL),
      fetchWithProxy(WIND_URL),
    ]);

    let entries = parseWindguruText(waveText, windText);

    if (entries.length === 0) {
      console.warn('Parsing returned no entries, using fallback');
      return {
        entries: generateFallbackForecast(),
        error: 'Could not parse forecast data, using sample data',
      };
    }

    return { entries, error: null };
  } catch (error) {
    console.error('Fetch error:', error);
    return {
      entries: generateFallbackForecast(),
      error: 'Using sample data (live fetch unavailable)',
    };
  }
}

/**
 * Find the forecast entry nearest to the current time.
 * Parses entry datetime format "Fri 16. 18h" and compares to current date/time.
 */
export function findNearestForecast(entries: ForecastEntry[]): ForecastEntry | null {
  if (entries.length === 0) return null;

  const now = new Date();
  const currentDayOfMonth = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let nearestEntry = entries[0];
  let smallestDiff = Infinity;

  for (const entry of entries) {
    // Parse day number from datetime like "Fri 16. 18h"
    const dayMatch = entry.datetime.match(/(\d+)\./);
    if (!dayMatch) continue;

    const entryDayOfMonth = parseInt(dayMatch[1]);
    const entryHour = entry.hour;

    // Build a Date object for this entry
    // Handle month boundary: if entry day is much smaller than current day,
    // it's likely next month
    let entryMonth = currentMonth;
    let entryYear = currentYear;

    if (entryDayOfMonth < currentDayOfMonth - 7) {
      // Entry is likely next month
      entryMonth = currentMonth + 1;
      if (entryMonth > 11) {
        entryMonth = 0;
        entryYear++;
      }
    }

    const entryDate = new Date(entryYear, entryMonth, entryDayOfMonth, entryHour, 0, 0);
    const diff = Math.abs(entryDate.getTime() - now.getTime());

    if (diff < smallestDiff) {
      smallestDiff = diff;
      nearestEntry = entry;
    }
  }

  return nearestEntry;
}

/**
 * Apply forecast entry values to a WaveConfig, returning the updated config.
 */
export function applyForecastToConfig(
  config: WaveConfig,
  entry: ForecastEntry
): WaveConfig {
  // Convert meteorological wave direction to simulation direction
  const simWaveDirection = (entry.waveDirection + 180) % 360;
  // Convert knots to m/s
  const windSpeedMs = entry.windSpeed * 0.514444;

  return {
    ...config,
    waveHeight: entry.waveHeight,
    wavePeriod: entry.wavePeriod,
    waveDirection: simWaveDirection,
    windSpeed: windSpeedMs,
    windDirection: entry.windDirection,
    windChopIntensity: Math.min(1, windSpeedMs / 15),
  };
}
