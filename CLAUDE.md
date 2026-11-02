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

This is a 3D wave simulator built with React Three Fiber (R3F), simulating the Nazaré waves over the real coast and seabed.

### Key Files

- **`src/config/waveConfig.ts`** - Central configuration: `WaveConfig` interface, `defaultWaveConfig`, `wavePresets` and `configLimits` for UI sliders. Wave heights are offshore significant heights and directions are compass bearings the swell comes from. Also holds sky & weather (`timeOfDay`, `cloudCover`, `liveSky`).

- **`src/utils/waveField.ts`** - Swell propagation over the real seabed after Hope et al. 2026 (`docs/egusphere-2026-2778.pdf`), pure TS with no Three.js: ray tracing (energy, refraction, focusing, canyon shadow), reflection at the canyon rim (rays split at the 50 m contour by `trenchReflection()`, Kirby & Dalrymple's trench coefficient), an eikonal solve (incident phase, so crests bend) and shoaling, for one direction and period. Reflected rays carry their own phase into `crossRe/crossIm`, the coherent reflected/incident ratio, which `crossedSwell()` folds into one wave of local gain and phase (the interference beams); `swellSurface()` takes its `crossing` to raise the breaker index where seas cross. Also `swellHeight()`/`swellSurface()`, the surface formula, and the set envelope (`setEnvelope()`, Rayleigh-distributed set peaks scaled so the sea state has exactly the configured Hs; `swellClockStart()` anchors the clock mid-set at `PEAK` when a field is solved). Wavelength and speed follow from the period by the dispersion relation; there is no hand-placed canyon amplification.

- **`src/components/useWaveField.ts`** - Re-solves the field (~250 ms) when direction or period change, debounced.

- **`src/components/WaveMesh.tsx`** - 300x300 m CPU-animated mesh at the world origin, on the surf zone. Samples the field per vertex, adds the secondary swell, wind chop and foam.

- **`src/components/Surfers.tsx`** - Surfers (`surfers` toggle in Display), true to scale, rendered by WaveMesh. Each waits in a lineup found where set waves start breaking, catches a set wave as its face arrives, rides locked to the face just ahead of the crest (`sampleSwell()` phase gradient) while trimming along it, then paddles back. On tow-in days (≥ 6 m) each has a jet ski that circles with them, follows on the shoulder and returns them on its sled. Their surface height repeats WaveMesh's formula (swell, secondary, chop), so keep them in sync.

- **`src/utils/surf.ts`** - `surfability()`: whether the conditions can be surfed (coast on, ≥ 1 m, ≥ 7 s, not blown out by strong or onshore wind) and the style (paddle / tow-in). The Surfers toggle is disabled with the reason shown when they can't.

- **`src/components/FarOcean.tsx`** - GPU ocean out to ±2.4 km. Its vertex shader mirrors `crossedSwell()`, `swellSurface()` and WaveMesh, so keep them in sync. The field reaches it as a half-float RGBA texture (phase, gain, crossRe, crossIm) plus a depth texture.

- **`src/utils/waterShader.ts`** - Wind chop trains and GLSL noise/ripples shared by both water meshes.

- **`src/utils/geodata.ts`** - Decodes the baked binaries in `src/data/`: 10 m terrain, 30 m regional seabed, OSM land cover and building footprints.

- **`scripts/bake-nazare.mjs`** - Regenerates `src/data/*.bin` from raw downloads. Never edit the binaries by hand; see the README for sources.

- **`src/utils/terrain.ts`** - `terrainHeight()` (baked data plus the fort rock, which the 25 m DEM cannot resolve), surveyed landmark positions (`FORT_POSITION`, `LARGO`, `SANCTUARY`, `ERMIDA`, `FUNICULAR`, `HARBOUR_LIGHTS`) and noise helpers. World frame: metres, 1:1 and true to the compass: origin at 39.6075 N 9.0868 W, +X = north, +Z = east (land), -Z = Atlantic.

- **`src/components/Coast.tsx`** - Terrain and outer hills with vertex colors from land cover, mole armour stones, Santuário and Ermida da Memória (shown when `showCoast` is on).

- **`src/components/Town.tsx`** - One house per OSM footprint (Nazaré, Sítio, Pederneira), taller seafront blocks, beach tents, fishing boats, harbour lights and night lights.

- **`src/components/Funicular.tsx`** - Ascensor da Nazaré: animated cars on a viaduct from the town up to the Sítio.

- **`src/components/Lighthouse.tsx`** - Forte de São Miguel Arcanjo (surveyed outline) with the red Farol tower; rotating beam and spotlights at night.

- **`src/components/CameraRig.tsx`** - Flies the camera to a viewpoint from `cameraViews` (`shore`, `peak`) when a preset asks for it (`presetViews` in waveConfig).

- **`src/components/DroneCamera.tsx`** - Cinematic drone flight (`droneFlight` toggle in Display): a slow orbit over the bay between the canyon peak and the fort, with drifting radius and altitude, terrain clearance over the cliffs and a gimbal panning between peak, fort and beach. Disables the orbit controls while flying and hands the camera back without a jump.

- **`src/components/Scene.tsx`** - R3F Canvas setup with camera, sun/moon/sky lighting, OrbitControls and fog, all driven by `SkyState`.

- **`src/utils/sky.ts`** - Time of day and weather: real sun position over Nazaré, day phase, sky/light/fog colors muted by cloud cover (`computeSky()`) and the water palette (`waterAlbedo()`). The UI theme is derived from it (dark at night, light otherwise).

- **`src/components/Sky.tsx`** - Procedural sky dome (gradient, sun, drifting clouds, stars), also rendered into the environment map so the water reflects the sky.

- **`src/utils/instancing.ts`** - Shared helpers for instanced meshes, houses and night light points.

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
│   └── WaveMesh (solves the wave field, animates geometry)
├── ForecastPanel (fetches live data, applies to config)
└── ControlPanel (reads/writes config via onChange)
```

On startup, App fetches forecast data and applies the nearest forecast entry to the wave config. App computes `SkyState` from `timeOfDay`/`cloudCover` (ticking with the current Nazaré time while `liveSky` is on) and passes it to Scene. The `WaveConfig` object flows down from App. Both ForecastPanel and ControlPanel can update the config via onChange. WaveMesh reads config values each frame in its `useFrame` loop.

## Deployment

Deployed to GitHub Pages via `.github/workflows/deploy.yml` on push to `master`. The `base` path in `vite.config.ts` is set to `./` (relative), making the app work on any domain or subdirectory.
