import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { FORT_POSITION, terrainHeight } from '../utils/terrain';
import { cameraViews } from '../config/waveConfig';

/** Seconds for one full lap around the bay */
const LAP_SECONDS = 240;
/** Seconds to ease from wherever the camera was onto the flight path */
const BLEND_SECONDS = 4;
/** Height kept above the cliffs and the Sítio when the path crosses land */
const TERRAIN_CLEARANCE = 70;

interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const PEAK = new THREE.Vector3(...cameraViews.peak.target);
const FORT = new THREE.Vector3(FORT_POSITION.x, 20, FORT_POSITION.z);
const BEACH = new THREE.Vector3(...cameraViews.shore.target);

/**
 * Where the drone is and what it films at phase θ (radians, one lap = 2π). It circles the
 * break between the canyon peak and the fort, swinging in and out and climbing and diving
 * on slow incommensurate sines, so the shot never quite repeats, while the gimbal pans
 * between the peak, the fort and the beach.
 */
function droneShot(theta: number, showCoast: boolean, out: Shot) {
  if (!showCoast) {
    // Without the coast the scene is the 300 m surf-zone mesh: a tight orbit over it
    const r = 150 + 40 * Math.sin(theta * 2 + 0.6);
    out.position.set(r * Math.cos(theta), 45 + 20 * Math.sin(theta * 3 + 1.1), r * Math.sin(theta));
    out.target.set(25 * Math.sin(theta * 1.3), 2, 25 * Math.cos(theta * 0.9));
    return;
  }

  const cx = -260, cz = -140;
  const r = 520 + 200 * Math.sin(theta * 2 + 0.6) + 50 * Math.sin(theta * 5.3);
  const x = cx + r * Math.cos(theta);
  const z = cz + r * Math.sin(theta) * 0.85;
  const cruise = 130 + 60 * Math.sin(theta * 3 + 1.1) + 15 * Math.sin(theta * 7.7);
  const y = Math.max(cruise, terrainHeight(x, z) + TERRAIN_CLEARANCE);
  out.position.set(x, y, z);

  // Gimbal: mostly on the peak, drifting to the fort and the beach and back
  const a = 0.5 + 0.5 * Math.sin(theta * 1.4);
  const b = 0.5 + 0.5 * Math.sin(theta * 0.9 + 2);
  out.target.copy(PEAK).lerp(FORT, a * 0.55).lerp(BEACH, b * 0.3);
  out.target.y = 8;
}

/**
 * Cinematic drone flight: while active it owns the camera, flying a slow orbit over the
 * Nazaré bay. When switched off the orbit controls take over from the current shot.
 */
export function DroneCamera({ active, showCoast }: { active: boolean; showCoast: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  const theta = useRef(0);
  const blend = useRef(1);
  const from = useRef<Shot>({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  const shot = useRef<Shot>({ position: new THREE.Vector3(), target: new THREE.Vector3() });
  const look = useRef(new THREE.Vector3());
  // Altitude is smoothed separately so climbing over the cliffs is a gentle pull-up
  const altitude = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      // Join the lap at the bearing the camera is already on, so the blend is short
      const cx = showCoast ? -260 : 0, cz = showCoast ? -140 : 0;
      theta.current = Math.atan2((camera.position.z - cz) / (showCoast ? 0.85 : 1), camera.position.x - cx);
      from.current.position.copy(camera.position);
      from.current.target.copy(controls ? controls.target : look.current);
      look.current.copy(from.current.target);
      altitude.current = camera.position.y;
      blend.current = 0;
      if (controls) controls.enabled = false;
      return;
    }
    // Hand the camera back without a jump: orbit around what the drone was filming
    if (controls) {
      controls.target.copy(look.current);
      controls.enabled = true;
      controls.update();
    }
  }, [active, showCoast, camera, controls]);

  useFrame((_, delta) => {
    if (!active) return;
    const dt = Math.min(delta, 0.1);
    theta.current += (dt / LAP_SECONDS) * Math.PI * 2;
    droneShot(theta.current, showCoast, shot.current);

    const s = shot.current;
    altitude.current = altitude.current === null
      ? s.position.y
      : THREE.MathUtils.damp(altitude.current, s.position.y, 0.8, dt);
    // Never let the smoothing dip below the terrain clearance
    s.position.y = Math.max(altitude.current, s.position.y - 15);

    blend.current = Math.min(1, blend.current + dt / BLEND_SECONDS);
    const e = blend.current * blend.current * (3 - 2 * blend.current);
    camera.position.lerpVectors(from.current.position, s.position, e);
    look.current.lerpVectors(from.current.target, s.target, e);
    camera.lookAt(look.current);
  });

  return null;
}
