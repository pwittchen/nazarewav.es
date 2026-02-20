import { useMemo } from 'react';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';

interface ShoreProps {
  config: WaveConfig;
  // Configurable parameters for realism vs performance tuning
  cliffHeight?: number;       // Height of main cliff face (default: 55)
  cliffSteepness?: number;    // Displacement magnitude (default: 18)
  beachWidth?: number;        // Width of beach section (default: 100)
  rockDensity?: number;       // Multiplier for rock count (default: 1.0)
  lighthouseOffset?: [number, number, number]; // Offset from default position
}

// Theme-specific shore colors
// Nazaré cliffs are sedimentary limestone/sandstone with warm earth tones
const shoreThemes = {
  dark: {
    // Cliff face - layered sedimentary rock
    cliff: '#3a3530',
    cliffLight: '#4a4540',
    cliffDark: '#2a2520',
    cliffWarm: '#403028',
    // Sedimentary strata bands
    strataLight: '#4a4238',
    strataDark: '#302820',
    strataOchre: '#453525',
    // Beach sand
    sandDry: '#5a5040',
    sandWet: '#3a3528',
    sandWaterline: '#2a2820',
    // Rocks
    rock: '#2a2520',
    rockLight: '#3a3530',
    rockDark: '#1a1510',
    // Underwater
    underwaterSand: '#282520',
    underwaterRock: '#1a1815',
  },
  light: {
    // Cliff face - warm limestone
    cliff: '#b8a890',
    cliffLight: '#c8b8a0',
    cliffDark: '#a09080',
    cliffWarm: '#c0a080',
    // Sedimentary strata bands
    strataLight: '#d0c0a8',
    strataDark: '#988870',
    strataOchre: '#c8a070',
    // Beach sand
    sandDry: '#e8d8b8',
    sandWet: '#a89870',
    sandWaterline: '#887858',
    // Rocks
    rock: '#807060',
    rockLight: '#9a8a70',
    rockDark: '#605040',
    // Underwater
    underwaterSand: '#706050',
    underwaterRock: '#504030',
  },
};

// Seeded random for consistent, deterministic placement
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// 3D noise function for natural terrain variation
function noise3D(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 0.5 + y * 0.3) * Math.cos(z * 0.4 + x * 0.2) +
    Math.sin(y * 0.7 - z * 0.5) * Math.cos(x * 0.6) * 0.5 +
    Math.sin(x * 1.3 + z * 1.1) * Math.cos(y * 0.9) * 0.25
  );
}

// Fractal Brownian motion for natural terrain
// Higher octaves = more detail but more computation
function fbm(x: number, y: number, octaves: number = 4): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise3D(x * frequency, y * frequency, i * 100);
    maxValue += amplitude;
    amplitude *= 0.5;    // Each octave contributes half as much
    frequency *= 2.1;    // Each octave is roughly twice the frequency
  }

  return value / maxValue;
}

// Create a displaced cliff section with realistic erosion patterns
// Returns PlaneGeometry with vertices displaced for natural rock appearance
function createCliffGeometry(
  width: number,
  height: number,
  segX: number,
  segY: number,
  seed: number,
  displaceAmount: number = 15
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const positions = geo.attributes.position.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];

    // Multi-scale displacement for natural rock appearance
    // Large features (big rock masses)
    const large = fbm(x * 0.03 + seed, y * 0.04, 3) * displaceAmount;
    // Medium features (rock shelves)
    const medium = fbm(x * 0.1 + seed, y * 0.12, 2) * (displaceAmount * 0.4);
    // Small features (surface texture)
    const small = fbm(x * 0.3 + seed, y * 0.35, 2) * (displaceAmount * 0.15);

    // Erosion at base - wave action carves undercuts
    const erosion = Math.max(0, 1 - (y + height / 2) / (height * 0.4)) *
      fbm(x * 0.15 + seed, y * 0.1, 2) * (displaceAmount * 0.5);

    // Overhangs at top - weathering creates jutting edges
    const overhang = Math.max(0, (y - height * 0.3) / (height * 0.2)) *
      fbm(x * 0.08 + seed, y * 0.05, 2) * (displaceAmount * 0.3);

    // Vertical crack patterns - typical of sedimentary cliffs
    const cracks = Math.sin(x * 0.4 + seed) * Math.sin(y * 0.2) * (displaceAmount * 0.15);

    positions[i + 2] = large + medium + small + erosion - overhang + cracks;
  }

  geo.computeVertexNormals();
  return geo;
}

// Create organic rock geometry with irregular, angular shapes
// NOT smooth spheres - uses icosahedron with heavy displacement
function createRockGeometry(
  baseSize: number,
  detail: number,
  seed: number,
  flattenBottom: number = 0.4,  // How much to flatten base for grounding
  stretchX: number = 1.3,       // Horizontal stretch
  stretchZ: number = 1.1        // Depth stretch
): THREE.IcosahedronGeometry {
  const geo = new THREE.IcosahedronGeometry(baseSize, detail);
  const positions = geo.attributes.position.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    // Flatten bottom for grounding (no floating rocks)
    const yScale = y < 0 ? flattenBottom : 1.0;

    // Add rocky, angular displacement
    // Use fbm for organic randomness
    const displacement = 1 + fbm(x * 0.08 + seed, y * 0.1 + z * 0.08 + seed, 3) * 0.3;

    // Sharp edges - add angular variation
    const angular = 1 + Math.sin(x * 2 + seed) * Math.cos(z * 2 + seed) * 0.1;

    positions[i] = x * displacement * angular * stretchX;
    positions[i + 1] = y * yScale * displacement * 0.85;  // Slightly flatter overall
    positions[i + 2] = z * displacement * angular * stretchZ;
  }

  geo.computeVertexNormals();
  return geo;
}

// Create beach geometry with slope and wet/dry gradient
function createBeachGeometry(
  width: number,
  depth: number,
  segX: number,
  segY: number
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(width, depth, segX, segY);
  const positions = geo.attributes.position.array as Float32Array;
  const colors = new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 1];  // This becomes Z after rotation

    // Beach slope - lower toward water
    const slopeY = (z / depth) * 8 - 4;  // Gradual slope

    // Small sand ripples
    const ripples = Math.sin(x * 0.2) * Math.cos(z * 0.3) * 0.3;

    positions[i + 2] = slopeY + ripples;

    // Color gradient: dry (top) to wet (bottom/waterline)
    const wetness = Math.max(0, Math.min(1, 1 - (z + depth / 2) / depth));
    const vertexIndex = i / 3;

    // Store wetness factor in vertex colors (used for material variation)
    colors[vertexIndex * 3] = wetness;      // R = wetness
    colors[vertexIndex * 3 + 1] = wetness;
    colors[vertexIndex * 3 + 2] = wetness;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function Shore({
  config,
  cliffHeight = 55,
  cliffSteepness = 18,
  beachWidth = 100,
  rockDensity = 1.0,
}: ShoreProps) {
  const theme = shoreThemes[config.theme];

  // === MAIN CLIFF FACE ===
  // Wide displaced plane forming the primary cliff backdrop
  const mainCliffGeo = useMemo(() =>
    createCliffGeometry(420, cliffHeight, 100, 28, 0, cliffSteepness), [cliffHeight, cliffSteepness]);

  // === CLIFF TOP TERRAIN ===
  // Rolling terrain above the cliffs
  const cliffTopGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(420, 120, 70, 40);
    const positions = geo.attributes.position.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 1];

      // Rolling coastal terrain with variation
      const height = fbm(x * 0.015, z * 0.02, 4) * 8 +
        fbm(x * 0.05, z * 0.06, 2) * 3;

      positions[i + 2] = height;
    }

    geo.computeVertexNormals();
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  // === SIDE CLIFF SECTIONS ===
  const leftCliffGeo = useMemo(() =>
    createCliffGeometry(140, 60, 35, 20, 100, cliffSteepness * 0.8), [cliffSteepness]);
  const rightCliffGeo = useMemo(() =>
    createCliffGeometry(140, 60, 35, 20, 200, cliffSteepness * 0.8), [cliffSteepness]);

  // === FORT PROMONTORY ===
  // The main rocky outcrop that supports the lighthouse/fort
  const fortMainRock = useMemo(() =>
    createRockGeometry(35, 4, 400, 0.3, 1.4, 1.2), []);
  const fortUpperRock = useMemo(() =>
    createRockGeometry(25, 3, 410, 0.5, 1.5, 1.0), []);

  // === FORT CONNECTOR ROCKS ===
  // Rocks connecting the fort promontory to the main cliff mass
  const fortConnectorRocks = useMemo(() => {
    const rocks: Array<{
      geo: THREE.IcosahedronGeometry;
      position: [number, number, number];
      rotation: [number, number, number];
    }> = [];

    const configs = [
      // Main connectors - large irregular masses
      { pos: [-80, 8, 158], size: 22, seed: 420, flatY: 0.35, strX: 1.3, strZ: 1.4 },
      { pos: [-60, 12, 155], size: 18, seed: 425, flatY: 0.4, strX: 1.2, strZ: 1.3 },
      { pos: [-100, 10, 155], size: 20, seed: 430, flatY: 0.35, strX: 1.3, strZ: 1.2 },
      { pos: [-75, 0, 150], size: 18, seed: 435, flatY: 0.3, strX: 1.4, strZ: 1.3 },
      { pos: [-90, 5, 148], size: 16, seed: 440, flatY: 0.35, strX: 1.2, strZ: 1.4 },
      // Side masses
      { pos: [-50, 15, 158], size: 15, seed: 445, flatY: 0.45, strX: 1.1, strZ: 1.2 },
      { pos: [-110, 12, 158], size: 17, seed: 450, flatY: 0.4, strX: 1.2, strZ: 1.1 },
      { pos: [-70, 18, 162], size: 14, seed: 455, flatY: 0.5, strX: 1.0, strZ: 1.3 },
      { pos: [-95, 15, 162], size: 16, seed: 460, flatY: 0.45, strX: 1.1, strZ: 1.2 },
      // Lower base rocks
      { pos: [-65, -3, 145], size: 14, seed: 465, flatY: 0.3, strX: 1.5, strZ: 1.2 },
      { pos: [-95, -2, 145], size: 15, seed: 470, flatY: 0.3, strX: 1.4, strZ: 1.3 },
      { pos: [-80, -5, 140], size: 12, seed: 475, flatY: 0.25, strX: 1.6, strZ: 1.1 },
    ];

    for (const cfg of configs) {
      const geo = createRockGeometry(cfg.size, 3, cfg.seed, cfg.flatY, cfg.strX, cfg.strZ);
      rocks.push({
        geo,
        position: cfg.pos as [number, number, number],
        rotation: [
          seededRandom(cfg.seed) * 0.25,
          seededRandom(cfg.seed + 1) * Math.PI * 2,
          seededRandom(cfg.seed + 2) * 0.25,
        ],
      });
    }

    return rocks;
  }, []);

  // === WATER-LEVEL ROCKS ===
  // Rocks at the waterline - wave-worn, partially submerged
  // Positioned to be embedded in the underwater shelf
  const waterRocks = useMemo(() => {
    const baseCount = Math.floor(30 * rockDensity);
    const rocks: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      rotation: [number, number, number];
      detail: number;
      baseScale: number; // For shadow/base geometry
    }> = [];

    for (let i = 0; i < baseCount; i++) {
      const x = -160 + seededRandom(i * 7) * 320;
      // Skip the fort promontory area
      if (x > -130 && x < -30) continue;

      const z = 128 + seededRandom(i * 7 + 1) * 28;
      const size = 2 + seededRandom(i * 7 + 2) * 6;

      // Position rocks lower - embedded in ground (negative Y offset)
      // Larger rocks sit higher but still embedded
      const embedDepth = size * 0.15;
      rocks.push({
        position: [x, -6 - embedDepth, z],
        // Very flat, weathered shapes - wave-worn boulders
        scale: [size * 1.5, size * 0.35, size * 1.2],
        rotation: [
          seededRandom(i * 11) * 0.2,  // Less tilt for stability
          seededRandom(i * 11 + 1) * Math.PI * 2,
          seededRandom(i * 11 + 2) * 0.2,
        ],
        detail: size > 4 ? 2 : 1,
        baseScale: size,
      });
    }

    return rocks;
  }, [rockDensity]);

  // === CLIFF FACE OUTCROPS ===
  // Jutting rock formations embedded in the cliff face
  const cliffOutcrops = useMemo(() => {
    const baseCount = Math.floor(35 * rockDensity);
    const outcrops: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      rotation: [number, number, number];
    }> = [];

    for (let i = 0; i < baseCount; i++) {
      const x = -190 + seededRandom(500 + i * 5) * 380;
      // Skip fort area
      if (x > -125 && x < -35) continue;

      const y = -5 + seededRandom(500 + i * 5 + 1) * 48;
      // Push Z deeper into cliff face so rocks are embedded, not floating
      const z = 155 + seededRandom(500 + i * 5 + 2) * 5;
      const size = 3 + seededRandom(500 + i * 5 + 3) * 7;

      outcrops.push({
        position: [x, y, z],
        // Elongated shapes jutting OUT from cliff (deeper Z scale)
        scale: [size * 0.8, size * 0.5, size * 1.8],
        rotation: [
          seededRandom(500 + i * 9) * 0.25 - 0.125,  // Less random tilt
          seededRandom(500 + i * 9 + 1) * Math.PI,
          seededRandom(500 + i * 9 + 2) * 0.25 - 0.125,
        ],
      });
    }

    return outcrops;
  }, [rockDensity]);

  // === BEACH GEOMETRY ===
  const beachGeo = useMemo(() =>
    createBeachGeometry(beachWidth, 25, 40, 15), [beachWidth]);

  // === SEDIMENTARY STRATA ===
  // Horizontal rock layers visible in cliff face
  const strataLayers = useMemo(() => {
    const layers: Array<{
      y: number;
      thickness: number;
      color: string;
    }> = [];

    // Create 5-7 visible strata bands at different heights
    const strataColors = [theme.strataLight, theme.strataDark, theme.strataOchre];
    for (let i = 0; i < 6; i++) {
      layers.push({
        y: -5 + i * 9 + seededRandom(800 + i) * 4,
        thickness: 0.8 + seededRandom(810 + i) * 0.6,
        color: strataColors[i % 3],
      });
    }

    return layers;
  }, [theme]);

  return (
    <group>
      {/* === SOLID CLIFF BACKING === */}
      {/* Large box behind cliff face to eliminate gaps and create solid rock mass */}
      <mesh position={[0, 20, 180]}>
        <boxGeometry args={[440, 70, 50]} />
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
        />
      </mesh>

      {/* === MAIN CLIFF FACE === */}
      <mesh geometry={mainCliffGeo} position={[0, 22, 158]}>
        <meshStandardMaterial
          color={theme.cliff}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* Second cliff layer - depth */}
      <mesh geometry={mainCliffGeo} position={[0, 20, 168]} scale={[1.02, 0.98, 1]}>
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* Third cliff layer - deepest */}
      <mesh geometry={mainCliffGeo} position={[0, 18, 178]} scale={[1.04, 0.96, 1]}>
        <meshStandardMaterial
          color={theme.cliffWarm}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* === SEDIMENTARY STRATA BANDS === */}
      {/* Visible horizontal layers typical of coastal cliffs */}
      {strataLayers.map((layer, i) => (
        <mesh
          key={`strata-${i}`}
          position={[0, layer.y, 156]}
        >
          <boxGeometry args={[400, layer.thickness, 3]} />
          <meshStandardMaterial
            color={layer.color}
            roughness={0.9}
            metalness={0.02}
          />
        </mesh>
      ))}

      {/* === CLIFF TOP TERRAIN === */}
      <mesh geometry={cliffTopGeo} position={[0, 48, 210]}>
        <meshStandardMaterial
          color={theme.cliffLight}
          roughness={0.92}
          metalness={0.02}
        />
      </mesh>

      {/* === LEFT CLIFF SECTION === */}
      {/* Solid backing for left cliff */}
      <mesh position={[-250, 22, 195]} rotation={[0, 0.35, 0]}>
        <boxGeometry args={[160, 65, 40]} />
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
        />
      </mesh>
      <mesh
        geometry={leftCliffGeo}
        position={[-240, 24, 178]}
        rotation={[0, 0.35, 0]}
      >
        <meshStandardMaterial
          color={theme.cliff}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>
      <mesh
        geometry={leftCliffGeo}
        position={[-238, 22, 188]}
        rotation={[0, 0.35, 0]}
        scale={[1.02, 0.95, 1]}
      >
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* === RIGHT CLIFF SECTION === */}
      {/* Solid backing for right cliff */}
      <mesh position={[250, 22, 195]} rotation={[0, -0.35, 0]}>
        <boxGeometry args={[160, 65, 40]} />
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
        />
      </mesh>
      <mesh
        geometry={rightCliffGeo}
        position={[240, 24, 178]}
        rotation={[0, -0.35, 0]}
      >
        <meshStandardMaterial
          color={theme.cliff}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>
      <mesh
        geometry={rightCliffGeo}
        position={[238, 22, 188]}
        rotation={[0, -0.35, 0]}
        scale={[1.02, 0.95, 1]}
      >
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.95}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* === FORT PROMONTORY === */}
      {/* Main rock mass under the lighthouse/fort */}
      <mesh geometry={fortMainRock} position={[-80, 22, 155]}>
        <meshStandardMaterial
          color={theme.rock}
          roughness={0.9}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* Upper rock directly under fort structure */}
      <mesh geometry={fortUpperRock} position={[-80, 35, 158]}>
        <meshStandardMaterial
          color={theme.cliffDark}
          roughness={0.88}
          metalness={0.02}
          flatShading
        />
      </mesh>

      {/* Connector rocks from fort to main cliff */}
      {fortConnectorRocks.map((rock, i) => (
        <mesh
          key={`fort-connector-${i}`}
          geometry={rock.geo}
          position={rock.position}
          rotation={rock.rotation}
        >
          <meshStandardMaterial
            color={i % 3 === 0 ? theme.rock : i % 3 === 1 ? theme.cliffDark : theme.cliff}
            roughness={0.9}
            metalness={0.02}
            flatShading
          />
        </mesh>
      ))}

      {/* === CLIFF FACE OUTCROPS === */}
      {/* Jutting rock formations on the cliff */}
      {cliffOutcrops.map((outcrop, i) => (
        <mesh
          key={`outcrop-${i}`}
          position={outcrop.position}
          rotation={outcrop.rotation}
          scale={outcrop.scale}
        >
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color={i % 3 === 0 ? theme.rockLight : theme.rock}
            roughness={0.93}
            metalness={0.02}
            flatShading
          />
        </mesh>
      ))}

      {/* === WATER LEVEL ROCKS === */}
      {/* Wave-worn rocks at the waterline with grounding shadows */}
      {waterRocks.map((rock, i) => (
        <group key={`water-rock-group-${i}`}>
          {/* Shadow/base disc - darker area where rock meets ground */}
          <mesh
            position={[rock.position[0], -11.9, rock.position[2]]}
            rotation={[-Math.PI / 2, 0, seededRandom(i * 13) * Math.PI]}
          >
            <circleGeometry args={[rock.baseScale * 0.9, 8]} />
            <meshStandardMaterial
              color={theme.rockDark}
              roughness={1}
              metalness={0}
            />
          </mesh>
          {/* Main rock */}
          <mesh
            position={rock.position}
            rotation={rock.rotation}
            scale={rock.scale}
          >
            <icosahedronGeometry args={[1, rock.detail]} />
            <meshStandardMaterial
              color={theme.rock}
              roughness={0.9}
              metalness={0.02}
              flatShading
            />
          </mesh>
        </group>
      ))}

      {/* === BEACH === */}
      {/* Sandy beach with slope toward water */}
      <group position={[100, -2, 130]}>
        {/* Dry sand area (upper beach) */}
        <mesh geometry={beachGeo} position={[0, 0, 8]} rotation={[0, 0.08, 0]}>
          <meshStandardMaterial
            color={theme.sandDry}
            roughness={1}
            metalness={0}
          />
        </mesh>

        {/* Wet sand area (lower beach near waterline) */}
        <mesh position={[0, -3, -5]} rotation={[-0.05, 0.08, 0]}>
          <planeGeometry args={[beachWidth, 15]} />
          <meshStandardMaterial
            color={theme.sandWet}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>

        {/* Waterline - darkest wet sand */}
        <mesh position={[0, -4.5, -12]} rotation={[-0.02, 0.08, 0]}>
          <planeGeometry args={[beachWidth + 10, 8]} />
          <meshStandardMaterial
            color={theme.sandWaterline}
            roughness={0.5}
            metalness={0.08}
          />
        </mesh>
      </group>

      {/* === UNDERWATER SHELF === */}
      {/* Nearshore bathymetry for wave breaking */}
      <mesh position={[0, -12, 100]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[420, 80]} />
        <meshStandardMaterial
          color={theme.underwaterSand}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Deeper underwater area */}
      <mesh position={[0, -18, 60]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[420, 60]} />
        <meshStandardMaterial
          color={theme.underwaterRock}
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* === SCATTERED BEACH ROCKS === */}
      {/* Small rocks on the beach - embedded in sand */}
      {Array.from({ length: Math.floor(15 * rockDensity) }).map((_, i) => {
        const x = 50 + seededRandom(900 + i) * beachWidth;
        const z = 118 + seededRandom(900 + i + 1) * 20;
        const size = 0.5 + seededRandom(900 + i + 2) * 1.5;
        // Embed rocks deeper - only top portion visible
        const embedY = -4 - size * 0.3;
        return (
          <group key={`beach-rock-group-${i}`}>
            {/* Shadow under rock */}
            <mesh
              position={[x, -3.95, z]}
              rotation={[-Math.PI / 2, 0, seededRandom(930 + i) * Math.PI]}
            >
              <circleGeometry args={[size * 0.7, 6]} />
              <meshStandardMaterial
                color={theme.sandWaterline}
                roughness={1}
                metalness={0}
              />
            </mesh>
            {/* Rock */}
            <mesh
              position={[x, embedY, z]}
              rotation={[
                seededRandom(920 + i) * 0.3,  // Less tilt
                seededRandom(920 + i + 1) * Math.PI,
                seededRandom(920 + i + 2) * 0.3,
              ]}
            scale={[size * 1.2, size * 0.5, size]}
          >
            <icosahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color={theme.rockDark}
              roughness={0.95}
              metalness={0.02}
              flatShading
            />
          </mesh>
          </group>
        );
      })}
    </group>
  );
}
