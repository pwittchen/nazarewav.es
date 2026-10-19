import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import type { SkyState } from '../utils/sky';

interface SkyProps {
  sky: SkyState;
  windDirection: number;
  windSpeed: number;
}

const DOME_RADIUS = 3500;

const skyVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunVisibility;
  uniform float uCloudCover;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec2 uCloudOffset;
  uniform float uStars;
  varying vec3 vDir;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;

    // Gradient from the horizon haze up to the zenith; below the horizon stays hazy
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));

    // Sun glow (wide halo + tight aureole) and disc
    float sd = max(dot(dir, uSunDir), 0.0);
    col += uSunColor * (pow(sd, 6.0) * 0.25 + pow(sd, 90.0) * 0.6) * uSunVisibility;
    float disc = smoothstep(0.99955, 0.9998, sd);

    // Stars, hidden by clouds and haze near the horizon
    if (uStars > 0.0 && h > 0.0) {
      vec2 cell = floor(vec2(atan(dir.z, dir.x) * 450.0, h * 700.0));
      float star = step(0.9985, hash(cell)) * hash(cell + 3.7);
      col += vec3(star) * uStars * smoothstep(0.02, 0.2, h);
    }

    // Cloud layer: project onto a plane overhead
    float density = 0.0;
    if (uCloudCover > 0.01 && h > 0.0) {
      vec2 uv = dir.xz / (h + 0.12) * 1.4 + uCloudOffset;
      float n = fbm(uv);
      float threshold = mix(0.78, 0.18, uCloudCover);
      density = smoothstep(threshold, threshold + 0.22, n) * smoothstep(0.0, 0.12, h);
      // Cheap self-shadowing: denser towards the sun-facing side means a brighter top
      float towardsSun = fbm(uv + uSunDir.xz * 0.08);
      float light = clamp(0.55 + (n - towardsSun) * 5.0, 0.0, 1.0);
      vec3 cloud = mix(uCloudShade, uCloudLit, light);
      cloud += uSunColor * pow(sd, 8.0) * 0.5 * uSunVisibility; // silver lining near the sun
      col = mix(col, cloud, density * 0.95);
    }

    col = mix(col, uSunColor * 4.0, disc * uSunVisibility * (1.0 - density));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Procedural sky dome: day/twilight gradient, sun, drifting clouds and stars.
 * The same material is rendered into the environment map, so the water reflects the sky.
 */
export function Sky({ sky, windDirection, windSpeed }: SkyProps) {
  const domeRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunVisibility: { value: 0 },
      uCloudCover: { value: 0 },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uCloudOffset: { value: new THREE.Vector2() },
      uStars: { value: 0 },
    },
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  }), []);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const u = material.uniforms;
    u.uZenith.value.copy(sky.zenithColor);
    u.uHorizon.value.copy(sky.horizonColor);
    u.uSunDir.value.copy(sky.sunDirection);
    u.uSunColor.value.copy(sky.sunColor);
    u.uSunVisibility.value = sky.sunVisibility;
    u.uCloudCover.value = sky.cloudCover;
    u.uCloudLit.value.copy(sky.cloudLitColor);
    u.uCloudShade.value.copy(sky.cloudShadeColor);
    u.uStars.value = sky.starVisibility;
  }, [material, sky]);

  useFrame(({ camera }, delta) => {
    // Clouds drift downwind (wind direction is where it blows from)
    const dir = THREE.MathUtils.degToRad(windDirection);
    const drift = delta * (0.004 + windSpeed * 0.0006);
    material.uniforms.uCloudOffset.value.x += Math.cos(dir) * drift;
    material.uniforms.uCloudOffset.value.y += Math.sin(dir) * drift;
    domeRef.current?.position.copy(camera.position);
  });

  return (
    <>
      <mesh ref={domeRef} material={material} renderOrder={-1000} frustumCulled={false}>
        <sphereGeometry args={[DOME_RADIUS, 48, 24]} />
      </mesh>
      <Environment frames={Infinity} resolution={64} environmentIntensity={sky.environmentIntensity}>
        <mesh material={material}>
          <sphereGeometry args={[100, 32, 16]} />
        </mesh>
      </Environment>
    </>
  );
}
