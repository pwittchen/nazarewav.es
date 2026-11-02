import { useMemo, useEffect, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import { createShoreMapData, OCEAN_BOUNDS, SHORE_MAP_SEABED_RANGE } from '../utils/terrain';
import { BREAKER_RATIO, GRAVITY, SET_LENGTH, SET_CYCLE, SET_PEAKS, SET_LULL, type WaveField } from '../utils/waveField';
import { chopTrains, NOISE_GLSL, RIPPLE_NORMAL_GLSL } from '../utils/waterShader';
import { waterAlbedo, waterPalette, WATER_ROUGHNESS } from '../utils/sky';

interface FarOceanProps {
  config: WaveConfig;
  timeRef: MutableRefObject<number>;
  swellClock: MutableRefObject<number>; // omega * t of the primary swell, kept by WaveMesh
  field: WaveField;
}

const OCEAN_SIZE = OCEAN_BOUNDS.size; // Animated area around the main wave mesh
const OCEAN_SEGMENTS = 480;  // 10m grid, aligned so the ±150 edge of the main mesh falls on vertices
const HORIZON_SIZE = 40000;  // Flat sea out to the horizon
const SHORE_MAP_RESOLUTION = 1024;

/** Half-float RGBA texture of the solved field: R = phase, G = gain, B = depth / 100 */
function createFieldTexture({ grid, phase, gain }: WaveField) {
  const { nx, nz, heights } = grid;
  const data = new Uint16Array(nx * nz * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let n = 0; n < nx * nz; n++) {
    data[n * 4] = half(phase[n]);
    data[n * 4 + 1] = half(gain[n]);
    data[n * 4 + 2] = half(-heights[n] / 100);
    data[n * 4 + 3] = half(1);
  }
  const texture = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Extends the ocean beyond the 300x300 simulated wave mesh up to the coast.
 * Uses the same wave equations as WaveMesh, evaluated on the GPU, and skips
 * the area already covered by the main mesh.
 */
export function FarOcean({ config, timeRef, swellClock, field }: FarOceanProps) {
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
    uPrimary: { value: new THREE.Vector4() },    // dirX, dirZ, k0, wrapped omega * t
    uSecondary: { value: new THREE.Vector4() },  // dirX, dirZ, k, omega * t
    uAmplitudes: { value: new THREE.Vector4() }, // primary height, secondary height, chop, refraction strength
    uChopK: { value: [new THREE.Vector4(), new THREE.Vector4()] },     // (kx, kz) of the trains in pairs
    uChopW: { value: new THREE.Vector4() },      // omega
    uChopA: { value: new THREE.Vector4() },      // relative amplitude
    uFoam: { value: new THREE.Vector4() },       // threshold, intensity, whitecaps, enabled
    uField: { value: null as THREE.DataTexture | null },
    uFieldBounds: { value: new THREE.Vector4(field.grid.minX, field.grid.minZ, 1 / (field.grid.nx * field.grid.cell), 1 / (field.grid.nz * field.grid.cell)) },
    uShoreMap: { value: shoreMap },
    uShoreBounds: { value: new THREE.Vector3(OCEAN_BOUNDS.minX, OCEAN_BOUNDS.minZ, OCEAN_BOUNDS.size) },
    uSeabedRange: { value: new THREE.Vector2(SHORE_MAP_SEABED_RANGE.min, SHORE_MAP_SEABED_RANGE.max) },
    uWaterDeep: { value: waterPalette.deep },
    uWaterShallow: { value: waterPalette.shallow },
    uWaterCrest: { value: waterPalette.crest },
    uWaterMurky: { value: waterPalette.murky },
    uClarity: { value: 1 },
  }), [shoreMap, field.grid]);

  // New texture for each solved swell
  useEffect(() => {
    const texture = createFieldTexture(field);
    uniforms.uField.value = texture;
    return () => texture.dispose();
  }, [field, uniforms]);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform vec4 uPrimary;
          uniform vec4 uSecondary;
          uniform vec4 uAmplitudes;
          uniform vec4 uChopK[2];
          uniform vec4 uChopW;
          uniform vec4 uChopA;
          uniform vec4 uFoam;
          uniform sampler2D uField;
          uniform vec4 uFieldBounds;
          uniform sampler2D uShoreMap;
          uniform vec3 uShoreBounds;
          uniform vec2 uSeabedRange;
          varying float vBreaking;
          varying float vCap;
          varying vec2 vXZ;
          varying float vShallow;
          varying float vCrest;

          const float BREAKER_RATIO = ${BREAKER_RATIO.toFixed(3)};
          const float SET_LENGTH = ${SET_LENGTH.toFixed(1)};
          const float SET_CYCLE = ${SET_CYCLE.toFixed(1)};
          const float SET_LULL = ${SET_LULL.toFixed(4)};
          const float SET_PEAKS[${SET_CYCLE}] = float[${SET_CYCLE}](${SET_PEAKS.map((p) => p.toFixed(4)).join(', ')});

          // Mirrors setEnvelope() of utils/waveField.ts
          float setEnvelope(float theta) {
            float u = theta / (6.28318531 * SET_LENGTH) + 0.5;
            float n = floor(u);
            float b = sin(3.14159265 * (u - n));
            return SET_LULL + (SET_PEAKS[int(mod(n, SET_CYCLE))] - SET_LULL) * b * b;
          }

          // Mirrors swellHeight() + swellSurface() of utils/waveField.ts, plus the extras in WaveMesh
          float oceanHeight(vec2 p, out float breaking, out float crest, out float localDepth) {
            vec2 fieldUv = (p - uFieldBounds.xy) * uFieldBounds.zw + 0.5 * uFieldBounds.zw * ${field.grid.cell.toFixed(1)};
            vec4 f = texture(uField, fieldUv);
            vec4 shore = texture(uShoreMap, (p - uShoreBounds.xy) / uShoreBounds.z);
            float seabed = mix(uSeabedRange.x, uSeabedRange.y, shore.g);
            // Values at the bottom of the fine map's range = deep water, use the coarse grid there
            float depth = shore.g < 0.01 ? max(50.0, f.b * 100.0) : -seabed;
            localDepth = depth;

            float theta = uPrimary.z * dot(uPrimary.xy, p) + f.r - uPrimary.w;
            float unlimited = uAmplitudes.x * (1.0 + (f.g - 1.0) * uAmplitudes.w) * setEnvelope(theta);
            float limit = BREAKER_RATIO * max(depth, 0.0);
            float ratio = limit > 0.0 ? unlimited / limit : 8.0;
            float height = unlimited / pow(1.0 + ratio * ratio * ratio * ratio, 0.25);
            float shoal = smoothstep(0.45, 1.0, ratio);
            crest = pow(0.5 + 0.5 * sin(theta - shoal * cos(theta)), 1.0 + 4.5 * shoal);
            breaking = clamp((ratio - 0.85) / 0.45, 0.0, 1.0);
            float swell = height * 0.5 * (2.0 * crest - 1.0 + 0.45 * shoal);

            float shelter = clamp(depth / 10.0, 0.0, 1.0);
            float secondary = uAmplitudes.y * 0.5 * shelter * sin(dot(uSecondary.xy, p) - uSecondary.w);
            float chop = (uChopA.x * sin(dot(uChopK[0].xy, p) - uChopW.x * uTime)
              + uChopA.y * sin(dot(uChopK[0].zw, p) - uChopW.y * uTime)
              + uChopA.z * sin(dot(uChopK[1].xy, p) - uChopW.z * uTime)
              + uChopA.w * sin(dot(uChopK[1].zw, p) - uChopW.w * uTime)) * uAmplitudes.z * shelter;
            float edge = 1.0 - smoothstep(${(OCEAN_SIZE / 2 - 300).toFixed(1)}, ${(OCEAN_SIZE / 2 - 10).toFixed(1)}, max(abs(p.x), abs(p.y)));
            return depth <= 0.0 ? 0.0 : (swell + secondary + chop) * edge;
          }
        `)
        .replace('#include <beginnormal_vertex>', `
          vec2 surfacePos = position.xz;
          vXZ = surfacePos;

          float breaking, crest, localDepth, b2, c2, d2;
          float waveY = oceanHeight(surfacePos, breaking, crest, localDepth);
          float slopeX = (oceanHeight(surfacePos + vec2(5.0, 0.0), b2, c2, d2) - waveY) / 5.0;
          float slopeZ = (oceanHeight(surfacePos + vec2(0.0, 5.0), b2, c2, d2) - waveY) / 5.0;
          vec3 objectNormal = normalize(vec3(-slopeX, 1.0, -slopeZ));

          float crestStart = 0.55 + 0.4 * uFoam.x;
          vBreaking = breaking * (0.25 + 0.75 * crest) * (0.5 + uFoam.y * 0.5) * uFoam.w;
          vCap = uFoam.z * max(0.0, (crest - crestStart) / (1.0 - crestStart)) * uFoam.w;

          // Water body shading inputs (mirrors WaveMesh / waterShallowness)
          vShallow = 1.0 - smoothstep(2.0, 25.0, localDepth);
          vCrest = crest * crest;
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
          uniform float uTime;
          varying float vBreaking;
          varying float vCap;
          varying vec2 vXZ;
          varying float vShallow;
          varying float vCrest;
          ${NOISE_GLSL}
        `)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          ${RIPPLE_NORMAL_GLSL}
        `)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // The main wave mesh covers the centre (slight overlap hides the seam)
          if (uFoam.w > 0.5 && abs(vXZ.x) < 148.5 && abs(vXZ.y) < 148.5) discard;
          // Same blend as waterAlbedo() in utils/sky.ts (solid mode only)
          if (uFoam.w > 0.5) {
            vec3 water = mix(uWaterDeep, uWaterShallow, vShallow * 0.85);
            water = mix(water, uWaterCrest, vCrest * 0.6);
            water = mix(water, uWaterMurky, (1.0 - uClarity) * 0.45);
            diffuseColor.rgb = water;
          }
          // Breaks foam up into streaks and patches, like the pattern in WaveMesh
          float foamPattern = waterFbm(vXZ * 0.05) * 1.7 - 0.35;
          float foam = max(vBreaking * (0.55 + 0.45 * foamPattern), vCap * max(0.0, foamPattern * 2.0 - 1.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(foam, 0.0, 1.0));
        `);
    };
    mat.customProgramCacheKey = () => 'nazare-far-ocean';
    return mat;
  }, [uniforms, field.grid.cell]);

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
    const time = timeRef.current;
    const secondaryOmega = (2 * Math.PI) / config.secondaryWavePeriod;
    const secondaryK = (secondaryOmega * secondaryOmega) / GRAVITY;
    const secondaryAngle = ((270 - config.secondaryWaveDirection) * Math.PI) / 180;

    uniforms.uTime.value = time;
    uniforms.uPrimary.value.set(field.dirX, field.dirZ, field.k0, swellClock.current);
    uniforms.uSecondary.value.set(
      secondaryK * Math.sin(secondaryAngle),
      secondaryK * Math.cos(secondaryAngle),
      0,
      secondaryOmega * time
    );
    uniforms.uAmplitudes.value.set(
      config.waveHeight,
      config.secondaryWaveHeight,
      config.windChopIntensity * (1 + config.windSpeed / 20) * 0.9,
      config.canyonAmplification
    );
    const trains = chopTrains(config.windDirection);
    uniforms.uChopK.value[0].set(trains[0].kx, trains[0].kz, trains[1].kx, trains[1].kz);
    uniforms.uChopK.value[1].set(trains[2].kx, trains[2].kz, trains[3].kx, trains[3].kz);
    uniforms.uChopW.value.set(trains[0].omega, trains[1].omega, trains[2].omega, trains[3].omega);
    uniforms.uChopA.value.set(trains[0].amp, trains[1].amp, trains[2].amp, trains[3].amp);
    const whitecaps = config.foamIntensity * Math.min(1, Math.max(0, (config.windSpeed - 6) / 12));
    uniforms.uFoam.value.set(config.foamThreshold, config.foamIntensity, whitecaps, config.wireframe ? 0 : 1);
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
