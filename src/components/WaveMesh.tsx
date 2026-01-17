import { useRef, useMemo, useEffect } from 'react';
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

    // Initialize vertex colors for foam effect
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geo;
  }, []);

  // Store original positions
  const originalPositions = useMemo(() => {
    return new Float32Array(geometry.attributes.position.array);
  }, [geometry]);

  // Parse base wave color for blending with foam
  const baseColor = useMemo(() => {
    const color = new THREE.Color(config.waveColor);
    return { r: color.r, g: color.g, b: color.b };
  }, [config.waveColor]);

  // Update base color when waveColor changes
  useEffect(() => {
    const color = new THREE.Color(config.waveColor);
    baseColor.r = color.r;
    baseColor.g = color.g;
    baseColor.b = color.b;
  }, [config.waveColor, baseColor]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Only advance time if animation is enabled
    if (config.animateWaves) {
      timeRef.current += delta * config.timeScale;
    }
    const time = timeRef.current;

    const geo = meshRef.current.geometry as THREE.BufferGeometry;
    const positions = geo.attributes.position.array as Float32Array;
    const colors = geo.attributes.color.array as Float32Array;

    // Calculate wave speed from period (deep water: c = gT/2π)
    // wavePeriod affects how fast waves travel, waveSpeed is a multiplier
    const gravity = 9.8;
    const primaryWaveSpeed = (gravity * config.wavePeriod) / (2 * Math.PI) * config.waveSpeed * 0.3;
    const secondaryWaveSpeed = (gravity * config.secondaryWavePeriod) / (2 * Math.PI) * config.waveSpeed * 0.3;

    // Wind speed affects chop intensity (Beaufort scale approximation)
    // windSpeed in m/s, higher wind = more chop
    const windChopMultiplier = config.windChopIntensity * (1 + config.windSpeed / 20);

    // Water clarity affects color saturation (turbid water = less saturated, greener)
    const clarityFactor = config.waterClarity;

    // Precompute direction values
    const primaryDir = (config.waveDirection * Math.PI) / 180;
    const primaryK = (2 * Math.PI) / config.waveLength;
    const primarySin = Math.sin(primaryDir);
    const primaryCos = Math.cos(primaryDir);

    const secondaryDir = (config.secondaryWaveDirection * Math.PI) / 180;
    const secondaryWaveLength = config.waveLength * 0.6;
    const secondaryK = (2 * Math.PI) / secondaryWaveLength;
    const secondarySin = Math.sin(secondaryDir);
    const secondaryCos = Math.cos(secondaryDir);

    // Grid spacing for slope calculation
    const gridSpacing = 300 / 200; // 1.5m between vertices

    for (let i = 0; i < positions.length; i += 3) {
      const x = originalPositions[i];
      const z = originalPositions[i + 2];
      const vertexIndex = i / 3;

      // Canyon amplification - waves get bigger in the center
      const distFromCenter = Math.abs(x) / 150;
      const canyonFactor = 1 + (config.canyonAmplification - 1) *
        Math.exp(-distFromCenter * distFromCenter / (config.canyonFocusWidth * config.canyonFocusWidth));

      // Depth effect - waves steepen toward shore (positive Z = toward camera)
      const shoreDistance = (z + 150) / 300; // 0 at back, 1 at front
      const depthFactor = 1 + config.canyonDepthEffect * shoreDistance;

      // Primary wave phase
      const primaryPhase = primaryK * (
        primarySin * x +
        primaryCos * z -
        primaryWaveSpeed * time
      );
      const primaryAmplitude = config.waveHeight * canyonFactor * depthFactor;
      const primaryWave = primaryAmplitude * Math.sin(primaryPhase);

      // Calculate primary wave slope (derivative)
      const primarySlope = primaryAmplitude * primaryK * Math.cos(primaryPhase);

      // Secondary wave (cross swell)
      const secondaryPhase = secondaryK * (
        secondarySin * x +
        secondaryCos * z -
        secondaryWaveSpeed * time
      );
      const secondaryAmplitude = config.secondaryWaveHeight * canyonFactor * 0.7;
      const secondaryWave = secondaryAmplitude * Math.sin(secondaryPhase);

      // Calculate secondary wave slope
      const secondarySlope = secondaryAmplitude * secondaryK * Math.cos(secondaryPhase);

      // Wind chop (small turbulent waves)
      let windChop = 0;
      let chopSlope = 0;
      if (windChopMultiplier > 0) {
        const chopTime = time * 2;
        const chop1 = Math.sin(x * 0.08 + chopTime * 1.1) * Math.cos(z * 0.06 + chopTime * 0.9);
        const chop2 = Math.sin(x * 0.15 - chopTime * 0.7) * Math.cos(z * 0.12 + chopTime * 1.3);
        const chop3 = Math.sin((x + z) * 0.1 + chopTime * 0.8);
        windChop = (chop1 * 0.5 + chop2 * 0.3 + chop3 * 0.2) * windChopMultiplier * 3;

        // Approximate chop slope
        const chopDeriv1 = Math.cos(x * 0.08 + chopTime * 1.1) * 0.08 * Math.cos(z * 0.06 + chopTime * 0.9);
        const chopDeriv2 = Math.cos(x * 0.15 - chopTime * 0.7) * 0.15 * Math.cos(z * 0.12 + chopTime * 1.3);
        chopSlope = (chopDeriv1 * 0.5 + chopDeriv2 * 0.3) * windChopMultiplier * 3;
      }

      // Set Y position (height)
      const totalHeight = primaryWave + secondaryWave + windChop;
      positions[i + 1] = totalHeight;

      // Calculate total slope magnitude for foam
      const totalSlope = Math.abs(primarySlope + secondarySlope + chopSlope);

      // Wave steepness (slope relative to wavelength) - higher = more likely to break
      const steepness = totalSlope / gridSpacing;

      // Foam calculation based on steepness and threshold
      // foamThreshold: steepness at which foam starts appearing (0-1 maps to 0-2 slope)
      // foamIntensity: how much foam is visible (0-1)
      const foamThreshold = config.foamThreshold * 2;
      let foamAmount = 0;

      if (steepness > foamThreshold) {
        // Foam increases with steepness above threshold
        foamAmount = Math.min(1, (steepness - foamThreshold) * 2) * config.foamIntensity;

        // More foam on wave crests (where height is positive and high)
        const crestBonus = Math.max(0, totalHeight / (config.waveHeight * 2));
        foamAmount = Math.min(1, foamAmount + crestBonus * config.foamIntensity * 0.5);
      }

      // Apply water clarity to base color
      // Lower clarity = more green/murky tint
      const murkiness = 1 - clarityFactor;
      const turbidR = baseColor.r * (1 - murkiness * 0.3);
      const turbidG = baseColor.g * (1 + murkiness * 0.1);
      const turbidB = baseColor.b * (1 - murkiness * 0.2);

      // Blend between water color and white foam
      colors[vertexIndex * 3] = turbidR + (1 - turbidR) * foamAmount;
      colors[vertexIndex * 3 + 1] = turbidG + (1 - turbidG) * foamAmount;
      colors[vertexIndex * 3 + 2] = turbidB + (1 - turbidB) * foamAmount;
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  });

  // Material opacity based on water clarity (clearer = slightly more transparent)
  const opacity = config.wireframe ? 1 : 0.85 + config.waterClarity * 0.15;

  return (
    <mesh ref={meshRef} geometry={geometry} position={[0, 0, 0]}>
      <meshStandardMaterial
        vertexColors={!config.wireframe}
        color={config.wireframe ? config.waveColor : '#ffffff'}
        wireframe={config.wireframe}
        metalness={config.wireframe ? 0 : 0.1}
        roughness={config.wireframe ? 1 : 0.3 - config.waterClarity * 0.2}
        side={THREE.DoubleSide}
        emissive={config.wireframe ? config.waveColor : '#000000'}
        emissiveIntensity={config.wireframe ? 0.2 : 0}
        transparent={!config.wireframe}
        opacity={opacity}
      />
    </mesh>
  );
}
