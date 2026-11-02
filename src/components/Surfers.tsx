import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WaveConfig } from '../config/waveConfig';
import {
  BREAKER_RATIO, CROSSING_BREAKER, GRAVITY, sampleSwell, setEnvelope, swellHeight, swellSurface,
  type SwellSample, type SwellShape, type WaveField,
} from '../utils/waveField';
import { surveyedHeight, createRandom } from '../utils/terrain';
import { chopTrains } from '../utils/waterShader';
import type { SurfStyle } from '../utils/surf';

/**
 * Surfers riding the solved swell, true to scale. Each one waits in the lineup, where the
 * set waves start to break for the current conditions (out on the canyon rim on big days,
 * close to the beach on small ones), goes for a set wave as its face arrives, rides it
 * locked to the face just ahead of the crest while trimming along it, then kicks out and
 * paddles back. On tow-in days each surfer has a jet ski that circles with them on the rope,
 * whips them in, follows on the shoulder and picks them up on its rescue sled.
 */

interface SurfersProps {
  config: WaveConfig;
  style: SurfStyle;
  field: WaveField;
  timeRef: MutableRefObject<number>;
  swellClock: MutableRefObject<number>;
}

type Stage = 'waiting' | 'riding' | 'pickup' | 'returning';

interface Surfer {
  stage: Stage;
  placed: boolean;
  x: number; z: number;      // Board position
  hx: number; hz: number;    // Heading (unit)
  stageTime: number;
  eligibleAt: number;        // Sim time from which they go for a wave
  rideLength: number;
  side: number;              // +1 / -1: which way along the crest they trim
  lateral: number;           // Trim speed along the crest
  // Tow-in: the jet ski
  sx: number; sz: number;
  shx: number; shz: number;
  orbit: number;
}

const TAU = 2 * Math.PI;
const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU);
/** theta of the crest is ~pi/2 (see swellSurface); surfers sit on the face just ahead of it */
const FACE = Math.PI / 2 + 0.45;
const CATCH_WINDOW = 0.35;     // Radians of theta before the face reaches them
const CATCH_SET = 0.9;         // Set envelope (x Hs) a wave needs to be worth going for
const LOCK_RATE = 1.5;         // 1/s, how hard they hold their place on the face
const LOST_WAVE = 1.4;         // Radians off the face: the wave has gone without them
const MIN_DEPTH = 1.2;         // Kick out before the shore break
const ROAM = 300;              // Metres along the beach from their lineup before kicking out
const PADDLE_SPEED = 2.2;
const SKI_SPEED = 14;
const ORBIT_RADIUS = 22;
const ROPE = 12;

const PADDLE_LINEUP = [-120, -60, 0, 60, 120];
const TOW_LINEUP = [-200, -130, -60]; // Around the canyon peak (PEAK.x = -150)
const BOARD_COLORS = ['#f3efe4', '#f2c230', '#e8553b', '#3aa7d8', '#7dd36b'];

/**
 * Where set waves start to break along the line x = const, marching in from the Atlantic:
 * the first point where a set wave reaches most of its depth limit, a little outside it.
 */
function lineupZ(field: WaveField, x: number, height: number, focus: number, sample: SwellSample) {
  let lastWet = -1200;
  for (let z = -1200; z < 300; z += 10) {
    const depth = -surveyedHeight(x, z);
    if (depth <= 0) break;
    lastWet = z;
    sampleSwell(field, x, z, sample);
    const set = height * (1 + (sample.gain - 1) * focus) * 1.15;
    const limit = BREAKER_RATIO * (1 + CROSSING_BREAKER * sample.crossing) * depth;
    if (set >= 0.85 * limit) return z - 20;
  }
  return lastWet - 30;
}

// Rider poses in the board frame: X to the nose, Y up, Z to the right
type Limb = { from: [number, number, number]; to: [number, number, number]; r: number; skin?: boolean };
const POSES: Record<'stand' | 'sit' | 'prone', { limbs: Limb[]; head: [number, number, number] }> = {
  // Crouched, side-on, arms out for balance
  stand: {
    limbs: [
      { from: [0.38, 0.05, 0], to: [0.12, 0.72, 0.04], r: 0.075 },
      { from: [-0.38, 0.05, 0], to: [-0.1, 0.72, 0.04], r: 0.075 },
      { from: [0, 0.75, 0.04], to: [0.12, 1.25, 0.08], r: 0.15 },
      { from: [0.12, 1.2, 0.08], to: [0.62, 1.05, 0.2], r: 0.05, skin: true },
      { from: [0.02, 1.2, 0.04], to: [-0.45, 1.08, 0.18], r: 0.05, skin: true },
    ],
    head: [0.18, 1.42, 0.1],
  },
  // Sitting astride the tail, legs in the water
  sit: {
    limbs: [
      { from: [-0.3, 0.06, 0.12], to: [-0.05, -0.45, 0.22], r: 0.075 },
      { from: [-0.3, 0.06, -0.12], to: [-0.05, -0.45, -0.22], r: 0.075 },
      { from: [-0.3, 0.08, 0], to: [-0.28, 0.62, 0], r: 0.15 },
      { from: [-0.28, 0.55, 0.2], to: [-0.1, 0.15, 0.26], r: 0.05, skin: true },
      { from: [-0.28, 0.55, -0.2], to: [-0.1, 0.15, -0.26], r: 0.05, skin: true },
    ],
    head: [-0.26, 0.8, 0],
  },
  // Lying on the board, paddling
  prone: {
    limbs: [
      { from: [-0.45, 0.13, 0.08], to: [-1.2, 0.1, 0.1], r: 0.07 },
      { from: [-0.45, 0.13, -0.08], to: [-1.2, 0.1, -0.1], r: 0.07 },
      { from: [-0.45, 0.17, 0], to: [0.2, 0.2, 0], r: 0.15 },
      { from: [0.15, 0.2, 0.2], to: [0.4, -0.25, 0.32], r: 0.05, skin: true },
      { from: [0.15, 0.2, -0.2], to: [0.4, -0.25, -0.32], r: 0.05, skin: true },
    ],
    head: [0.38, 0.3, 0],
  },
};
// Jet ski driver, sitting on the saddle
const DRIVER: { limbs: Limb[]; head: [number, number, number] } = {
  limbs: [
    { from: [-0.2, 0.75, 0.15], to: [0.3, 0.45, 0.32], r: 0.075 },
    { from: [-0.2, 0.75, -0.15], to: [0.3, 0.45, -0.32], r: 0.075 },
    { from: [-0.25, 0.75, 0], to: [-0.1, 1.3, 0], r: 0.15 },
    { from: [-0.08, 1.22, 0.18], to: [0.55, 1.0, 0.3], r: 0.05, skin: true },
    { from: [-0.08, 1.22, -0.18], to: [0.55, 1.0, -0.3], r: 0.05, skin: true },
  ],
  head: [-0.05, 1.48, 0],
};

const UP = new THREE.Vector3(0, 1, 0);

function LimbMesh({ limb, suit, skin }: { limb: Limb; suit: THREE.Material; skin: THREE.Material }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...limb.from);
    const b = new THREE.Vector3(...limb.to);
    const dir = b.clone().sub(a);
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
      length: dir.length(),
    };
  }, [limb]);
  return (
    <mesh position={position} quaternion={quaternion} material={limb.skin ? skin : suit}>
      <capsuleGeometry args={[limb.r, Math.max(0.01, length - 2 * limb.r), 3, 8]} />
    </mesh>
  );
}

function Figure({ pose, suit, skin, refCallback }: {
  pose: { limbs: Limb[]; head: [number, number, number] };
  suit: THREE.Material; skin: THREE.Material;
  refCallback?: (g: THREE.Group | null) => void;
}) {
  return (
    <group ref={refCallback}>
      {pose.limbs.map((limb, i) => <LimbMesh key={i} limb={limb} suit={suit} skin={skin} />)}
      <mesh position={pose.head} material={skin}>
        <sphereGeometry args={[0.11, 10, 8]} />
      </mesh>
    </group>
  );
}

interface SurferRefs {
  root: THREE.Group | null;
  stand: THREE.Group | null;
  sit: THREE.Group | null;
  prone: THREE.Group | null;
  ski: THREE.Group | null;
}

export function Surfers({ config, style, field, timeRef, swellClock }: SurfersProps) {
  const tow = style === 'tow';
  const lineupX = tow ? TOW_LINEUP : PADDLE_LINEUP;

  const surfers = useMemo<Surfer[]>(() => {
    const random = createRandom(tow ? 4242 : 1717);
    return lineupX.map(() => ({
      stage: 'waiting', placed: false, x: 0, z: 0, hx: 0, hz: -1,
      stageTime: 0, eligibleAt: random() * 25, rideLength: 0, side: 1, lateral: 0,
      sx: 0, sz: 0, shx: 0, shz: 1, orbit: random() * TAU,
    }));
  }, [tow, lineupX]);

  const sample = useMemo<SwellSample>(() => ({ gain: 0, shift: 0, crossing: 0, phase: 0 }), []);
  const shape = useMemo<SwellShape>(() => ({ y: 0, breaking: 0, crest: 0 }), []);

  // Where each surfer waits: re-found when the swell or its height changes
  const lineups = useMemo(
    () => lineupX.map((x) => ({ x, z: lineupZ(field, x, config.waveHeight, config.canyonAmplification, sample) })),
    [field, config.waveHeight, config.canyonAmplification, lineupX, sample],
  );

  const refs = useRef<SurferRefs[]>([]);
  const simTime = useRef(0);
  const lastCatch = useRef(-Infinity);
  const random = useMemo(() => createRandom(99), []);

  const materials = useMemo(() => ({
    suit: new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6 }),
    skin: new THREE.MeshStandardMaterial({ color: '#c99a76', roughness: 0.7 }),
    boards: BOARD_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.35 })),
    hull: new THREE.MeshStandardMaterial({ color: '#d8352a', roughness: 0.4 }),
    deck: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.5 }),
    seat: new THREE.MeshStandardMaterial({ color: '#202225', roughness: 0.8 }),
    sled: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.5 }),
  }), []);

  // Scratch for orienting objects on the water
  const basis = useMemo(() => ({
    m: new THREE.Matrix4(),
    fwd: new THREE.Vector3(),
    up: new THREE.Vector3(),
    side: new THREE.Vector3(),
  }), []);

  useFrame((_, delta) => {
    const dt = config.animateWaves ? Math.min(delta, 0.1) * config.timeScale : 0;
    simTime.current += dt;
    const now = simTime.current;
    const time = timeRef.current;
    const wt = swellClock.current;
    const period = TAU / field.omega;

    // The surface as WaveMesh and FarOcean draw it: swell, secondary swell and wind chop
    const secondaryOmega = TAU / config.secondaryWavePeriod;
    const secondaryK = (secondaryOmega * secondaryOmega) / GRAVITY;
    const secondaryAngle = ((270 - config.secondaryWaveDirection) * Math.PI) / 180;
    const secondaryX = secondaryK * Math.sin(secondaryAngle);
    const secondaryZ = secondaryK * Math.cos(secondaryAngle);
    const chopAmp = config.windChopIntensity * (1 + config.windSpeed / 20) * 0.9;
    const trains = chopTrains(config.windDirection);
    const surfaceY = (x: number, z: number) => {
      const depth = -surveyedHeight(x, z);
      if (depth <= 0) return 0;
      sampleSwell(field, x, z, sample);
      const theta = sample.phase - wt;
      swellSurface(theta, swellHeight(config.waveHeight, sample.gain, config.canyonAmplification, theta), depth, sample.crossing, shape);
      const shelter = Math.min(1, depth / 10);
      let chop = 0;
      for (const train of trains) chop += train.amp * Math.sin(train.kx * x + train.kz * z - train.omega * time);
      const secondary = (config.secondaryWaveHeight / 2) * Math.sin(secondaryX * x + secondaryZ * z - secondaryOmega * time);
      return shape.y + (secondary + chop * chopAmp) * shelter;
    };
    const thetaAt = (x: number, z: number) => sampleSwell(field, x, z, sample).phase - wt;

    // Sits an object on the water at (x, z), nose along (hx, hz), tilted with the surface
    const place = (obj: THREE.Object3D, x: number, z: number, hx: number, hz: number, lift: number) => {
      const y = surfaceY(x, z);
      const e = 1.2;
      const sx = Math.max(-1.5, Math.min(1.5, (surfaceY(x + e, z) - surfaceY(x - e, z)) / (2 * e)));
      const sz = Math.max(-1.5, Math.min(1.5, (surfaceY(x, z + e) - surfaceY(x, z - e)) / (2 * e)));
      const { m, fwd, up, side } = basis;
      up.set(-sx, 1, -sz).normalize();
      fwd.set(hx, 0, hz);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      side.crossVectors(fwd, up);
      m.makeBasis(fwd, up, side);
      obj.quaternion.setFromRotationMatrix(m);
      obj.position.set(x, y + lift, z);
    };

    const turn = (s: Surfer, tx: number, tz: number, rate: number) => {
      const len = Math.hypot(tx, tz);
      if (len < 1e-6) return;
      const k = 1 - Math.exp(-rate * dt);
      const hx = s.hx + (tx / len - s.hx) * k;
      const hz = s.hz + (tz / len - s.hz) * k;
      const h = Math.hypot(hx, hz) || 1;
      s.hx = hx / h;
      s.hz = hz / h;
    };

    surfers.forEach((s, i) => {
      const line = lineups[i];
      if (!s.placed) {
        s.placed = true;
        s.x = line.x;
        s.z = line.z;
        s.sx = line.x + ORBIT_RADIUS;
        s.sz = line.z;
      }
      s.stageTime += dt;

      if (s.stage === 'waiting') {
        if (tow) {
          // Circling on the rope behind the ski
          // (eased in, so that letting go of the sled or a moved lineup does not jump)
          s.orbit += (5 / ORBIT_RADIUS) * dt;
          const ease = 1 - Math.exp(-1.5 * dt);
          const skiX = line.x + ORBIT_RADIUS * Math.cos(s.orbit);
          const skiZ = line.z + ORBIT_RADIUS * Math.sin(s.orbit);
          const sd = Math.hypot(skiX - s.sx, skiZ - s.sz);
          const sStep = Math.min(sd, SKI_SPEED * dt);
          if (sd > 1e-3) {
            s.sx += ((skiX - s.sx) / sd) * sStep;
            s.sz += ((skiZ - s.sz) / sd) * sStep;
          }
          s.shx = -Math.sin(s.orbit);
          s.shz = Math.cos(s.orbit);
          const back = s.orbit - ROPE / ORBIT_RADIUS;
          s.x += (line.x + ORBIT_RADIUS * Math.cos(back) - s.x) * ease;
          s.z += (line.z + ORBIT_RADIUS * Math.sin(back) - s.z) * ease;
          turn(s, -Math.sin(back), Math.cos(back), 3);
        } else {
          // Sitting up, facing the sea
          sampleSwell(field, s.x + 2, s.z, sample);
          const px = sample.phase;
          sampleSwell(field, s.x, s.z + 2, sample);
          const pz = sample.phase;
          const p0 = sampleSwell(field, s.x, s.z, sample).phase;
          turn(s, -(px - p0), -(pz - p0), 2);
          if (Math.hypot(s.x - line.x, s.z - line.z) > 6) {
            s.stage = 'returning';
            s.stageTime = 0;
          }
        }

        // Go for a set wave as its face arrives, one surfer per wave
        const theta = thetaAt(s.x, s.z);
        const ahead = wrapAngle(theta - FACE);
        if (dt > 0 && now >= s.eligibleAt && now - lastCatch.current > 0.6 * period
          && ahead > 0 && ahead < CATCH_WINDOW && setEnvelope(theta) >= CATCH_SET) {
          lastCatch.current = now;
          s.stage = 'riding';
          s.stageTime = 0;
          s.lateral = 0;
          s.side = random() < 0.5 ? -1 : 1;
          s.rideLength = (tow ? 14 : 9) + random() * 10;
        }
      } else if (s.stage === 'riding') {
        // Hold the place on the face: ride with the wave, corrected towards FACE, and trim along the crest
        const p0 = sampleSwell(field, s.x, s.z, sample).phase;
        const theta = p0 - wt;
        const gx = (sampleSwell(field, s.x + 2, s.z, sample).phase - sampleSwell(field, s.x - 2, s.z, sample).phase) / 4;
        const gz = (sampleSwell(field, s.x, s.z + 2, sample).phase - sampleSwell(field, s.x, s.z - 2, sample).phase) / 4;
        const g = Math.max(1e-4, Math.hypot(gx, gz));
        const nx = gx / g, nz = gz / g;
        const c = field.omega / g;
        const err = wrapAngle(theta - FACE);
        const along = c - (err / g) * LOCK_RATE;
        const maxLateral = Math.min(16, Math.max(4, 0.75 * c));
        s.lateral = Math.min(maxLateral, s.lateral + (maxLateral / 2.5) * dt);
        const vx = nx * along - nz * s.side * s.lateral;
        const vz = nz * along + nx * s.side * s.lateral;
        s.x += vx * dt;
        s.z += vz * dt;
        turn(s, vx, vz, 5);

        const depth = -surveyedHeight(s.x, s.z);
        if (s.stageTime > s.rideLength || depth < MIN_DEPTH || Math.abs(err) > LOST_WAVE || Math.abs(s.x - line.x) > ROAM) {
          s.stage = tow ? 'pickup' : 'returning';
          s.stageTime = 0;
        }
        if (tow) {
          // The ski follows out on the shoulder, behind the wave
          const tx = s.x - nx * 35 + -nz * s.side * 15;
          const tz = s.z - nz * 35 + nx * s.side * 15;
          const d = Math.hypot(tx - s.sx, tz - s.sz);
          const step = Math.min(d, Math.min(24, d * 1.5) * dt);
          if (d > 1e-3) {
            s.sx += ((tx - s.sx) / d) * step;
            s.sz += ((tz - s.sz) / d) * step;
          }
          s.shx = vx; s.shz = vz;
          const h = Math.hypot(s.shx, s.shz) || 1;
          s.shx /= h; s.shz /= h;
        }
      } else if (s.stage === 'pickup') {
        // The surfer drifts on the board; the ski comes in for them
        const dx = s.x - s.sx, dz = s.z - s.sz;
        const d = Math.hypot(dx, dz);
        if (d < 3) {
          s.stage = 'returning';
          s.stageTime = 0;
        } else {
          const step = Math.min(d, SKI_SPEED * 1.3 * dt);
          s.sx += (dx / d) * step;
          s.sz += (dz / d) * step;
          s.shx = dx / d;
          s.shz = dz / d;
        }
      } else {
        // Back out to the lineup: paddling, or on the ski's sled
        const fromX = tow ? s.sx : s.x, fromZ = tow ? s.sz : s.z;
        const toX = tow ? line.x + ORBIT_RADIUS * Math.cos(s.orbit) : line.x;
        const toZ = tow ? line.z + ORBIT_RADIUS * Math.sin(s.orbit) : line.z;
        const dx = toX - fromX, dz = toZ - fromZ;
        const d = Math.hypot(dx, dz);
        if (d < 3) {
          s.stage = 'waiting';
          s.stageTime = 0;
          s.eligibleAt = now + period * (1 + random() * 3);
        } else {
          const step = Math.min(d, (tow ? SKI_SPEED : PADDLE_SPEED) * dt);
          if (tow) {
            s.sx += (dx / d) * step;
            s.sz += (dz / d) * step;
            const k = 1 - Math.exp(-4 * dt);
            s.shx += (dx / d - s.shx) * k;
            s.shz += (dz / d - s.shz) * k;
            const h = Math.hypot(s.shx, s.shz) || 1;
            s.shx /= h; s.shz /= h;
            s.x = s.sx - s.shx * 2.6;
            s.z = s.sz - s.shz * 2.6;
            s.hx = s.shx; s.hz = s.shz;
          } else {
            s.x += (dx / d) * step;
            s.z += (dz / d) * step;
            turn(s, dx, dz, 3);
          }
        }
      }

      // Pose and place
      const r = refs.current[i];
      if (!r?.root) return;
      const standing = s.stage === 'riding' || (tow && s.stage === 'waiting');
      const onSled = tow && s.stage === 'returning';
      if (r.stand) r.stand.visible = standing;
      if (r.sit) r.sit.visible = !tow && s.stage === 'waiting';
      if (r.prone) r.prone.visible = !standing && !(!tow && s.stage === 'waiting');
      place(r.root, s.x, s.z, s.hx, s.hz, onSled ? 0.35 : 0.04);
      if (r.ski) place(r.ski, s.sx, s.sz, s.shx, s.shz, 0.02);
    });
  });

  const setRef = (i: number, key: keyof SurferRefs) => (obj: THREE.Group | null) => {
    refs.current[i] = refs.current[i] ?? { root: null, stand: null, sit: null, prone: null, ski: null };
    refs.current[i][key] = obj;
  };

  return (
    <group>
      {surfers.map((_, i) => (
        <group key={i}>
          <group ref={setRef(i, 'root')}>
            {/* Board: a flattened ellipsoid, shorter and narrower for tow-in */}
            <mesh scale={tow ? [0.9, 0.04, 0.22] : [1.05, 0.045, 0.27]} material={materials.boards[i % materials.boards.length]}>
              <sphereGeometry args={[1, 16, 8]} />
            </mesh>
            <Figure pose={POSES.stand} suit={materials.suit} skin={materials.skin} refCallback={setRef(i, 'stand')} />
            <Figure pose={POSES.sit} suit={materials.suit} skin={materials.skin} refCallback={setRef(i, 'sit')} />
            <Figure pose={POSES.prone} suit={materials.suit} skin={materials.skin} refCallback={setRef(i, 'prone')} />
          </group>
          {tow && (
            <group ref={setRef(i, 'ski')}>
              <mesh position={[0, 0.25, 0]} material={materials.hull}>
                <boxGeometry args={[3, 0.5, 1.1]} />
              </mesh>
              <mesh position={[1.6, 0.3, 0]} rotation={[0, 0, -Math.PI / 2]} scale={[1, 1, 1.8]} material={materials.hull}>
                <coneGeometry args={[0.3, 0.6, 4]} />
              </mesh>
              <mesh position={[0.3, 0.55, 0]} material={materials.deck}>
                <boxGeometry args={[1.4, 0.12, 0.8]} />
              </mesh>
              <mesh position={[-0.3, 0.68, 0]} material={materials.seat}>
                <boxGeometry args={[1.3, 0.16, 0.45]} />
              </mesh>
              <mesh position={[0.6, 0.95, 0]} material={materials.seat}>
                <boxGeometry args={[0.1, 0.06, 0.75]} />
              </mesh>
              {/* Rescue sled the surfer rides back on */}
              <mesh position={[-2.6, 0.12, 0]} material={materials.sled}>
                <boxGeometry args={[2, 0.14, 1.2]} />
              </mesh>
              <Figure pose={DRIVER} suit={materials.suit} skin={materials.skin} />
            </group>
          )}
        </group>
      ))}
    </group>
  );
}
