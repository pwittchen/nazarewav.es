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
  cloudCover: number;        // Combined cloud cover (0-1)
  rain: number;              // Precipitation in mm/h
}

interface WindData {
  datetime: string;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  rain: number;
}

// Windguru reports "-" for missing values
function parseValue(value: string | undefined): number {
  const n = parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

// Combine high/medium/low cloud layers (%) into one cover value. Low clouds hide the
// sky the most, thin high cirrus the least; layers overlap randomly.
function combineCloudLayers(high: number, mid: number, low: number): number {
  return 1 - (1 - low / 100) * (1 - 0.85 * mid / 100) * (1 - 0.5 * high / 100);
}

// CORS proxies, tried in order. r.jina.ai returns the page as plain text
// (no <pre> wrapper) — the parser handles both forms.
const CORS_PROXIES = [
  'https://r.jina.ai/',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];
const PROXY_TIMEOUT_MS = 15000;
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
      const match = line.match(/^\s*(\w{3})\s+(\d+)\.\s+(\d+)h\s+(\d+)\s+\d+\s+\w+\s+(\d+)(.*)$/);
      if (match) {
        const [, dayName, dayNum, hourStr, windSpeedStr, windDirStr, rest] = match;
        const key = `${dayName} ${dayNum}. ${hourStr}h`;
        // Remaining columns: TMP SLP HCLD MCLD LCLD APCP APCP1 RH
        const [, , high, mid, low, , rain1h] = rest.trim().split(/\s+/);
        windDataMap.set(key, {
          datetime: key,
          windSpeed: parseInt(windSpeedStr),
          windDirection: parseInt(windDirStr),
          cloudCover: combineCloudLayers(parseValue(high), parseValue(mid), parseValue(low)),
          rain: parseValue(rain1h),
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
          cloudCover: windData?.cloudCover ?? 0.2,
          rain: windData?.rain ?? 0,
        });
      }
    }
  } catch (e) {
    console.error('Error parsing Windguru data:', e);
  }

  return entries;
}

/**
 * Fetch `url` through the first CORS proxy that returns usable content.
 * `marker` is a string that must appear in the response (a column header from
 * the Windguru table) — proxies happily return 200 with their own error pages,
 * so a status check alone is not enough.
 */
async function fetchWithProxy(url: string, marker: string): Promise<string> {
  const errors: string[] = [];

  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(proxy + encodeURIComponent(url), {
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
      if (!response.ok) {
        errors.push(`${proxy} -> HTTP ${response.status}`);
        continue;
      }

      const text = await response.text();
      if (!text.includes(marker)) {
        errors.push(`${proxy} -> unexpected content`);
        continue;
      }

      return text;
    } catch (e) {
      errors.push(`${proxy} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(`All CORS proxies failed: ${errors.join('; ')}`);
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
        cloudCover: Math.round((0.5 + Math.sin(d * 1.3 + h * 0.2) * 0.45) * 100) / 100,
        rain: 0,
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
      fetchWithProxy(WAVE_URL, 'HTSGW'),
      fetchWithProxy(WIND_URL, 'WSPD'),
    ]);

    const entries = parseWindguruText(waveText, windText);

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
  // Convert meteorological wave direction (where waves come from) to the simulation's
  // travel direction. The scene uses +X = north and +Z = east (towards the coast),
  // and waves travel along (sin θ, cos θ), so a westerly swell (270°) maps to θ = 0.
  const simWaveDirection = (270 - entry.waveDirection + 360) % 360;
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
    // Rain only falls from a mostly covered sky
    cloudCover: entry.rain > 0 ? Math.max(entry.cloudCover, 0.85) : entry.cloudCover,
  };
}
