import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { WaveMesh } from './WaveMesh';
import type { WaveConfig } from '../config/waveConfig';

interface SceneProps {
  config: WaveConfig;
}

export function Scene({ config }: SceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 40, 100], fov: 60, near: 0.1, far: 1000 }}
      gl={{ antialias: true, alpha: false }}
    >
      {/* Dark sky background */}
      <color attach="background" args={['#0a0a0f']} />

      {/* Lighting for dark theme */}
      <ambientLight intensity={0.3} color="#4a6fa5" />
      <directionalLight
        position={[50, 80, 30]}
        intensity={1.0}
        color="#6a8fc5"
      />
      <directionalLight
        position={[-30, 40, -50]}
        intensity={0.4}
        color="#2a3f5f"
      />
      {/* Subtle moonlight effect */}
      <pointLight position={[100, 100, -100]} intensity={0.5} color="#8899bb" />

      {/* Wave mesh */}
      <WaveMesh config={config} />

      {/* Camera controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        minDistance={30}
        maxDistance={250}
        maxPolarAngle={Math.PI / 2.1}
        target={[0, 0, 0]}
      />

      {/* Dark atmospheric fog */}
      <fog attach="fog" args={['#0a0a0f', 150, 400]} />
    </Canvas>
  );
}
