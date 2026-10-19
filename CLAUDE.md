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

- **`src/config/waveConfig.ts`** - Central configuration for all wave parameters. Contains `WaveConfig` interface, `defaultWaveConfig`, `wavePresets` (calm/moderate/big/extreme), and `configLimits` for UI sliders. This is the single source of truth for wave behavior. Also holds sky & weather (`timeOfDay`, `cloudCover`, `liveSky`).

- **`src/components/WaveMesh.tsx`** - The 3D wave mesh using Three.js PlaneGeometry. Animates vertex positions each frame using:
  - Gerstner-style wave equations for primary and secondary swells
  - Canyon amplification (waves bigger in center)
  - Depth factor (waves steepen toward shore)
  - Wind chop (turbulent small waves)

- **`src/components/Scene.tsx`** - R3F Canvas setup with camera, sun/moon/sky lighting, OrbitControls, and fog, all driven by `SkyState`.

- **`src/utils/sky.ts`** - Time of day and weather: real sun position over Nazaré, day phase (night/dawn/morning/day/dusk), sky/light/fog colors muted by cloud cover (`computeSky()`), and the realistic water palette (`waterAlbedo()`) shared by WaveMesh and the FarOcean shader. The UI theme is derived from it (dark at night, light otherwise).

- **`src/components/Sky.tsx`** - Procedural sky dome (gradient, sun, drifting clouds, stars), also rendered into the environment map so the water reflects the sky.

- **`src/utils/terrain.ts`** - Procedural Nazaré coastline: `terrainHeight()` (Praia do Norte beach/dunes, Sítio plateau cliffs, fort promontory, canyon head, Nazaré bay with the town flats, escarpment, Pedra do Guilhim, harbour breakwater, funicular cutting), landmark constants (`LARGO`, `ROAD`, `FUNICULAR`, `BREAKWATER`), wave damping over the shallows, and the shore map texture used by the far-ocean shader. World orientation: -Z = Atlantic (west), +Z = land (east), +X = north, -X = south (headland).

- **`src/components/Coast.tsx`** - Terrain mesh with vertex colors, pine forest, dune scrub, cliff-foot rocks, Sítio village with the Largo, Santuário and Ermida da Memória (shown when `showCoast` is on).

- **`src/components/Town.tsx`** - Nazaré town below the Sítio: house grid with a taller seafront row, beach tents, fishing boats, breakwater beacon and night lights.

- **`src/components/Funicular.tsx`** - Ascensor da Nazaré: animated cars on a viaduct from the town up the cliff to the Sítio.

- **`src/utils/instancing.ts`** - Shared helpers for instanced meshes, houses and night light points.

- **`src/components/Lighthouse.tsx`** - Forte de São Miguel Arcanjo with the red lighthouse tower; rotating beam and spotlights at night.

- **`src/components/FarOcean.tsx`** - GPU-animated ocean extending the wave mesh out to the coast. Its vertex shader mirrors the WaveMesh wave equations, so keep both in sync.

- **`src/components/ControlPanel.tsx`** - UI panel with sliders and toggles for real-time parameter adjustment.

- **`src/components/ForecastPanel.tsx`** - UI panel displaying live Nazaré wave forecast. Shows forecast data grouped by day/hour, allows selecting specific forecast times, and applies forecast values to the wave config.

- **`src/utils/forecast.ts`** - Utilities for fetching and parsing wave/wind forecast data from Windguru (via CORS proxies). Contains:
  - `fetchForecastData()` - Fetches wave and wind data, falls back to generated sample data if unavailable
  - `applyForecastToConfig()` - Maps forecast values to WaveConfig
  - `findNearestForecast()` - Finds forecast entry closest to current time
  - `ForecastEntry` interface for forecast data structure (includes cloud cover from Windguru HCLD/MCLD/LCLD and rain)

### Data Flow

```
App (holds WaveConfig state)
├── Scene
│   └── WaveMesh (reads config, animates geometry)
├── ForecastPanel (fetches live data, applies to config)
└── ControlPanel (reads/writes config via onChange)
```

On startup, App fetches forecast data and applies the nearest forecast entry to the wave config. App computes `SkyState` from `timeOfDay`/`cloudCover` (ticking with the current Nazaré time while `liveSky` is on) and passes it to Scene. The `WaveConfig` object flows down from App. Both ForecastPanel and ControlPanel can update the config via onChange. WaveMesh reads config values each frame in its `useFrame` loop.

## Deployment

Deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to `master`. The `base` path in `vite.config.ts` is set to `./` (relative), making the app work on any domain or subdirectory.
