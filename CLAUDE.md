# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install          # Install dependencies
bun dev              # Start development server
bun run build        # TypeScript check + production build
bun run preview      # Preview production build
bun run lint         # Run ESLint
```

## Architecture

This is a 3D wave simulator built with React Three Fiber (R3F), simulating the famous Nazaré waves with underwater canyon amplification effects.

### Key Files

- **`src/config/waveConfig.ts`** - Central configuration for all wave parameters. Contains `WaveConfig` interface, `defaultWaveConfig`, `wavePresets` (calm/moderate/big/extreme), and `configLimits` for UI sliders. This is the single source of truth for wave behavior. Includes theme support (dark/light).

- **`src/components/WaveMesh.tsx`** - The 3D wave mesh using Three.js PlaneGeometry. Animates vertex positions each frame using:
  - Gerstner-style wave equations for primary and secondary swells
  - Canyon amplification (waves bigger in center)
  - Depth factor (waves steepen toward shore)
  - Wind chop (turbulent small waves)

- **`src/components/Scene.tsx`** - R3F Canvas setup with camera, lighting, OrbitControls, and fog.

- **`src/components/ControlPanel.tsx`** - UI panel with sliders and toggles for real-time parameter adjustment.

- **`src/components/ForecastPanel.tsx`** - UI panel displaying live Nazaré wave forecast. Shows forecast data grouped by day/hour, allows selecting specific forecast times, and applies forecast values to the wave config.

- **`src/utils/forecast.ts`** - Utilities for fetching and parsing wave/wind forecast data from Windguru (via CORS proxies). Contains:
  - `fetchForecastData()` - Fetches wave and wind data, falls back to generated sample data if unavailable
  - `applyForecastToConfig()` - Maps forecast values to WaveConfig
  - `findNearestForecast()` - Finds forecast entry closest to current time
  - `ForecastEntry` interface for forecast data structure

### Data Flow

```
App (holds WaveConfig state)
├── Scene
│   └── WaveMesh (reads config, animates geometry)
├── ForecastPanel (fetches live data, applies to config)
└── ControlPanel (reads/writes config via onChange)
```

On startup, App fetches forecast data and applies the nearest forecast entry to the wave config. The `WaveConfig` object flows down from App. Both ForecastPanel and ControlPanel can update the config via onChange. WaveMesh reads config values each frame in its `useFrame` loop.

## Deployment

Deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to `master`. The `base` path in `vite.config.ts` is set to `./` (relative), making the app work on any domain or subdirectory.
