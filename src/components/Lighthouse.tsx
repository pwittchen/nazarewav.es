import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FORT_POSITION, FORT_GROUND } from '../utils/terrain';

interface LighthouseProps {
  night: boolean; // Beam and lantern on
}

// Fort outline in local coordinates (x = north, z = east / inland)
const FORT_OUTLINE: [number, number][] = [
  [-15, -8], [-8, -16], [4, -17], [14, -10], [17, 2], [10, 12], [-4, 14], [-14, 6],
];
const WALL_BASE = FORT_GROUND - 8;   // Walls rise from the rock below the courtyard
const WALL_TOP = FORT_GROUND + 5;
const TOWER_POSITION: [number, number] = [12.2, -9.2]; // On the seaward north-west bastion
const TOWER_HEIGHT = 10;
const LANTERN_Y = WALL_TOP + TOWER_HEIGHT + 1.3;
const BEAM_LENGTH = 420;
const ROTATION_PERIOD = 10; // seconds per full turn of the optic

function outlineShape(scale: number) {
  // Shape lives in XY; after rotateX(-90°) shape-Y becomes world -Z, so flip it
  return FORT_OUTLINE.map(([x, z]) => new THREE.Vector2(x * scale, -z * scale));
}

function createWallGeometry(innerScale: number, height: number) {
  const shape = new THREE.Shape(outlineShape(1));
  shape.holes.push(new THREE.Path(outlineShape(innerScale).reverse()));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

const beamVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const beamFragmentShader = `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Brightest at the lantern, fading along the beam and towards its soft edges
    float along = pow(vUv.y, 2.5);
    float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.5);
    gl_FragColor = vec4(uColor, along * edge * uIntensity);
  }
`;

/**
 * Forte de São Miguel Arcanjo with the red square tower of the Farol da Nazaré.
 */
export function Lighthouse({ night: isNight }: LighthouseProps) {
  const beamRef = useRef<THREE.Group>(null);

  const walls = useMemo(() => createWallGeometry(0.8, WALL_TOP - WALL_BASE), []);
  const coping = useMemo(() => createWallGeometry(0.8, 0.5), []);

  const beamGeometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.5, 30, BEAM_LENGTH, 24, 1, true);
    geo.translate(0, -BEAM_LENGTH / 2, 0); // narrow end at the lantern
    geo.rotateZ(Math.PI / 2);              // point along +X
    return geo;
  }, []);

  const beamMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#fff4d6') },
      uIntensity: { value: 0.35 },
    },
    vertexShader: beamVertexShader,
    fragmentShader: beamFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }), []);

  const spotTargets = useMemo(() => [new THREE.Object3D(), new THREE.Object3D()], []);

  useFrame((_, delta) => {
    if (beamRef.current) {
      beamRef.current.rotation.y -= (delta * Math.PI * 2) / ROTATION_PERIOD;
    }
  });

  const [towerX, towerZ] = TOWER_POSITION;

  return (
    <group position={[FORT_POSITION.x, 0, FORT_POSITION.z]}>
      {/* Fortress walls in pale limestone */}
      <mesh geometry={walls} position={[0, WALL_BASE, 0]}>
        <meshStandardMaterial color="#d8cdb0" roughness={0.9} />
      </mesh>
      <mesh geometry={coping} position={[0, WALL_TOP, 0]}>
        <meshStandardMaterial color="#b8ab8c" roughness={0.9} />
      </mesh>

      {/* Sentry boxes (guaritas) on the corners */}
      {[FORT_OUTLINE[0], FORT_OUTLINE[2], FORT_OUTLINE[4], FORT_OUTLINE[6]].map(([x, z]) => (
        <group key={`${x},${z}`} position={[x * 0.94, WALL_TOP + 0.5, z * 0.94]}>
          <mesh position={[0, 1.3, 0]}>
            <cylinderGeometry args={[0.9, 0.9, 2.6, 10]} />
            <meshStandardMaterial color="#e2d8bd" roughness={0.9} />
          </mesh>
          <mesh position={[0, 3.1, 0]}>
            <coneGeometry args={[1.1, 1.2, 10]} />
            <meshStandardMaterial color="#c9bc9a" roughness={0.9} />
          </mesh>
        </group>
      ))}

      {/* Barracks inside the courtyard */}
      <group position={[-3, FORT_GROUND, 6]} rotation={[0, 0.2, 0]}>
        <mesh position={[0, 2.5, 0]}>
          <boxGeometry args={[14, 5, 5.5]} />
          <meshStandardMaterial color="#efe8d8" roughness={0.85} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[0, 5.75, side * 1.45]} rotation={[-side * 0.5, 0, 0]}>
            <boxGeometry args={[14.6, 0.25, 3.5]} />
            <meshStandardMaterial color="#a84d2b" roughness={0.8} />
          </mesh>
        ))}
      </group>

      {/* Farol da Nazaré: red square tower on the bastion */}
      <group position={[towerX, WALL_TOP, towerZ]}>
        <mesh position={[0, TOWER_HEIGHT / 2, 0]}>
          <boxGeometry args={[3.2, TOWER_HEIGHT, 3.2]} />
          <meshStandardMaterial color="#b3261e" roughness={0.6} />
        </mesh>
        {/* Door and small windows */}
        <mesh position={[0, 1.2, 1.62]}>
          <boxGeometry args={[1, 2.2, 0.05]} />
          <meshStandardMaterial color="#3a2a22" />
        </mesh>
        {[4, 7].map((wy) => (
          <mesh key={wy} position={[-1.62, wy, 0]}>
            <boxGeometry args={[0.05, 0.9, 0.6]} />
            <meshStandardMaterial color="#1f1d1d" />
          </mesh>
        ))}
        {/* Gallery with railing */}
        <mesh position={[0, TOWER_HEIGHT + 0.15, 0]}>
          <boxGeometry args={[4.4, 0.3, 4.4]} />
          <meshStandardMaterial color="#e9e6df" roughness={0.7} />
        </mesh>
        {[[0, 2.15, 4.4, 0.08], [0, -2.15, 4.4, 0.08], [2.15, 0, 0.08, 4.4], [-2.15, 0, 0.08, 4.4]].map(([rx, rz, w, d]) => (
          <mesh key={`${rx},${rz}`} position={[rx, TOWER_HEIGHT + 0.85, rz]}>
            <boxGeometry args={[w, 0.08, d]} />
            <meshStandardMaterial color="#d9d6cf" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        {/* Lantern room */}
        <mesh position={[0, TOWER_HEIGHT + 1.3, 0]}>
          <cylinderGeometry args={[1.1, 1.1, 2, 12]} />
          <meshStandardMaterial
            color={isNight ? '#fff6d8' : '#9fb3b8'}
            emissive={isNight ? '#ffe9a8' : '#000000'}
            emissiveIntensity={isNight ? 2.5 : 0}
            metalness={0.3}
            roughness={0.15}
          />
        </mesh>
        <mesh position={[0, TOWER_HEIGHT + 2.75, 0]}>
          <coneGeometry args={[1.4, 1, 12]} />
          <meshStandardMaterial color="#8a1d17" roughness={0.5} />
        </mesh>
        <mesh position={[0, TOWER_HEIGHT + 3.4, 0]}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshStandardMaterial color="#8a1d17" roughness={0.5} />
        </mesh>
      </group>

      {/* Rotating optic: two opposite beams sweeping the sea at night */}
      {isNight && (
        <>
          <pointLight position={[towerX, LANTERN_Y, towerZ]} color="#ffe2a0" intensity={12} distance={90} decay={1} />
          <group ref={beamRef} position={[towerX, LANTERN_Y, towerZ]}>
            {[0, Math.PI].map((angle, i) => (
              <group key={angle} rotation={[0, angle, -0.025]}>
                <mesh geometry={beamGeometry} material={beamMaterial} frustumCulled={false} />
                <primitive object={spotTargets[i]} position={[100, 0, 0]} />
                <spotLight
                  target={spotTargets[i]}
                  color="#fff1cc"
                  intensity={6}
                  distance={600}
                  decay={0}
                  angle={0.1}
                  penumbra={0.6}
                />
              </group>
            ))}
          </group>
        </>
      )}
    </group>
  );
}
