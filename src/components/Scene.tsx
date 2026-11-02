import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { WaveMesh } from './WaveMesh';
import { Coast } from './Coast';
import { Sky } from './Sky';
import { CameraRig } from './CameraRig';
import { cameraViews, type WaveConfig, type CameraView } from '../config/waveConfig';
import type { SkyState } from '../utils/sky';

interface SceneProps {
  config: WaveConfig;
  sky: SkyState;
  view: { name: CameraView };
}

export function Scene({ config, sky, view }: SceneProps) {
  const sunPosition = sky.sunDirection.clone().multiplyScalar(400);

  return (
    <Canvas
      camera={{ position: [...cameraViews.shore.position], fov: 55, near: 1, far: 30000 }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
    >
      {/* Sky dome (also the environment reflected by the water) */}
      <color attach="background" args={[sky.horizonColor]} />
      <Sky sky={sky} windDirection={config.windDirection} windSpeed={config.windSpeed} />

      {/* Lighting: sun, moon and sky light, all driven by time of day and clouds */}
      <hemisphereLight color={sky.skyLightColor} groundColor={sky.groundLightColor} intensity={sky.skyLightIntensity} />
      <directionalLight position={sunPosition} intensity={sky.sunIntensity} color={sky.sunColor} />
      {/* Moonlight from high in the south-east so night scenes keep some shape */}
      <directionalLight position={[-150, 300, 120]} intensity={sky.moonIntensity} color="#9db0d8" />

      {/* Wave mesh */}
      <WaveMesh config={config} />

      {/* Praia do Norte, Sítio cliffs, fort and lighthouse */}
      {config.showCoast && <Coast config={config} night={sky.isNight} />}

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.05}
        minDistance={30}
        maxDistance={config.showCoast ? 3500 : 250}
        maxPolarAngle={Math.PI / 2.1}
        target={[...cameraViews.shore.target]}
      />

      <CameraRig view={view} />

      {/* Atmospheric fog */}
      <fog attach="fog" args={config.showCoast ? [sky.horizonColor, 1200, 11000] : [sky.horizonColor, 150, 400]} />
    </Canvas>
  );
}
