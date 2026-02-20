import { useState, useEffect } from 'react';
import { Scene } from './components/Scene';
import { ControlPanel } from './components/ControlPanel';
import { ForecastPanel } from './components/ForecastPanel';
import { defaultWaveConfig } from './config/waveConfig';
import type { WaveConfig } from './config/waveConfig';
import {
  fetchForecastData,
  findNearestForecast,
  applyForecastToConfig,
} from './utils/forecast';
import './App.css';

function App() {
  const [config, setConfig] = useState<WaveConfig>(defaultWaveConfig);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const [controlPanelOpen, setControlPanelOpen] = useState(false);
  const [forecastPanelOpen, setForecastPanelOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Apply theme to document for CSS variable switching
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.theme);
  }, [config.theme]);

  // On startup, fetch forecast and apply the nearest entry to current time
  useEffect(() => {
    fetchForecastData().then(result => {
      const nearest = findNearestForecast(result.entries);
      if (nearest) {
        setConfig(current => applyForecastToConfig(current, nearest));
      }
    });
  }, []);

  const handleControlPanelOpenChange = (open: boolean) => {
    setControlPanelOpen(open);
    if (open) setForecastPanelOpen(false);
  };

  const handleForecastPanelOpenChange = (open: boolean) => {
    setForecastPanelOpen(open);
    if (open) setControlPanelOpen(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Nazaré Waves</h1>
        <span className="subtitle">Wave Simulator</span>
      </header>

      <main className="app-main">
        <Scene config={config} />
        <ForecastPanel
          config={config}
          onChange={setConfig}
          {...(isMobile ? { isOpen: forecastPanelOpen, onOpenChange: handleForecastPanelOpenChange } : {})}
        />
        {!(isMobile && forecastPanelOpen) && (
          <ControlPanel
            config={config}
            onChange={setConfig}
            {...(isMobile ? { isOpen: controlPanelOpen, onOpenChange: handleControlPanelOpenChange } : {})}
          />
        )}
      </main>

      <a
        href="https://github.com/pwittchen/nazare-waves"
        target="_blank"
        rel="noopener noreferrer"
        className="source-link"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
        <span>Source</span>
      </a>
    </div>
  );
}

export default App;
