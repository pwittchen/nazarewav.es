import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { FUNICULAR, terrainHeight, smoothstep } from '../utils/terrain';

interface FunicularProps {
  night: boolean;
}

const CYCLE = 150;      // Seconds for a round trip including the stops at both stations
const TRACK_GAUGE = 1.4; // Offset of each car's track from the centre line
const CAR_LENGTH = 7;

const { lower, upper } = FUNICULAR;
const dx = upper.x - lower.x;
const dz = upper.z - lower.z;
const run = Math.hypot(dx, dz);
const rise = upper.y - lower.y;
const TRACK_LENGTH = Math.hypot(run, rise);
const YAW = Math.atan2(-dz, dx); // Rotates local +X onto the track heading
const PITCH = Math.atan2(rise, run);

/**
 * Ascensor da Nazaré: two counterbalanced yellow cars climbing from the town to the
 * Sítio, on a viaduct over the lower streets and through a cutting in the cliff top.
 */
export function Funicular({ night }: FunicularProps) {
  const carRefs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)];

  // Concrete piers carrying the viaduct wherever the track runs above the ground
  const piers = useMemo(() => {
    const result: { x: number; z: number; ground: number; top: number }[] = [];
    for (let s = 6; s < run - 4; s += 9) {
      const f = s / run;
      const x = lower.x + dx * f;
      const z = lower.z + dz * f;
      const top = lower.y + rise * f - 0.4;
      const ground = terrainHeight(x, z);
      if (top - ground > 1.5) result.push({ x, z, ground, top });
    }
    return result;
  }, []);

  useFrame(({ clock }) => {
    const c = (clock.elapsedTime % CYCLE) / CYCLE;
    const p = c < 0.5 ? smoothstep(0.08, 0.42, c) : 1 - smoothstep(0.58, 0.92, c);
    [p, 1 - p].forEach((progress, i) => {
      const car = carRefs[i].current;
      if (car) car.position.x = CAR_LENGTH / 2 + progress * (TRACK_LENGTH - CAR_LENGTH);
    });
  });

  return (
    <group>
      {piers.map(({ x, z, ground, top }) => (
        <mesh key={`${x},${z}`} position={[x, (ground + top) / 2 - 0.5, z]} rotation={[0, YAW, 0]}>
          <boxGeometry args={[1.2, top - ground + 1, 4]} />
          <meshStandardMaterial color="#c8c2b4" roughness={0.9} />
        </mesh>
      ))}

      <group position={[lower.x, lower.y, lower.z]} rotation={[0, YAW, 0]}>
        {/* Lower station on Rua do Elevador */}
        <group position={[-6, 0, 0]}>
          <mesh position={[0, 1.5, 0]}>
            <boxGeometry args={[12, 11, 10]} />
            <meshStandardMaterial color="#f3efe6" roughness={0.85} />
          </mesh>
          <mesh position={[0, 7.3, 0]}>
            <boxGeometry args={[12.6, 0.6, 10.6]} />
            <meshStandardMaterial color="#a84d2b" roughness={0.8} />
          </mesh>
        </group>

        <group rotation={[0, 0, PITCH]}>
          {/* Track bed and rails */}
          <mesh position={[TRACK_LENGTH / 2, -0.25, 0]}>
            <boxGeometry args={[TRACK_LENGTH, 0.5, 5.2]} />
            <meshStandardMaterial color="#9d968a" roughness={0.95} />
          </mesh>
          {[-1, 1].flatMap((side) => [-0.6, 0.6].map((r) => (
            <mesh key={`${side},${r}`} position={[TRACK_LENGTH / 2, 0.08, side * TRACK_GAUGE + r]}>
              <boxGeometry args={[TRACK_LENGTH, 0.15, 0.12]} />
              <meshStandardMaterial color="#3b3a39" metalness={0.6} roughness={0.4} />
            </mesh>
          )))}

          {/* Cars */}
          {[-1, 1].map((side, i) => (
            <group key={side} ref={carRefs[i]} position={[CAR_LENGTH / 2, 0, side * TRACK_GAUGE]}>
              <group>
                <mesh position={[0, 1.7, 0]}>
                  <boxGeometry args={[CAR_LENGTH, 2.6, 2.2]} />
                  <meshStandardMaterial color="#f0c419" roughness={0.5} />
                </mesh>
                <mesh position={[0, 2.2, 0]}>
                  <boxGeometry args={[CAR_LENGTH + 0.05, 0.9, 2.25]} />
                  <meshStandardMaterial
                    color={night ? '#ffe7a8' : '#28343a'}
                    emissive={night ? '#ffd27a' : '#000000'}
                    emissiveIntensity={night ? 1.5 : 0}
                    roughness={0.2}
                  />
                </mesh>
                <mesh position={[0, 3.1, 0]}>
                  <boxGeometry args={[CAR_LENGTH + 0.2, 0.25, 2.4]} />
                  <meshStandardMaterial color="#f4f1ea" roughness={0.6} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
      </group>

      {/* Upper station next to the Largo do Sítio */}
      <group position={[upper.x, upper.y, upper.z]} rotation={[0, YAW, 0]}>
        <mesh position={[5, 2.5, 0]}>
          <boxGeometry args={[10, 6, 10]} />
          <meshStandardMaterial color="#f3efe6" roughness={0.85} />
        </mesh>
        <mesh position={[5, 5.8, 0]}>
          <boxGeometry args={[10.6, 0.6, 10.6]} />
          <meshStandardMaterial color="#a84d2b" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}
