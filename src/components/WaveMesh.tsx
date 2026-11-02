import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import { surveyedHeight, clamp, fbm } from '../utils/terrain';
import { SET_WRAP, GRAVITY, swellClockStart, swellHeight, swellSurface, type SwellShape } from '../utils/waveField';
import { useWaveField } from './useWaveField';
import { FarOcean } from './FarOcean';
import { chopTrains, NOISE_GLSL, RIPPLE_NORMAL_GLSL } from '../utils/waterShader';
import { waterAlbedo, waterShallowness, WATER_ROUGHNESS } from '../utils/sky';

interface WaveMeshProps {
  config: WaveConfig;
}

const DEEP = 1000;

export function WaveMesh({ config }: WaveMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeRef = useRef(0);
  const rippleTime = useMemo(() => ({ value: 0 }), []);
  const field = useWaveField(config.waveDirection, config.wavePeriod);
  // Phase of the swell, omega * t, accumulated so that it stays smooth when the period changes
  const swellClock = useRef(swellClockStart(field));
  useEffect(() => { swellClock.current = swellClockStart(field); }, [field]);

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

  // Local depth and water shallowness per vertex
  const seabed = useMemo(() => {
    const count = originalPositions.length / 3;
    const depth = new Float32Array(count);
    const shallowness = new Float32Array(count);
    const foamPattern = new Float32Array(count); // Breaks foam up into streaks and patches
    for (let v = 0; v < count; v++) {
      const x = originalPositions[v * 3];
      const z = originalPositions[v * 3 + 2];
      depth[v] = -surveyedHeight(x, z);
      shallowness[v] = waterShallowness(depth[v]);
      foamPattern[v] = 0.5 + 0.8 * fbm(x * 0.05, z * 0.05, 4);
    }
    return { depth, shallowness, foamPattern };
  }, [originalPositions]);

  // Swell phase and gain per vertex, resampled when a new field is solved
  const swell = useMemo(() => {
    const count = originalPositions.length / 3;
    const phase = new Float32Array(count);
    const gain = new Float32Array(count);
    const { grid, k0, dirX, dirZ } = field;
    for (let v = 0; v < count; v++) {
      const x = originalPositions[v * 3];
      const z = originalPositions[v * 3 + 2];
      const fx = clamp((x - grid.minX) / grid.cell, 0, grid.nx - 1.001);
      const fz = clamp((z - grid.minZ) / grid.cell, 0, grid.nz - 1.001);
      const i = Math.floor(fx);
      const j = Math.floor(fz);
      const u = fx - i;
      const w = fz - j;
      const n = j * grid.nx + i;
      const lerp2 = (a: Float32Array) =>
        (a[n] * (1 - u) + a[n + 1] * u) * (1 - w) + (a[n + grid.nx] * (1 - u) + a[n + grid.nx + 1] * u) * w;
      phase[v] = k0 * (dirX * x + dirZ * z) + lerp2(field.phase);
      gain[v] = lerp2(field.gain);
    }
    return { phase, gain };
  }, [field, originalPositions]);

  // Scratch objects
  const water = useMemo(() => new THREE.Color(), []);
  const shape = useMemo<SwellShape>(() => ({ y: 0, breaking: 0, crest: 0 }), []);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Only advance time if animation is enabled
    if (config.animateWaves) {
      const dt = Math.min(delta, 0.1) * config.timeScale;
      timeRef.current += dt;
      // Wrapped at a whole cycle of sets so that the set envelope stays continuous
      swellClock.current = (swellClock.current + field.omega * dt) % SET_WRAP;
    }
    const time = timeRef.current;
    rippleTime.value = time;

    const geo = meshRef.current.geometry as THREE.BufferGeometry;
    const positions = geo.attributes.position.array as Float32Array;
    const colors = geo.attributes.color.array as Float32Array;

    const wt = swellClock.current;

    // Secondary swell: a plain wave train fading out over the shelf
    const secondaryOmega = (2 * Math.PI) / config.secondaryWavePeriod;
    const secondaryK = (secondaryOmega * secondaryOmega) / GRAVITY;
    const secondaryAngle = ((270 - config.secondaryWaveDirection) * Math.PI) / 180;
    const secondaryX = secondaryK * Math.sin(secondaryAngle);
    const secondaryZ = secondaryK * Math.cos(secondaryAngle);
    const secondaryA = config.secondaryWaveHeight / 2;

    // Wind speed affects chop intensity (Beaufort scale approximation)
    const chopAmp = config.windChopIntensity * (1 + config.windSpeed / 20) * 0.9;
    const trains = chopTrains(config.windDirection);
    const whitecaps = config.foamIntensity * Math.min(1, Math.max(0, (config.windSpeed - 6) / 12));
    const crestStart = 0.55 + 0.4 * config.foamThreshold;

    for (let i = 0; i < positions.length; i += 3) {
      const x = originalPositions[i];
      const z = originalPositions[i + 2];
      const v = i / 3;

      const depth = config.showCoast ? seabed.depth[v] : DEEP;
      const theta = (config.showCoast ? swell.phase[v] : field.k0 * (field.dirX * x + field.dirZ * z)) - wt;
      const unlimited = swellHeight(config.waveHeight, config.showCoast ? swell.gain[v] : 1, config.canyonAmplification, theta);
      swellSurface(theta, unlimited, depth, shape);

      const shelter = Math.min(1, Math.max(0, depth / 10));
      const secondary = secondaryA * shelter * Math.sin(secondaryX * x + secondaryZ * z - secondaryOmega * time);

      let chop = 0;
      for (const train of trains) {
        chop += train.amp * Math.sin(train.kx * x + train.kz * z - train.omega * time);
      }
      chop *= chopAmp * shelter;

      const dry = depth <= 0 ? 0 : 1;
      const totalHeight = (shape.y + secondary + chop) * dry;
      positions[i + 1] = totalHeight;

      // Whitewater on and behind breaking crests, whitecaps from the wind offshore
      const noise = seabed.foamPattern[v];
      const surf = shape.breaking * (0.25 + 0.75 * shape.crest) * (0.55 + 0.45 * noise) * (0.5 + config.foamIntensity * 0.5);
      const cap = whitecaps * Math.max(0, (shape.crest - crestStart) / (1 - crestStart)) * Math.max(0, noise * 2 - 1);
      const foamAmount = Math.min(1, Math.max(surf, cap) * dry);

      // Water body: deep blue-green, teal over the shallows, lighter through crests, murkier when turbid
      const shallow = config.showCoast ? seabed.shallowness[v] : 0;
      waterAlbedo(water, shallow, shape.crest * shape.crest, config.waterClarity);

      // Blend between water color and white foam
      colors[v * 3] = water.r + (1 - water.r) * foamAmount;
      colors[v * 3 + 1] = water.g + (1 - water.g) * foamAmount;
      colors[v * 3 + 2] = water.b + (1 - water.b) * foamAmount;
    }

    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  });

  // Per-pixel ripples, sharing the clock of the wave animation
  const addRipples = useCallback((shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }) => {
    shader.uniforms.uTime = rippleTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vXZ;
        uniform float uTime;
        ${NOISE_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${RIPPLE_NORMAL_GLSL}`);
  }, [rippleTime]);

  // Material opacity based on water clarity (clearer = slightly more transparent)
  const opacity = config.wireframe ? 1 : 0.85 + config.waterClarity * 0.15;

  return (
    <>
      {/* At kilometre range the dense wireframe merges into a solid block: FarOcean's grid takes over */}
      <mesh ref={meshRef} geometry={geometry} position={[0, 0, 0]} visible={!(config.wireframe && config.showCoast)}>
        <meshStandardMaterial
          onBeforeCompile={addRipples}
          vertexColors={!config.wireframe}
          color={config.wireframe ? config.waveColor : '#ffffff'}
          wireframe={config.wireframe}
          metalness={0}
          roughness={config.wireframe ? 1 : WATER_ROUGHNESS}
          side={THREE.DoubleSide}
          emissive={config.wireframe ? config.waveColor : '#000000'}
          emissiveIntensity={config.wireframe ? 0.2 : 0}
          transparent={!config.wireframe}
          opacity={opacity}
        />
      </mesh>
      {config.showCoast && <FarOcean config={config} timeRef={timeRef} swellClock={swellClock} field={field} />}
    </>
  );
}
