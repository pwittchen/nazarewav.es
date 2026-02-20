import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';

interface LighthouseProps {
  config: WaveConfig;
  position?: [number, number, number];
}

// Theme-specific colors for the Fort and Lighthouse
// Forte de São Miguel Arcanjo has whitewashed walls typical of Portuguese coastal forts
const lighthouseThemes = {
  dark: {
    // Whitewashed walls appear bluish-gray at night
    wallMain: '#b8b8c0',
    wallShadow: '#808088',
    wallHighlight: '#d0d0d8',
    wallDirty: '#a0a0a8',
    // Red clay tiles on roofs
    roofTile: '#6a3020',
    roofTileLight: '#8a4030',
    // Red iron lantern
    lanternRed: '#8b0000',
    lanternRedBright: '#aa2222',
    // Lamp and glow
    lamp: '#ffd700',
    lampGlow: '#ffff99',
    // Iron/metal
    ironDark: '#2a2a2a',
    ironMedium: '#3a3a3a',
    // Wood doors
    woodDark: '#2a1a12',
    // Stone foundation (exposed rock under whitewash)
    stoneBase: '#4a4540',
  },
  light: {
    // White/cream sunlit walls
    wallMain: '#f5f2e8',
    wallShadow: '#d8d4c8',
    wallHighlight: '#ffffff',
    wallDirty: '#e8e4d8',
    // Terracotta roof tiles
    roofTile: '#c45a30',
    roofTileLight: '#d47040',
    // Red lantern
    lanternRed: '#cc0000',
    lanternRedBright: '#dd3333',
    // Lamp
    lamp: '#ffcc00',
    lampGlow: '#ffffcc',
    // Iron
    ironDark: '#4a4a4a',
    ironMedium: '#5a5a5a',
    // Wood
    woodDark: '#4a3a2a',
    // Stone foundation
    stoneBase: '#8a8070',
  },
};

// Seeded random for consistent weathering
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function Lighthouse({ config, position = [-80, 48, 160] }: LighthouseProps) {
  const theme = lighthouseThemes[config.theme];
  const lightRef = useRef<THREE.SpotLight>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  // Animate the lighthouse beam
  useFrame((state) => {
    if (lightRef.current && beamRef.current) {
      const time = state.clock.elapsedTime;
      // Slow rotation typical of historic lighthouses (roughly 20 seconds per revolution)
      const angle = time * 0.3;
      lightRef.current.target.position.set(
        Math.sin(angle) * 150,
        0,
        Math.cos(angle) * 150
      );
      lightRef.current.target.updateMatrixWorld();
      beamRef.current.rotation.y = -angle;
    }
  });

  // Fort dimensions based on real Forte de São Miguel Arcanjo
  // The real fort is roughly 35m x 25m, with 4-5m high walls
  const fortWidth = 32;
  const fortDepth = 24;
  const fortWallHeight = 5;
  const wallThickness = 2;

  // Keeper's house dimensions
  const houseWidth = 18;
  const houseDepth = 12;
  const houseHeight = 6;

  // Lantern tower dimensions (cylindrical red iron lantern)
  const lanternHeight = 7;
  const lanternRadius = 1.8;

  // Create weathered wall geometry with slight irregularity
  const createWeatheredBox = useMemo(() => {
    return (width: number, height: number, depth: number, seed: number): THREE.BufferGeometry => {
      const geo = new THREE.BoxGeometry(width, height, depth, 4, 4, 4);
      const positions = geo.attributes.position.array as Float32Array;

      // Add subtle irregularity to simulate aged plaster
      for (let i = 0; i < positions.length; i += 3) {
        const offset = seededRandom(seed + i) * 0.15 - 0.075;
        positions[i] += offset;
        positions[i + 1] += offset * 0.5;
        positions[i + 2] += offset;
      }

      geo.computeVertexNormals();
      return geo;
    };
  }, []);

  // Main fort wall geometry
  const fortBaseGeo = useMemo(() => createWeatheredBox(fortWidth, fortWallHeight, fortDepth, 100), [createWeatheredBox]);

  // Keeper's house geometry
  const houseGeo = useMemo(() => createWeatheredBox(houseWidth, houseHeight, houseDepth, 200), [createWeatheredBox]);

  return (
    <group position={position}>
      {/* === STONE FOUNDATION === */}
      {/* Exposed stone base where fort meets the cliff */}
      <mesh position={[0, -1, 0]}>
        <boxGeometry args={[fortWidth + 4, 3, fortDepth + 4]} />
        <meshStandardMaterial
          color={theme.stoneBase}
          roughness={0.95}
          metalness={0.05}
        />
      </mesh>

      {/* === MAIN FORT WALLS === */}
      {/* Whitewashed perimeter walls with typical Portuguese coastal fort appearance */}
      <mesh geometry={fortBaseGeo} position={[0, fortWallHeight / 2, 0]}>
        <meshStandardMaterial
          color={theme.wallMain}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>

      {/* === PARAPET WALLS (Raised defensive walls) === */}
      {/* Front parapet - thicker with embrasures */}
      <mesh position={[0, fortWallHeight + 1, -fortDepth / 2 + wallThickness / 2]}>
        <boxGeometry args={[fortWidth, 2, wallThickness]} />
        <meshStandardMaterial
          color={theme.wallHighlight}
          roughness={0.8}
          metalness={0.02}
        />
      </mesh>

      {/* Back parapet */}
      <mesh position={[0, fortWallHeight + 1, fortDepth / 2 - wallThickness / 2]}>
        <boxGeometry args={[fortWidth, 2, wallThickness]} />
        <meshStandardMaterial
          color={theme.wallShadow}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>

      {/* Side parapets */}
      <mesh position={[-fortWidth / 2 + wallThickness / 2, fortWallHeight + 1, 0]}>
        <boxGeometry args={[wallThickness, 2, fortDepth]} />
        <meshStandardMaterial
          color={theme.wallMain}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>
      <mesh position={[fortWidth / 2 - wallThickness / 2, fortWallHeight + 1, 0]}>
        <boxGeometry args={[wallThickness, 2, fortDepth]} />
        <meshStandardMaterial
          color={theme.wallMain}
          roughness={0.85}
          metalness={0.02}
        />
      </mesh>

      {/* === CORNER TURRETS === */}
      {/* Small cylindrical turrets at corners - typical of 16th century Portuguese forts */}
      {[
        [-fortWidth / 2, -fortDepth / 2],
        [fortWidth / 2, -fortDepth / 2],
        [-fortWidth / 2, fortDepth / 2],
        [fortWidth / 2, fortDepth / 2],
      ].map(([x, z], i) => (
        <group key={`turret-${i}`}>
          <mesh position={[x, fortWallHeight / 2 + 0.5, z]}>
            <cylinderGeometry args={[2.5, 3, fortWallHeight + 1, 8]} />
            <meshStandardMaterial
              color={i < 2 ? theme.wallHighlight : theme.wallShadow}
              roughness={0.85}
              metalness={0.02}
            />
          </mesh>
          {/* Turret cap */}
          <mesh position={[x, fortWallHeight + 1.5, z]}>
            <cylinderGeometry args={[2.8, 2.8, 0.5, 8]} />
            <meshStandardMaterial
              color={theme.wallMain}
              roughness={0.8}
              metalness={0.02}
            />
          </mesh>
        </group>
      ))}

      {/* === MAIN ENTRANCE === */}
      {/* Arched entrance on the cliff side (back) */}
      <group position={[0, 0, fortDepth / 2]}>
        {/* Door recess */}
        <mesh position={[0, 2.5, 0.1]}>
          <boxGeometry args={[4, 5, 0.5]} />
          <meshStandardMaterial
            color={theme.woodDark}
            roughness={0.9}
            metalness={0.1}
          />
        </mesh>
        {/* Arch frame */}
        <mesh position={[0, 5.5, -0.1]}>
          <boxGeometry args={[5.5, 1.5, 0.8]} />
          <meshStandardMaterial
            color={theme.wallShadow}
            roughness={0.8}
            metalness={0.02}
          />
        </mesh>
      </group>

      {/* === KEEPER'S HOUSE === */}
      {/* White building with terracotta tile roof inside the fort */}
      <group position={[0, fortWallHeight, 3]}>
        {/* Main house body */}
        <mesh geometry={houseGeo} position={[0, houseHeight / 2, 0]}>
          <meshStandardMaterial
            color={theme.wallMain}
            roughness={0.75}
            metalness={0.02}
          />
        </mesh>

        {/* Roof - clay tiles (typical Portuguese) */}
        <mesh position={[0, houseHeight + 1.5, 0]} rotation={[0, 0, 0]}>
          <boxGeometry args={[houseWidth + 1, 0.3, houseDepth + 1]} />
          <meshStandardMaterial
            color={theme.roofTile}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>

        {/* Sloped roof ridge */}
        <mesh position={[0, houseHeight + 2.5, 0]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[4, 0.5, houseDepth + 0.5]} />
          <meshStandardMaterial
            color={theme.roofTileLight}
            roughness={0.65}
            metalness={0.05}
          />
        </mesh>

        {/* Windows - front */}
        {[-5, 0, 5].map((x, i) => (
          <mesh key={`window-front-${i}`} position={[x, houseHeight * 0.5, -houseDepth / 2 - 0.1]}>
            <boxGeometry args={[1.5, 2, 0.2]} />
            <meshStandardMaterial
              color={theme.ironDark}
              roughness={0.5}
              metalness={0.3}
            />
          </mesh>
        ))}

        {/* Windows - sides */}
        <mesh position={[-houseWidth / 2 - 0.1, houseHeight * 0.5, 0]}>
          <boxGeometry args={[0.2, 2, 1.5]} />
          <meshStandardMaterial
            color={theme.ironDark}
            roughness={0.5}
            metalness={0.3}
          />
        </mesh>
        <mesh position={[houseWidth / 2 + 0.1, houseHeight * 0.5, 0]}>
          <boxGeometry args={[0.2, 2, 1.5]} />
          <meshStandardMaterial
            color={theme.ironDark}
            roughness={0.5}
            metalness={0.3}
          />
        </mesh>
      </group>

      {/* === LIGHTHOUSE LANTERN === */}
      {/* Red iron lantern mounted on a platform - the iconic Farol da Nazaré */}
      <group position={[0, fortWallHeight + houseHeight + 1.5, -houseDepth / 2 + 2]}>
        {/* Lantern base platform */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[lanternRadius + 1, lanternRadius + 1.5, 1, 16]} />
          <meshStandardMaterial
            color={theme.wallShadow}
            roughness={0.8}
            metalness={0.05}
          />
        </mesh>

        {/* Service gallery/balcony */}
        <mesh position={[0, 0.8, 0]}>
          <cylinderGeometry args={[lanternRadius + 1.2, lanternRadius + 1.2, 0.3, 16]} />
          <meshStandardMaterial
            color={theme.ironMedium}
            roughness={0.4}
            metalness={0.6}
          />
        </mesh>

        {/* Railing posts */}
        {Array.from({ length: 16 }).map((_, i) => {
          const angle = (i / 16) * Math.PI * 2;
          const r = lanternRadius + 1.1;
          return (
            <mesh
              key={`post-${i}`}
              position={[Math.cos(angle) * r, 1.4, Math.sin(angle) * r]}
            >
              <cylinderGeometry args={[0.06, 0.06, 1, 6]} />
              <meshStandardMaterial
                color={theme.ironDark}
                roughness={0.3}
                metalness={0.7}
              />
            </mesh>
          );
        })}

        {/* Railing ring */}
        <mesh position={[0, 1.8, 0]}>
          <torusGeometry args={[lanternRadius + 1.1, 0.08, 8, 24]} />
          <meshStandardMaterial
            color={theme.ironDark}
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>

        {/* Main lantern body - red iron cylinder */}
        <mesh position={[0, lanternHeight / 2 + 1, 0]}>
          <cylinderGeometry args={[lanternRadius, lanternRadius, lanternHeight, 16]} />
          <meshStandardMaterial
            color={theme.lanternRed}
            roughness={0.35}
            metalness={0.65}
          />
        </mesh>

        {/* Lantern glass band (light-emitting section) */}
        <mesh position={[0, lanternHeight * 0.55 + 1, 0]}>
          <cylinderGeometry args={[lanternRadius + 0.05, lanternRadius + 0.05, lanternHeight * 0.45, 16]} />
          <meshStandardMaterial
            color={theme.lampGlow}
            roughness={0.1}
            metalness={0.1}
            transparent
            opacity={0.6}
            emissive={theme.lamp}
            emissiveIntensity={config.theme === 'dark' ? 1.5 : 0.5}
          />
        </mesh>

        {/* Horizontal bands on lantern */}
        {[0.3, 0.5, 0.7].map((h, i) => (
          <mesh key={`band-${i}`} position={[0, 1 + lanternHeight * h, 0]}>
            <torusGeometry args={[lanternRadius + 0.08, 0.1, 8, 24]} />
            <meshStandardMaterial
              color={theme.lanternRedBright}
              roughness={0.4}
              metalness={0.5}
            />
          </mesh>
        ))}

        {/* Dome roof */}
        <mesh position={[0, lanternHeight + 1.5, 0]}>
          <sphereGeometry args={[lanternRadius + 0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial
            color={theme.lanternRedBright}
            roughness={0.35}
            metalness={0.6}
          />
        </mesh>

        {/* Ventilator ball on top */}
        <mesh position={[0, lanternHeight + 2.3, 0]}>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshStandardMaterial
            color={theme.lanternRed}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>

        {/* Lightning rod */}
        <mesh position={[0, lanternHeight + 3, 0]}>
          <cylinderGeometry args={[0.05, 0.03, 1.2, 6]} />
          <meshStandardMaterial
            color={theme.ironDark}
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>

        {/* Internal lamp (light source) */}
        <mesh position={[0, lanternHeight * 0.55 + 1, 0]}>
          <sphereGeometry args={[0.8, 16, 16]} />
          <meshStandardMaterial
            color={theme.lamp}
            emissive={theme.lamp}
            emissiveIntensity={config.theme === 'dark' ? 4 : 2}
          />
        </mesh>

        {/* Lighthouse beam (visible in dark theme) */}
        {config.theme === 'dark' && (
          <>
            <spotLight
              ref={lightRef}
              position={[0, lanternHeight * 0.55 + 1, 0]}
              angle={0.1}
              penumbra={0.3}
              intensity={100}
              color={theme.lamp}
              distance={400}
              castShadow={false}
            />

            {/* Visible light beam cone */}
            <mesh
              ref={beamRef}
              position={[0, lanternHeight * 0.55 + 1, 0]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <coneGeometry args={[40, 200, 16, 1, true]} />
              <meshBasicMaterial
                color={theme.lamp}
                transparent
                opacity={0.02}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          </>
        )}

        {/* Ambient glow point light */}
        <pointLight
          position={[0, lanternHeight * 0.55 + 1, 0]}
          intensity={config.theme === 'dark' ? 40 : 10}
          color={theme.lamp}
          distance={120}
        />
      </group>

      {/* === COURTYARD DETAILS === */}
      {/* Courtyard floor */}
      <mesh position={[0, fortWallHeight + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[fortWidth - wallThickness * 2, fortDepth - wallThickness * 2]} />
        <meshStandardMaterial
          color={theme.wallDirty}
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* Flagpole */}
      <group position={[fortWidth / 2 - 3, fortWallHeight, -fortDepth / 2 + 3]}>
        <mesh position={[0, 4, 0]}>
          <cylinderGeometry args={[0.08, 0.12, 8, 8]} />
          <meshStandardMaterial
            color={theme.ironDark}
            roughness={0.4}
            metalness={0.6}
          />
        </mesh>
      </group>
    </group>
  );
}
