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

  // On startup, fetch forecast and apply the nearest entry to current time
  useEffect(() => {
    fetchForecastData().then(result => {
      const nearest = findNearestForecast(result.entries);
      if (nearest) {
        setConfig(current => applyForecastToConfig(current, nearest));
      }
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Nazaré Waves</h1>
        <span className="subtitle">Wave Simulator</span>
      </header>

      <main className="app-main">
        <Scene config={config} />
        <ForecastPanel config={config} onChange={setConfig} />
        <ControlPanel config={config} onChange={setConfig} />
      </main>
    </div>
  );
}

export default App;
