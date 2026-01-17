import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';

interface WaveMeshProps {
  config: WaveConfig;
}

export function WaveMesh({ config }: WaveMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);

  // Create geometry with proper orientation (XZ plane, Y up)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(300, 300, 200, 200);
    geo.rotateX(-Math.PI / 2); // Rotate so it lies flat in XZ plane
    return geo;
  }, []);

  // Store original positions
  const originalPositions = useMemo(() => {
    return new Float32Array(geometry.attributes.position.array);
  }, [geometry]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Only advance time if animation is enabled
    if (config.animateWaves) {
      timeRef.current += delta * config.timeScale;
    }
    const time = timeRef.current;

    const geo = meshRef.current.geometry as THREE.BufferGeometry;
    const positions = geo.attributes.position.array as Float32Array;

    for (let i = 0; i < positions.length; i += 3) {
      const x = originalPositions[i];
      const z = originalPositions[i + 2];

      // Canyon amplification - waves get bigger in the center
      const distFromCenter = Math.abs(x) / 150;
      const canyonFactor = 1 + (config.canyonAmplification - 1) *
        Math.exp(-distFromCenter * distFromCenter / (config.canyonFocusWidth * config.canyonFocusWidth));

      // Depth effect - waves steepen toward shore (positive Z = toward camera)
      const shoreDistance = (z + 150) / 300; // 0 at back, 1 at front
      const depthFactor = 1 + config.canyonDepthEffect * shoreDistance;

      // Primary wave - moves toward shore (positive Z direction)
      // Wave direction: 0° = from back to front, 90° = from left to right
      const primaryDir = (config.waveDirection * Math.PI) / 180;
      const primaryK = (2 * Math.PI) / config.waveLength;
      // Wave speed based on deep water wave equation
      const primarySpeed = Math.sqrt(9.8 * config.waveLength / (2 * Math.PI)) * 0.5;
      // Phase moves waves in the direction they're traveling
      const primaryPhase = primaryK * (
        Math.sin(primaryDir) * x +
        Math.cos(primaryDir) * z -
        primarySpeed * time
      );
      const primaryWave = config.waveHeight * canyonFactor * depthFactor * Math.sin(primaryPhase);

      // Secondary wave (cross swell)
      const secondaryDir = (config.secondaryWaveDirection * Math.PI) / 180;
      const secondaryWaveLength = config.waveLength * 0.6;
      const secondaryK = (2 * Math.PI) / secondaryWaveLength;
      const secondarySpeed = Math.sqrt(9.8 * secondaryWaveLength / (2 * Math.PI)) * 0.5;
      const secondaryPhase = secondaryK * (
        Math.sin(secondaryDir) * x +
        Math.cos(secondaryDir) * z -
        secondarySpeed * time
      );
      const secondaryWave = config.secondaryWaveHeight * canyonFactor * 0.7 * Math.sin(secondaryPhase);

      // Wind chop (small turbulent waves)
      let windChop = 0;
      if (config.windChopIntensity > 0) {
        const chopTime = time * 2;
        const chop1 = Math.sin(x * 0.08 + chopTime * 1.1) * Math.cos(z * 0.06 + chopTime * 0.9);
        const chop2 = Math.sin(x * 0.15 - chopTime * 0.7) * Math.cos(z * 0.12 + chopTime * 1.3);
        const chop3 = Math.sin((x + z) * 0.1 + chopTime * 0.8);
        windChop = (chop1 * 0.5 + chop2 * 0.3 + chop3 * 0.2) * config.windChopIntensity * 3;
      }

      // Set Y position (height)
      positions[i + 1] = primaryWave + secondaryWave + windChop;
    }

    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  });

  // Derive emissive color (darker version of wave color)
  const emissiveColor = config.wireframe ? config.waveColor : '#000000';

  return (
    <mesh ref={meshRef} geometry={geometry} position={[0, 0, 0]}>
      <meshStandardMaterial
        color={config.waveColor}
        wireframe={config.wireframe}
        metalness={config.wireframe ? 0 : 0.1}
        roughness={config.wireframe ? 1 : 0.3}
        side={THREE.DoubleSide}
        emissive={emissiveColor}
        emissiveIntensity={config.wireframe ? 0.2 : 0}
      />
    </mesh>
  );
}
