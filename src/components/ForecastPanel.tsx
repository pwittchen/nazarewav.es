import { useState, useEffect } from 'react';
import type { WaveConfig } from '../config/waveConfig';
import {
  fetchForecastData,
  applyForecastToConfig,
  findNearestForecast,
  type ForecastEntry,
} from '../utils/forecast';

interface ForecastPanelProps {
  config: WaveConfig;
  onChange: (config: WaveConfig) => void;
}

interface ForecastData {
  entries: ForecastEntry[];
  lastUpdated: string;
  loading: boolean;
  error: string | null;
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

    const result = await fetchForecastData();
    setForecast({
      entries: result.entries,
      lastUpdated: new Date().toLocaleTimeString(),
      loading: false,
      error: result.error,
    });

    // Select the nearest forecast time by default
    if (result.entries.length > 0) {
      const nearest = findNearestForecast(result.entries);
      if (nearest) {
        const idx = result.entries.findIndex(e => e === nearest);
        if (idx >= 0) {
          setSelectedIndex(idx);
          setSelectedDay(nearest.dayName);
        }
      }
    }
  };

  useEffect(() => {
    if (isOpen && forecast.entries.length === 0) {
      fetchForecast();
    }
  }, [isOpen]);

  const applyForecast = (entry: ForecastEntry) => {
    onChange(applyForecastToConfig(config, entry));
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
          <div className="forecast-links">
            <a
              href="https://www.windguru.cz/75856"
              target="_blank"
              rel="noopener noreferrer"
              className="forecast-link"
            >
              Windguru ↗
            </a>
            <a
              href="https://nazarewaves.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="forecast-link"
            >
              NazareWaves ↗
            </a>
          </div>
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
                onClick={() => {
                  setSelectedIndex(entry.index);
                  applyForecast(entry);
                }}
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
                <button
                  className="detail-item detail-item-button"
                  onClick={() => {
                    const nearest = findNearestForecast(forecast.entries);
                    if (nearest) {
                      const idx = forecast.entries.findIndex(e => e === nearest);
                      if (idx >= 0) {
                        setSelectedIndex(idx);
                        setSelectedDay(nearest.dayName);
                      }
                      applyForecast(nearest);
                    }
                  }}
                  title="Apply current forecast (nearest to now)"
                >
                  <span className="detail-label">Show current conditions</span>
                  <span className="detail-value">NOW</span>
                </button>
              </div>

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
