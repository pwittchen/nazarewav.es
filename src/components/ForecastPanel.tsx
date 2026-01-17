import { useState, useEffect } from 'react';
import type { WaveConfig } from '../config/waveConfig';

interface ForecastPanelProps {
  config: WaveConfig;
  onChange: (config: WaveConfig) => void;
}

interface ForecastEntry {
  datetime: string;
  dayName: string;
  hour: number;
  waveHeight: number;
  wavePeriod: number;
  waveDirection: number;
  windSpeed: number;
  windDirection: number;
}

interface ForecastData {
  entries: ForecastEntry[];
  lastUpdated: string;
  loading: boolean;
  error: string | null;
}

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
];
const WAVE_URL = 'https://micro.windguru.cz/?s=75856&m=gfswh';
const WIND_URL = 'https://micro.windguru.cz/?s=75856&m=gfs';

interface WindData {
  datetime: string;
  windSpeed: number;
  windDirection: number;
}

function parseWindguruText(waveText: string, windText: string): ForecastEntry[] {
  const entries: ForecastEntry[] = [];

  try {
    // Extract content from <pre> tag
    const wavePreMatch = waveText.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    const windPreMatch = windText.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);

    const waveContent = wavePreMatch ? wavePreMatch[1] : waveText;
    const windContent = windPreMatch ? windPreMatch[1] : windText;

    // Parse wind data first into a map for quick lookup
    // Format: " Fri 16. 18h      13      19     NNW     335 ..."
    // Columns: Date, WSPD, GUST, WDIRN, WDEG, ...
    const windDataMap = new Map<string, WindData>();
    const windLines = windContent.split('\n');

    for (const line of windLines) {
      // Match lines like " Fri 16. 18h      13      19     NNW     335"
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

    // Parse wave data and combine with wind data (keeping chronological order)
    // Format: " Fri 16. 18h     4.2     WNW     304      14 ..."
    // Columns: Date, HTSGW, WADIRN, WADEG, PERPW, ...
    const waveLines = waveContent.split('\n');

    for (const line of waveLines) {
      // Match lines like " Fri 16. 18h     4.2     WNW     304      14"
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

// Fallback: generate sample forecast if fetch fails
function generateFallbackForecast(): ForecastEntry[] {
  const entries: ForecastEntry[] = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const dayName = days[date.getDay()];
    const dayNum = date.getDate();

    // Generate 8 entries per day (every 3 hours)
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

export function ForecastPanel({ config, onChange }: ForecastPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [forecast, setForecast] = useState<ForecastData>({
    entries: [],
    lastUpdated: '',
    loading: false,
    error: null,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Group entries by day
  const groupedByDay = forecast.entries.reduce((acc, entry, index) => {
    const day = entry.dayName;
    if (!acc[day]) {
      acc[day] = [];
    }
    acc[day].push({ ...entry, index });
    return acc;
  }, {} as Record<string, (ForecastEntry & { index: number })[]>);

  const days = Object.keys(groupedByDay);
  const [selectedDay, setSelectedDay] = useState(days[0] || '');

  useEffect(() => {
    if (days.length > 0 && !days.includes(selectedDay)) {
      setSelectedDay(days[0]);
    }
  }, [days, selectedDay]);

  const fetchForecast = async () => {
    setForecast(prev => ({ ...prev, loading: true, error: null }));

    try {
      const [waveText, windText] = await Promise.all([
        fetchWithProxy(WAVE_URL),
        fetchWithProxy(WIND_URL),
      ]);

      let entries = parseWindguruText(waveText, windText);

      // Use fallback if parsing failed
      if (entries.length === 0) {
        console.warn('Parsing returned no entries, using fallback');
        entries = generateFallbackForecast();
        setForecast({
          entries,
          lastUpdated: new Date().toLocaleTimeString(),
          loading: false,
          error: 'Could not parse forecast data, using sample data',
        });
      } else {
        setForecast({
          entries,
          lastUpdated: new Date().toLocaleTimeString(),
          loading: false,
          error: null,
        });
      }
    } catch (error) {
      console.error('Fetch error:', error);
      // Use fallback data
      setForecast({
        entries: generateFallbackForecast(),
        lastUpdated: new Date().toLocaleTimeString(),
        loading: false,
        error: 'Using sample data (live fetch unavailable)',
      });
    }
  };

  useEffect(() => {
    if (isOpen && forecast.entries.length === 0) {
      fetchForecast();
    }
  }, [isOpen]);

  const applyForecast = (entry: ForecastEntry) => {
    // Convert meteorological wave direction to simulation direction
    const simWaveDirection = (entry.waveDirection + 180) % 360;
    // Convert knots to m/s
    const windSpeedMs = entry.windSpeed * 0.514444;

    onChange({
      ...config,
      waveHeight: entry.waveHeight,
      wavePeriod: entry.wavePeriod,
      waveDirection: simWaveDirection,
      windSpeed: windSpeedMs,
      windDirection: entry.windDirection,
      windChopIntensity: Math.min(1, windSpeedMs / 15),
    });
  };

  const selectedEntry = forecast.entries[selectedIndex];

  const getWaveClass = (height: number) => {
    if (height < 3) return 'wave-small';
    if (height < 6) return 'wave-medium';
    if (height < 10) return 'wave-large';
    if (height < 15) return 'wave-big';
    return 'wave-giant';
  };

  if (!isOpen) {
    return (
      <button
        className="forecast-toggle"
        onClick={() => setIsOpen(true)}
        aria-label="Open forecast"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
        <span>Forecast</span>
      </button>
    );
  }

  return (
    <div className="forecast-panel">
      <div className="forecast-header">
        <div className="forecast-title">
          <h2>Nazaré Forecast</h2>
          <a
            href="https://www.windguru.cz/75856"
            target="_blank"
            rel="noopener noreferrer"
            className="forecast-link"
          >
            Windguru ↗
          </a>
        </div>
        <button
          className="panel-toggle"
          onClick={() => setIsOpen(false)}
          aria-label="Close forecast"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {forecast.loading ? (
        <div className="forecast-loading">Loading forecast...</div>
      ) : (
        <>
          {forecast.error && (
            <div className="forecast-error">{forecast.error}</div>
          )}

          <div className="forecast-days">
            {days.map(day => (
              <button
                key={day}
                className={`day-button ${day === selectedDay ? 'active' : ''}`}
                onClick={() => setSelectedDay(day)}
              >
                {day}
              </button>
            ))}
          </div>

          <div className="forecast-hours">
            {groupedByDay[selectedDay]?.map(entry => (
              <button
                key={entry.index}
                className={`hour-button ${entry.index === selectedIndex ? 'active' : ''}`}
                onClick={() => setSelectedIndex(entry.index)}
              >
                <span className="hour-time">{entry.hour.toString().padStart(2, '0')}:00</span>
                <span className={`hour-wave ${getWaveClass(entry.waveHeight)}`}>
                  {entry.waveHeight}m
                </span>
              </button>
            ))}
          </div>

          {selectedEntry && (
            <div className="forecast-details">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Wave Height</span>
                  <span className="detail-value">{selectedEntry.waveHeight} m</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Wave Period</span>
                  <span className="detail-value">{selectedEntry.wavePeriod} s</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Wave Dir</span>
                  <span className="detail-value">{selectedEntry.waveDirection}°</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Wind</span>
                  <span className="detail-value">{selectedEntry.windSpeed} kn</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Wind Dir</span>
                  <span className="detail-value">{selectedEntry.windDirection}°</span>
                </div>
              </div>

              <button
                className="apply-forecast-button"
                onClick={() => applyForecast(selectedEntry)}
              >
                Apply to Simulator
              </button>
            </div>
          )}

          <div className="forecast-footer">
            <span>Updated: {forecast.lastUpdated}</span>
            <button className="refresh-button" onClick={fetchForecast}>
              Refresh
            </button>
          </div>
        </>
      )}
    </div>
  );
}
