import { useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BREAKWATER,
  FUNICULAR,
  terrainHeight,
  plateauDistance,
  shoreZ,
  segmentDistance,
  clamp,
  createRandom,
} from '../utils/terrain';
import { createInstancedMesh, createHouseMeshes, createLightPoints, disposeObject, type InstanceSpec } from '../utils/instancing';

interface TownProps {
  night: boolean;
}

// Town grid between the Sítio cliff and the harbour (streets run inland, perpendicular to the beach)
const TOWN_MIN_X = -1045;
const TOWN_MAX_X = -478;
const LANE_SPACING = 15;   // Narrow lanes between house columns
const LOT_DEPTH = 10.5;
const SEAFRONT = 86;       // Distance of the first row of houses from the waterline

const wallColors = ['#f6f3ee', '#f4f1ea', '#efe9dc', '#f2efe8', '#ece2c8', '#f1e3b5', '#dfe8ec', '#f3e1d3']
  .map((c) => new THREE.Color(c));
// Facades clad in azulejo tiles
const tileColors = ['#5f86b3', '#6f9a86', '#c9a24a'].map((c) => new THREE.Color(c));
const roofColors = ['#b4552f', '#a34a2a', '#c0683d', '#9b4528'].map((c) => new THREE.Color(c));

/**
 * Nazaré town: whitewashed 2-3 storey houses along narrow lanes, taller hotels and
 * apartment blocks on the seafront Avenida da República.
 */
function createTownHouses() {
  const rand = createRandom(1912);
  const walls: InstanceSpec[] = [];
  const roofs: InstanceSpec[] = [];
  const lights: THREE.Vector3[] = [];
  const { lower, upper } = FUNICULAR;

  const addHouse = (x: number, z: number, width: number, depth: number, storeys: number) => {
    // Sit on the lowest corner so houses on the slope never float
    const y = Math.min(
      terrainHeight(x - width / 2, z - depth / 2),
      terrainHeight(x + width / 2, z - depth / 2),
      terrainHeight(x - width / 2, z + depth / 2),
      terrainHeight(x + width / 2, z + depth / 2),
    ) - 0.8;
    const height = storeys * 3 + 0.8;
    const tiled = rand() < 0.08;
    walls.push({
      position: new THREE.Vector3(x, y, z),
      rotationY: 0,
      scale: new THREE.Vector3(width, height, depth),
      color: tiled ? tileColors[Math.floor(rand() * tileColors.length)] : wallColors[Math.floor(rand() * wallColors.length)],
    });
    // Most houses have hipped tile roofs, the taller blocks flat roof terraces
    if (storeys <= 3 ? rand() < 0.85 : rand() < 0.25) {
      roofs.push({
        position: new THREE.Vector3(x, y + height, z),
        rotationY: 0,
        scale: new THREE.Vector3(width * 1.06, 1.4 + rand() * 1.2, depth * 1.06),
        color: roofColors[Math.floor(rand() * roofColors.length)],
      });
    }
    // Lit windows on the seaward facade
    for (let s = 0; s < storeys; s++) {
      if (rand() < 0.35) {
        lights.push(new THREE.Vector3(x + (rand() - 0.5) * width * 0.7, y + 2.5 + s * 3, z - depth / 2 - 0.3));
      }
    }
  };

  for (let gx = TOWN_MIN_X; gx < TOWN_MAX_X; gx += LANE_SPACING) {
    const front = shoreZ(gx + LANE_SPACING / 2) + SEAFRONT;
    let row = 0;
    for (let gz = front; gz < 800; gz += LOT_DEPTH, row++) {
      // Every few lots a cross street
      if (row % 5 === 4) continue;
      const x = gx + (LANE_SPACING - 4) / 2 + (rand() - 0.5);
      const z = gz + LOT_DEPTH / 2;
      // Stay off the cliffs and the funicular
      if (plateauDistance(x, z) > -10) continue;
      if (segmentDistance(x, z, lower.x, lower.z, upper.x, upper.z).dist < 9) continue;
      if (Math.hypot(x - lower.x, z - lower.z) < 16) continue;
      // Small squares and yards
      if (rand() < 0.05) continue;

      const width = LANE_SPACING - 4 - rand() * 1.2;
      const depth = LOT_DEPTH - 0.8 - rand() * 1.2;
      const storeys = row === 0 ? 4 + Math.floor(rand() * 4) : 2 + Math.floor(rand() * 2.3);
      if (row > 0 && rand() < 0.5) {
        // Two narrow houses side by side
        addHouse(x - width / 4, z, width / 2 - 0.15, depth, Math.max(1, storeys + Math.floor(rand() * 3) - 1));
        addHouse(x + width / 4, z, width / 2 - 0.15, depth, Math.max(1, storeys + Math.floor(rand() * 3) - 1));
      } else {
        addHouse(x, z, width, depth, storeys);
      }
    }
  }

  // Street lamps along the seafront promenade and up the lanes
  for (let x = TOWN_MIN_X; x < TOWN_MAX_X; x += 14) {
    const z = shoreZ(x) + 67;
    lights.push(new THREE.Vector3(x, terrainHeight(x, z) + 5, z));
  }
  for (let gx = TOWN_MIN_X - 2; gx < TOWN_MAX_X; gx += LANE_SPACING) {
    for (let z = shoreZ(gx) + SEAFRONT + 20; z < 790; z += 24) {
      if (plateauDistance(gx, z) > -10) continue;
      lights.push(new THREE.Vector3(gx, terrainHeight(gx, z) + 5, z));
    }
  }

  return { meshes: createHouseMeshes(walls, roofs), lights };
}

/** Traditional Nazaré fishing boat: brightly painted hull with a tall pointed bow */
function createBoatGeometry() {
  const shape = new THREE.Shape([
    new THREE.Vector2(-3.6, 0.35),
    new THREE.Vector2(-2.6, 0),
    new THREE.Vector2(2.5, 0),
    new THREE.Vector2(3.5, 0.5),
    new THREE.Vector2(4.1, 2.1),
    new THREE.Vector2(3.5, 1.15),
    new THREE.Vector2(-3.2, 1.0),
    new THREE.Vector2(-3.9, 1.5),
  ]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5);
  // Taper towards bow, stern and keel
  const position = geo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const width = 2 * (1 - 0.75 * (x / 4.1) ** 2) * (0.45 + 0.55 * clamp(y, 0, 1));
    position.setZ(i, position.getZ(i) * width);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Striped canvas beach tents (barracas) in rows on the sand */
function createTentGeometry() {
  const body = new THREE.BoxGeometry(2.2, 1.7, 2.2);
  body.translate(0, 0.85, 0);
  const top = new THREE.ConeGeometry(1.6, 0.8, 4);
  top.rotateY(Math.PI / 4);
  top.translate(0, 2.1, 0);
  const geo = mergeGeometries([body, top]);
  body.dispose();
  top.dispose();
  return geo;
}

function createBeach() {
  const rand = createRandom(1640);
  const boats: InstanceSpec[] = [];
  const tents: InstanceSpec[] = [];
  const hullColors = ['#1f5fa8', '#c62d2d', '#e7b416', '#2f8f4e', '#f2f2ee', '#2b2f6b', '#d8642a'].map((c) => new THREE.Color(c));
  const canvasColors = ['#2c64b5', '#d23b3b', '#f0f0ea', '#e9a52a', '#2f8a5b'].map((c) => new THREE.Color(c));

  // Fishing boats hauled up on the south end of the beach, bows to the sea
  for (let x = -1030; x < -860; x += 6 + rand() * 6) {
    const z = shoreZ(x) + 34 + rand() * 24;
    const size = 0.85 + rand() * 0.3;
    boats.push({
      position: new THREE.Vector3(x, terrainHeight(x, z) - 0.15, z),
      rotationY: Math.PI / 2 + (rand() - 0.5) * 0.5,
      scale: new THREE.Vector3(size, size, size),
      color: hullColors[Math.floor(rand() * hullColors.length)],
    });
  }

  // Two rows of tents in front of the town centre
  for (const row of [24, 28]) {
    for (let x = -860; x < -600; x += 3) {
      if (rand() < 0.12) continue;
      const z = shoreZ(x) + row;
      tents.push({
        position: new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z),
        rotationY: 0,
        scale: new THREE.Vector3(1, 1, 1),
        color: canvasColors[Math.floor(rand() * canvasColors.length)],
      });
    }
  }

  return [
    createInstancedMesh(createBoatGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), boats),
    createInstancedMesh(createTentGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.9 }), tents),
  ];
}

/** Concrete crest of the breakwater with a red-and-white beacon at its head */
function Breakwater({ night }: TownProps) {
  const lampRef = useRef<THREE.MeshStandardMaterial>(null);
  const shore = shoreZ(BREAKWATER.x);
  const headZ = shore - BREAKWATER.length + 6;
  const headY = terrainHeight(BREAKWATER.x, headZ);
  const length = BREAKWATER.length + 10;

  // Port-side light: red, flashing every 4 seconds
  useFrame(({ clock }) => {
    if (lampRef.current) lampRef.current.emissiveIntensity = night && clock.elapsedTime % 4 < 1 ? 4 : 0;
  });

  return (
    <group>
      <mesh position={[BREAKWATER.x, 3.4, shore + 15 - length / 2]}>
        <boxGeometry args={[6, 1.2, length]} />
        <meshStandardMaterial color="#a7a397" roughness={0.95} />
      </mesh>
      <group position={[BREAKWATER.x, Math.max(headY, 3.4), headZ]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[0, 1 + i * 2, 0]}>
            <cylinderGeometry args={[0.8 - i * 0.06, 0.85 - i * 0.06, 2, 16]} />
            <meshStandardMaterial color={i % 2 ? '#f2f0ea' : '#c22a20'} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, 8.6, 0]}>
          <cylinderGeometry args={[0.45, 0.45, 1.2, 12]} />
          <meshStandardMaterial ref={lampRef} color="#ff4a3a" emissive="#ff2a1a" emissiveIntensity={0} />
        </mesh>
      </group>
    </group>
  );
}

export function Town({ night }: TownProps) {
  const houses = useMemo(() => createTownHouses(), []);
  const lights = useMemo(() => createLightPoints(houses.lights), [houses]);
  const beach = useMemo(() => createBeach(), []);

  useEffect(() => () => {
    [...houses.meshes, ...beach, lights].forEach(disposeObject);
  }, [houses, beach, lights]);

  return (
    <group>
      {houses.meshes.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      {beach.map((mesh) => <primitive key={mesh.uuid} object={mesh} />)}
      {night && <primitive object={lights} />}
      <Breakwater night={night} />
    </group>
  );
}
