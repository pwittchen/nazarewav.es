import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { cameraViews, type CameraView } from '../config/waveConfig';

const FLIGHT_SECONDS = 2.5;

interface Flight {
  fromPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPosition: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
}

/** Flies the camera and the orbit target to a viewpoint whenever a new view is requested */
export function CameraRig({ view, paused }: { view: { name: CameraView }; paused: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const flight = useRef<Flight | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // The first view is where the Canvas camera already starts
    if (first.current) { first.current = false; return; }
    if (!controls || paused) return;
    const { position, target } = cameraViews[view.name];
    flight.current = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: new THREE.Vector3(...position),
      toTarget: new THREE.Vector3(...target),
      t: 0,
    };
  }, [view, camera, controls]);

  // Grabbing the controls hands the camera back to the user
  useEffect(() => {
    if (!controls) return;
    const cancel = () => { flight.current = null; };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f || !controls) return;
    // The drone flight owns the camera
    if (paused) { flight.current = null; return; }
    f.t = Math.min(1, f.t + delta / FLIGHT_SECONDS);
    const e = f.t * f.t * (3 - 2 * f.t);
    camera.position.lerpVectors(f.fromPosition, f.toPosition, e);
    controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    controls.update();
    if (f.t >= 1) flight.current = null;
  });

  return null;
}
