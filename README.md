# Nazaré Waves Simulator

A 3D wave simulator inspired by the famous Nazaré waves in Portugal. Built with React, Three.js, and TypeScript.

See the app online: https://pwittchen.github.io/nazare-waves/ (url will be updated in the future)

## Features

- **Animated 3D Wave Mesh** - Realistic wave simulation with configurable parameters
- **Canyon Effect** - Simulates the Nazaré underwater canyon that amplifies wave height in the center
- **Wireframe/Solid Display** - Toggle between grid mesh and solid surface rendering
- **Natural Wave Movement** - Waves propagate naturally toward the viewer
- **Real-time Controls** - Adjust all parameters with instant visual feedback
- **Presets** - Quick presets for Calm, Moderate, Big, and Extreme wave conditions
- **Dark Theme UI** - Clean, minimalistic interface inspired by shadcn/ui

## Installation

```bash
bun install
```

## Usage

```bash
# Development server
bun dev

# Production build
bun run build

# Preview production build
bun run preview
```

## Configuration

All wave parameters can be configured in one place: `src/config/waveConfig.ts`

### Wave Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `waveHeight` | Base wave height in meters | 8 |
| `wavePeriod` | Time between wave crests in seconds | 14 |
| `waveDirection` | Direction waves come from (0° = toward viewer) | 0 |
| `waveLength` | Distance between wave crests in meters | 200 |

### Secondary Wave (Cross Swell)

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secondaryWaveHeight` | Secondary swell height | 2 |
| `secondaryWavePeriod` | Secondary swell period | 8 |
| `secondaryWaveDirection` | Secondary swell direction | 30 |

### Wind Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `windSpeed` | Wind speed in m/s | 15 |
| `windDirection` | Wind direction in degrees | 45 |
| `windChopIntensity` | Small wave chop intensity (0-1) | 0.3 |

### Canyon Effect

| Parameter | Description | Default |
|-----------|-------------|---------|
| `canyonAmplification` | Wave amplification factor (1-4x) | 2.0 |
| `canyonFocusWidth` | Width of the amplification zone | 0.4 |
| `canyonDepthEffect` | Wave steepening near shore (0-1) | 0.7 |

### Display Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `wireframe` | Display as wireframe grid mesh | true |
| `animateWaves` | Enable natural wave movement | true |
| `timeScale` | Animation speed multiplier | 1.0 |

## Controls

- **Mouse Drag** - Orbit camera around the scene
- **Scroll** - Zoom in/out
- **Control Panel** - Adjust all wave parameters in real-time

## Tech Stack

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [React](https://react.dev/) - UI framework
- [Three.js](https://threejs.org/) - 3D graphics library
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) - React renderer for Three.js
- [React Three Drei](https://github.com/pmndrs/drei) - Useful helpers for R3F
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tool

## About Nazaré

Nazaré is a fishing village in Portugal famous for having some of the largest waves in the world. The Nazaré Canyon, an underwater canyon that extends for about 230 km, focuses and amplifies Atlantic swells, creating waves that can exceed 30 meters in height. This simulator attempts to recreate this phenomenon by applying canyon amplification effects to the wave simulation.

## Deployment

The app is automatically deployed to GitHub Pages on every push to `master` branch.

To enable GitHub Pages deployment:

1. Go to repository **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Push to `master` branch to trigger deployment

## License

GPL
