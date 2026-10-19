import { useMemo, useEffect, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import { createShoreMapData, SHORE_MAP_BOUNDS, SHORE_MAP_SEABED_RANGE } from '../utils/terrain';
import { waterAlbedo, waterPalette, WATER_ROUGHNESS } from '../utils/sky';

interface FarOceanProps {
  config: WaveConfig;
  timeRef: MutableRefObject<number>;
}

const OCEAN_SIZE = 900;      // Animated area around the main wave mesh
const OCEAN_SEGMENTS = 300;  // 3m grid, aligned so the ±150 edge of the main mesh falls on vertices
const HORIZON_SIZE = 8000;   // Flat sea out to the horizon
const SHORE_MAP_RESOLUTION = 256;

/**
 * Extends the ocean beyond the 300x300 simulated wave mesh up to the coast.
 * Uses the same wave equations as WaveMesh, evaluated on the GPU, and skips
 * the area already covered by the main mesh.
 */
export function FarOcean({ config, timeRef }: FarOceanProps) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, OCEAN_SEGMENTS, OCEAN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const horizonGeometry = useMemo(() => {
    const half = HORIZON_SIZE / 2;
    const inner = OCEAN_SIZE / 2;
    const shape = new THREE.Shape([
      new THREE.Vector2(-half, -half),
      new THREE.Vector2(half, -half),
      new THREE.Vector2(half, half),
      new THREE.Vector2(-half, half),
    ]);
    shape.holes.push(new THREE.Path([
      new THREE.Vector2(-inner, -inner),
      new THREE.Vector2(-inner, inner),
      new THREE.Vector2(inner, inner),
      new THREE.Vector2(inner, -inner),
    ]));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const shoreMap = useMemo(() => {
    const texture = new THREE.DataTexture(
      createShoreMapData(SHORE_MAP_RESOLUTION),
      SHORE_MAP_RESOLUTION,
      SHORE_MAP_RESOLUTION,
      THREE.RGBAFormat
    );
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uPrimary: { value: new THREE.Vector4() },    // dirX, dirZ, k, speed
    uSecondary: { value: new THREE.Vector4() },  // dirX, dirZ, k, speed
    uAmplitudes: { value: new THREE.Vector3() }, // primary, secondary, chop
    uCanyon: { value: new THREE.Vector3() },     // amplification, focus width, depth effect
    uFoam: { value: new THREE.Vector4() },       // threshold, intensity, wave height, enabled
    uShoreMap: { value: shoreMap },
    uShoreBounds: { value: new THREE.Vector3(SHORE_MAP_BOUNDS.minX, SHORE_MAP_BOUNDS.minZ, SHORE_MAP_BOUNDS.size) },
    uSeabedRange: { value: new THREE.Vector2(SHORE_MAP_SEABED_RANGE.min, SHORE_MAP_SEABED_RANGE.max) },
    uWaterDeep: { value: waterPalette.deep },
    uWaterShallow: { value: waterPalette.shallow },
    uWaterCrest: { value: waterPalette.crest },
    uWaterMurky: { value: waterPalette.murky },
    uClarity: { value: 1 },
  }), [shoreMap]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform vec4 uPrimary;
          uniform vec4 uSecondary;
          uniform vec3 uAmplitudes;
          uniform vec3 uCanyon;
          uniform vec4 uFoam;
          uniform sampler2D uShoreMap;
          uniform vec3 uShoreBounds;
          uniform vec2 uSeabedRange;
          varying float vFoam;
          varying vec2 vXZ;
          varying float vShallow;
          varying float vCrest;
        `)
        .replace('#include <beginnormal_vertex>', `
          float px = position.x;
          float pz = position.z;
          vXZ = vec2(px, pz);

          // Same canyon / depth model as WaveMesh
          float distC = abs(px) / 150.0;
          float canyonFactor = 1.0 + (uCanyon.x - 1.0) * exp(-distC * distC / (uCanyon.y * uCanyon.y));
          float depthFactor = 1.0 + uCanyon.z * clamp((pz + 150.0) / 300.0, 0.0, 1.0);

          // Shoaling over the seabed + fade towards the flat horizon ring
          vec4 shore = texture(uShoreMap, (vec2(px, pz) - uShoreBounds.xy) / uShoreBounds.z);
          float seabed = mix(uSeabedRange.x, uSeabedRange.y, shore.g);
          float edge = 1.0 - smoothstep(380.0, 450.0, max(abs(px), abs(pz)));

          float pPhase = uPrimary.z * (uPrimary.x * px + uPrimary.y * pz - uPrimary.w * uTime);
          float pAmp = uAmplitudes.x * canyonFactor * depthFactor;
          float pSlope = pAmp * uPrimary.z * cos(pPhase);

          float sPhase = uSecondary.z * (uSecondary.x * px + uSecondary.y * pz - uSecondary.w * uTime);
          float sAmp = uAmplitudes.y * canyonFactor * 0.7;
          float sSlope = sAmp * uSecondary.z * cos(sPhase);

          // Breaking limit: wave height stays below ~0.8x the depth (values at the bottom of the range = deep water)
          float depth = shore.g < 0.01 ? 1000.0 : -seabed;
          float localAmp = abs(pAmp) + abs(sAmp) + uAmplitudes.z * 3.0;
          float damp = depth <= 0.0 ? 0.0 : shore.r * min(1.0, depth * 0.8 / max(localAmp, 0.001)) * edge;

          float chop = 0.0;
          float chopSlope = 0.0;
          vec2 chopGrad = vec2(0.0);
          if (uAmplitudes.z > 0.0) {
            float ct = uTime * 2.0;
            float a = px * 0.08 + ct * 1.1;
            float b = pz * 0.06 + ct * 0.9;
            float c = px * 0.15 - ct * 0.7;
            float e = pz * 0.12 + ct * 1.3;
            float f = (px + pz) * 0.1 + ct * 0.8;
            float m = uAmplitudes.z * 3.0;
            chop = (sin(a) * cos(b) * 0.5 + sin(c) * cos(e) * 0.3 + sin(f) * 0.2) * m;
            chopSlope = (cos(a) * 0.08 * cos(b) * 0.5 + cos(c) * 0.15 * cos(e) * 0.3) * m;
            chopGrad = vec2(
              0.08 * cos(a) * cos(b) * 0.5 + 0.15 * cos(c) * cos(e) * 0.3 + 0.1 * cos(f) * 0.2,
              -0.06 * sin(a) * sin(b) * 0.5 - 0.12 * sin(c) * sin(e) * 0.3 + 0.1 * cos(f) * 0.2
            ) * m;
          }

          float waveY = (pAmp * sin(pPhase) + sAmp * sin(sPhase) + chop) * damp;

          vec2 grad = (vec2(pSlope) * uPrimary.xy + vec2(sSlope) * uSecondary.xy + chopGrad) * damp;
          vec3 objectNormal = normalize(vec3(-grad.x, 1.0, -grad.y));

          // Foam: steepness based whitecaps + surf zone whitewater (mirrors WaveMesh)
          float foam = 0.0;
          float steepness = abs(pSlope + sSlope + chopSlope) * damp / 1.5;
          float foamThreshold = uFoam.x * 2.0;
          if (steepness > foamThreshold) {
            foam = min(1.0, (steepness - foamThreshold) * 2.0) * uFoam.y;
            float crestBonus = max(0.0, waveY / (uFoam.z * 2.0));
            foam = min(1.0, foam + crestBonus * uFoam.y * 0.5);
          }
          float surfBand = smoothstep(0.0, 0.12, shore.r) * (1.0 - smoothstep(0.35, 0.9, shore.r));
          float surfLines = pow(0.5 + 0.5 * sin(pPhase * 2.0), 3.0);
          foam = max(foam, surfBand * (0.35 + 0.65 * surfLines) * (0.4 + uFoam.y * 0.6));
          vFoam = foam * uFoam.w;

          // Water body shading inputs (mirrors WaveMesh / waterShallowness)
          vShallow = shore.g < 0.01 ? 0.0 : 1.0 - smoothstep(2.0, 25.0, depth);
          vCrest = clamp(waveY / (uFoam.z * 1.5 + 0.5), 0.0, 1.0);
        `)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position.x, waveY, position.z);');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec4 uFoam;
          uniform vec3 uWaterDeep;
          uniform vec3 uWaterShallow;
          uniform vec3 uWaterCrest;
          uniform vec3 uWaterMurky;
          uniform float uClarity;
          varying float vFoam;
          varying vec2 vXZ;
          varying float vShallow;
          varying float vCrest;
        `)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // The main wave mesh covers the centre (slight overlap hides the seam)
          if (abs(vXZ.x) < 148.5 && abs(vXZ.y) < 148.5) discard;
          // Same blend as waterAlbedo() in utils/sky.ts (solid mode only)
          if (uFoam.w > 0.5) {
            vec3 water = mix(uWaterDeep, uWaterShallow, vShallow * 0.85);
            water = mix(water, uWaterCrest, vCrest * 0.6);
            water = mix(water, uWaterMurky, (1.0 - uClarity) * 0.45);
            diffuseColor.rgb = water;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFoam);
        `);
    };
    mat.customProgramCacheKey = () => 'nazare-far-ocean';
    return mat;
  }, [uniforms]);

  useEffect(() => () => {
    geometry.dispose();
    horizonGeometry.dispose();
    shoreMap.dispose();
    material.dispose();
  }, [geometry, horizonGeometry, shoreMap, material]);

  // Open-sea color for the flat horizon ring (deep water, no crests)
  const waterColor = useMemo(
    () => waterAlbedo(new THREE.Color(), 0, 0, config.waterClarity),
    [config.waterClarity]
  );

  const opacity = config.wireframe ? 1 : 0.85 + config.waterClarity * 0.15;

  useEffect(() => {
    material.wireframe = config.wireframe;
    material.color.set(config.wireframe ? config.waveColor : '#ffffff');
    material.emissive.set(config.wireframe ? config.waveColor : '#000000');
    material.emissiveIntensity = config.wireframe ? 0.2 : 0;
    material.metalness = 0;
    material.roughness = config.wireframe ? 1 : WATER_ROUGHNESS;
    material.transparent = !config.wireframe;
    material.opacity = opacity;
    material.needsUpdate = true;
  }, [material, config.wireframe, config.waveColor, opacity]);

  useFrame(() => {
    const gravity = 9.8;
    const primaryDir = (config.waveDirection * Math.PI) / 180;
    const secondaryDir = (config.secondaryWaveDirection * Math.PI) / 180;

    uniforms.uTime.value = timeRef.current;
    uniforms.uPrimary.value.set(
      Math.sin(primaryDir),
      Math.cos(primaryDir),
      (2 * Math.PI) / config.waveLength,
      (gravity * config.wavePeriod) / (2 * Math.PI) * config.waveSpeed * 0.3
    );
    uniforms.uSecondary.value.set(
      Math.sin(secondaryDir),
      Math.cos(secondaryDir),
      (2 * Math.PI) / (config.waveLength * 0.6),
      (gravity * config.secondaryWavePeriod) / (2 * Math.PI) * config.waveSpeed * 0.3
    );
    uniforms.uAmplitudes.value.set(
      config.waveHeight,
      config.secondaryWaveHeight,
      config.windChopIntensity * (1 + config.windSpeed / 20)
    );
    uniforms.uCanyon.value.set(config.canyonAmplification, config.canyonFocusWidth, config.canyonDepthEffect);
    uniforms.uFoam.value.set(config.foamThreshold, config.foamIntensity, config.waveHeight, config.wireframe ? 0 : 1);
    uniforms.uClarity.value = config.waterClarity;
  });

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
      {!config.wireframe && (
        <mesh geometry={horizonGeometry} position={[0, 0, 0]}>
          <meshStandardMaterial
            color={waterColor}
            metalness={0}
            roughness={WATER_ROUGHNESS}
            transparent
            opacity={opacity}
          />
        </mesh>
      )}
    </>
  );
}
