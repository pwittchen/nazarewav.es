import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { WaveMesh } from './WaveMesh';
import { Coast } from './Coast';
import type { WaveConfig } from '../config/waveConfig';

interface SceneProps {
  config: WaveConfig;
}

// Theme-specific scene colors
const sceneThemes = {
  dark: {
    background: '#0a0a0f',
    ambientColor: '#4a6fa5',
    ambientIntensity: 0.3,
    mainLightColor: '#6a8fc5',
    mainLightIntensity: 1.0,
    fillLightColor: '#2a3f5f',
    fillLightIntensity: 0.4,
    pointLightColor: '#8899bb',
    pointLightIntensity: 0.5,
    fogColor: '#0a0a0f',
  },
  light: {
    background: '#e8f4fc',
    ambientColor: '#87ceeb',
    ambientIntensity: 0.6,
    mainLightColor: '#fffaf0',
    mainLightIntensity: 1.5,
    fillLightColor: '#b0d4e8',
    fillLightIntensity: 0.6,
    pointLightColor: '#fff8dc',
    pointLightIntensity: 0.3,
    fogColor: '#c9e4f2',
  },
};

export function Scene({ config }: SceneProps) {
  const theme = sceneThemes[config.theme];

  return (
    <Canvas
      camera={{ position: [180, 65, 190], fov: 60, near: 0.1, far: 4000 }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
    >
      {/* Sky background */}
      <color attach="background" args={[theme.background]} />

      {/* Lighting */}
      <ambientLight intensity={theme.ambientIntensity} color={theme.ambientColor} />
      <directionalLight
        position={[50, 80, 30]}
        intensity={theme.mainLightIntensity}
        color={theme.mainLightColor}
      />
      <directionalLight
        position={[-30, 40, -50]}
        intensity={theme.fillLightIntensity}
        color={theme.fillLightColor}
      />
      <pointLight position={[100, 100, -100]} intensity={theme.pointLightIntensity} color={theme.pointLightColor} />

      {/* Wave mesh */}
      <WaveMesh config={config} />

      {/* Praia do Norte, Sítio cliffs, fort and lighthouse */}
      {config.showCoast && <Coast config={config} />}

      {/* Camera controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={30}
        maxDistance={config.showCoast ? 700 : 250}
        maxPolarAngle={Math.PI / 2.1}
        target={[-60, 5, 40]}
      />

      {/* Atmospheric fog */}
      <fog attach="fog" args={config.showCoast ? [theme.fogColor, 250, 1400] : [theme.fogColor, 150, 400]} />
    </Canvas>
  );
}
