/**
 * Per-pixel terrain shading. The land cover rasters are 10 m grids and the mesh is
 * metres coarse, so everything that gives the ground its texture is done here instead:
 * land cover from filtered mask textures with noise-warped edges, cliff strata and
 * gullies, pine canopy, fields, sand ripples and wet sand, plus a micro-relief bump
 * that perturbs the shading normal. Fine detail fades with distance to avoid shimmer.
 */
import * as THREE from 'three';
import { detailGrid, surfaceClasses, SURFACE } from './geodata';
import { FORT_POSITION, FORT_GROUND, LARGO } from './terrain';

const glslColor = (hex: string) => {
  const c = new THREE.Color(hex); // Converted to the linear working space
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** Mask textures on the detail grid, softened by a binomial blur so bilinear filtering gives smooth contours */
function createMaskTextures() {
  const { nx, nz } = detailGrid;
  const cover = new Float32Array(nx * nz * 4);
  const feature = new Float32Array(nx * nz * 4);
  for (let k = 0; k < nx * nz; k++) {
    const s = surfaceClasses[k];
    const cls = s & SURFACE.classMask;
    cover[k * 4] = cls === SURFACE.beach ? 1 : 0;
    cover[k * 4 + 1] = cls === SURFACE.forest ? 1 : 0;
    cover[k * 4 + 2] = cls === SURFACE.farmland ? 1 : 0;
    cover[k * 4 + 3] = cls === SURFACE.urban ? 1 : 0;
    feature[k * 4] = s & SURFACE.road ? 1 : 0;
    feature[k * 4 + 1] = s & SURFACE.rock ? 1 : 0;
  }
  const blur = (src: Float32Array) => {
    const tmp = new Float32Array(src.length);
    const out = new Uint8Array(src.length);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const l = Math.max(i - 1, 0);
        const r = Math.min(i + 1, nx - 1);
        for (let c = 0; c < 4; c++) {
          tmp[(j * nx + i) * 4 + c] = 0.25 * src[(j * nx + l) * 4 + c] + 0.5 * src[(j * nx + i) * 4 + c] + 0.25 * src[(j * nx + r) * 4 + c];
        }
      }
    }
    for (let j = 0; j < nz; j++) {
      const d = Math.max(j - 1, 0);
      const u = Math.min(j + 1, nz - 1);
      for (let i = 0; i < nx; i++) {
        for (let c = 0; c < 4; c++) {
          const v = 0.25 * tmp[(d * nx + i) * 4 + c] + 0.5 * tmp[(j * nx + i) * 4 + c] + 0.25 * tmp[(u * nx + i) * 4 + c];
          out[(j * nx + i) * 4 + c] = Math.round(v * 255);
        }
      }
    }
    return out;
  };
  const texture = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  return { cover: texture(blur(cover)), feature: texture(blur(feature)) };
}

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
`;

const VERTEX_BODY = /* glsl */ `
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform sampler2D uCover;   // R beach, G forest, B farmland, A urban
uniform sampler2D uFeature; // R road, G harbour rock
uniform vec2 uGridMin;
uniform vec2 uGridN;
uniform float uGridCell;
uniform vec4 uLargo;        // minX, maxX, minZ, maxZ
uniform vec3 uFort;         // x, z, courtyard height
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;

const vec3 SEABED = ${glslColor('#6f6249')};
const vec3 WET_SAND = ${glslColor('#9a7f57')};
const vec3 SAND = ${glslColor('#dcbf87')};
const vec3 DRY_SAND = ${glslColor('#e6cf9e')};
const vec3 DUNE_GRASS = ${glslColor('#8c8d58')};
const vec3 DRY_GRASS = ${glslColor('#a39a62')};
const vec3 PLATEAU = ${glslColor('#77793f')};
const vec3 SCRUB = ${glslColor('#5f6a39')};
const vec3 BUSH = ${glslColor('#3f4a26')};
const vec3 PINE = ${glslColor('#34492a')};
const vec3 PINE_FLOOR = ${glslColor('#5a5032')};
const vec3 FARM_A = ${glslColor('#8a8a4e')};
const vec3 FARM_B = ${glslColor('#a29257')};
const vec3 FARM_C = ${glslColor('#6f7d3d')};
const vec3 SANDSTONE = ${glslColor('#bb8656')};
const vec3 SANDSTONE_LIGHT = ${glslColor('#d4a676')};
const vec3 SANDSTONE_DARK = ${glslColor('#8b5d3b')};
const vec3 ROCK = ${glslColor('#7c7366')};
const vec3 ROCK_DARK = ${glslColor('#4a443c')};
const vec3 PAVING = ${glslColor('#b9ad94')};
const vec3 CALCADA = ${glslColor('#c4bdad')};
const vec3 ASPHALT = ${glslColor('#55534f')};
const vec3 URBAN = ${glslColor('#8f877a')};

float tHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Value noise in [-1, 1]
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x),
             mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y) * 2.0 - 1.0;
}
float tFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * tNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.0;
    a *= 0.5;
  }
  return s / 0.9375;
}
// Two rotated octaves: hides the axis-aligned lattice of single value noise
float tNoise2(vec2 p) {
  return 0.6 * tNoise(p) + 0.4 * tNoise(mat2(0.6, -0.8, 0.8, 0.6) * p * 1.73 + 11.0);
}
vec2 gridUV(vec2 xz) { return ((xz - uGridMin) / uGridCell + 0.5) / uGridN; }
// Fades out over the last ~200 m so mapped land cover doesn't stop in a straight line at the grid edge
float gridInside(vec2 uv) {
  vec2 edge = min(uv, 1.0 - uv) * uGridN * uGridCell;
  return smoothstep(0.0, 200.0, min(edge.x, edge.y));
}

// Bump mapping from screen-space derivatives (Mikkelsen), as in three's bumpmap chunk
vec3 terrainPerturbNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sigmaX = dFdx(surfPos);
  vec3 sigmaY = dFdy(surfPos);
  vec3 r1 = cross(sigmaY, surfNorm);
  vec3 r2 = cross(surfNorm, sigmaX);
  float det = dot(sigmaX, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}

vec3 terrainShade(out float bump, out float rough) {
  vec3 p = vTerrainPos;
  vec2 xz = p.xz;
  float y = p.y;
  vec3 n = normalize(vTerrainNormal);
  float slope = 1.0 - n.y;
  float dist = length(p - cameraPosition);
  float near = 1.0 - smoothstep(80.0, 700.0, dist);  // Metre-scale detail
  float mid = 1.0 - smoothstep(400.0, 3000.0, dist); // Bush-scale detail

  float n1 = tFbm(xz * 0.012);              // ~80 m patches
  float n2 = tFbm(xz * 0.06 + 13.1);        // ~16 m
  float n3 = tNoise2(xz * 0.35 + 5.7) * 1.4; // ~3 m
  float n4 = tNoise(xz * 1.9 - 2.3) * near; // grain

  // Land cover with organic edges instead of the 10 m staircase
  vec2 warp = vec2(tFbm(xz * 0.04 + 40.0), tFbm(xz * 0.04 - 40.0)) * 8.0 + vec2(n3, -n3) * 1.5 * mid;
  vec2 uv = gridUV(xz + warp);
  vec4 cover = texture2D(uCover, uv) * gridInside(uv);
  vec2 uvF = gridUV(xz + warp * 0.12);
  vec4 feat = texture2D(uFeature, uvF) * gridInside(uvF);
  float edge = 0.1 * n3 * mid;
  float beach = smoothstep(0.3, 0.6, cover.r + edge);
  float forest = smoothstep(0.3, 0.6, cover.g + edge);
  float farm = smoothstep(0.3, 0.6, cover.b + edge);
  float urban = smoothstep(0.3, 0.6, cover.a + edge);

  bump = 0.0;
  rough = 1.0;

  // Wild ground: dune grass low down, scrub on the plateau, bushes and dry patches
  vec3 col = mix(DUNE_GRASS, SCRUB, smoothstep(-0.3, 0.35, n1));
  col = mix(col, PLATEAU, smoothstep(50.0, 100.0, y + 10.0 * n1) * 0.6);
  col = mix(col, DRY_GRASS, smoothstep(0.15, 0.7, n2) * 0.4);
  float bushes = 0.25 + 0.35 * n1; // Denser in some places than others
  float clumps = tNoise2(xz * 0.17 + 2.9) * 1.4 + 0.35 * n3;
  float bush = mix(bushes * 0.6, smoothstep(0.5 - bushes, 1.1 - bushes, clumps), mid);
  col = mix(col, BUSH, bush * 0.45);
  bump += bush * 0.5;

  // Pine wood: crowns with darker gaps between them
  float crowns = mix(0.6, smoothstep(-0.25, 0.45, tNoise(xz * 0.2 + 3.1) + 0.35 * n3), mid);
  vec3 pine = mix(PINE_FLOOR, PINE, 0.35 + 0.65 * crowns) * (0.9 + 0.15 * n2);
  col = mix(col, pine, forest * 0.95);
  bump += forest * crowns * 1.6;

  // Fields: a patchwork of plots with faint furrows
  vec2 plotAxis = mat2(0.8, 0.6, -0.6, 0.8) * xz;
  vec2 plot = floor(plotAxis / vec2(55.0, 24.0) + 0.15 * vec2(n1, n2));
  float tone = tHash(plot + 7.0);
  vec3 field = tone < 0.4 ? mix(FARM_A, FARM_C, tone / 0.4) : mix(FARM_A, FARM_B, (tone - 0.4) / 0.6);
  field *= 1.0 + 0.05 * sin(plotAxis.y * 2.4) * near;
  col = mix(col, field * (0.94 + 0.1 * n2), farm * 0.85);

  // Built-up ground between the houses, with gardens
  vec3 town = URBAN * (0.88 + 0.2 * tHash(floor(xz / 7.0)));
  town = mix(town, SCRUB, smoothstep(0.35, 0.7, n2) * 0.5);
  col = mix(col, town, urban * 0.85);
  bump *= 1.0 - urban * 0.7;

  // Sand on the beaches and on all low ground by the sea
  float sandy = max(beach, 1.0 - smoothstep(2.0, 3.2, y + 0.6 * n2));
  vec3 sand = mix(WET_SAND, SAND, smoothstep(-0.4, 1.4 + 0.3 * n2, y));
  sand = mix(sand, DRY_SAND, smoothstep(2.0, 7.0, y + 2.0 * n2));
  float ripples = sin(dot(xz, vec2(0.75, 0.66)) * 2.6 + n2 * 5.0 + n3) * near;
  sand *= 1.0 + 0.035 * ripples + 0.04 * n3 * mid;
  // Sparse marram grass holding the dunes
  sand = mix(sand, DUNE_GRASS * (0.85 + 0.2 * n2), smoothstep(0.1, 0.9, clumps + 0.3 * n1) * smoothstep(4.0, 9.0, y) * 0.55);
  float wet = 1.0 - smoothstep(-0.1, 1.1, y + 0.2 * n3);
  col = mix(col, sand, sandy);
  bump = mix(bump, ripples * 0.025, sandy);
  rough = mix(rough, mix(0.95, 0.4, wet), sandy);

  // Seabed
  float seabed = 1.0 - smoothstep(-1.2, -0.4, y);
  col = mix(col, SEABED * (0.9 + 0.15 * n2), seabed);

  // Streets from OSM, the paved Largo and the fort courtyard
  float road = smoothstep(0.38, 0.55, feat.r) * smoothstep(0.6, 1.2, y);
  col = mix(col, ASPHALT * (0.95 + 0.08 * n3), road * 0.88);
  bump *= 1.0 - road;
  rough = mix(rough, 0.85, road);
  float largo = max(max(uLargo.x - xz.x, xz.x - uLargo.y), max(uLargo.z - xz.y, xz.y - uLargo.w));
  vec2 cobble = fract(xz * 2.2) - 0.5;
  float joints = smoothstep(0.38, 0.5, max(abs(cobble.x), abs(cobble.y))) * near;
  float paved = smoothstep(2.0, -1.0, largo);
  col = mix(col, CALCADA * (1.0 - 0.12 * joints), paved);
  float fortDist = length(xz - uFort.xy);
  float courtyard = smoothstep(26.0, 20.0, fortDist) * step(uFort.z - 2.0, y);
  col = mix(col, PAVING * (1.0 - 0.1 * joints), courtyard);
  bump = mix(bump, -joints * 0.04, max(paved, courtyard));

  // Cliff faces: layered ochre sandstone over grey limestone, gullies running down
  float rockiness = smoothstep(0.14 + 0.07 * n2, 0.34 + 0.07 * n2, slope) * smoothstep(0.5, 1.5, y);
  if (rockiness > 0.0) {
    float layer = y + 4.0 * tFbm(xz * 0.015) + 0.6 * n2;
    float strata = 0.5 + 0.5 * sin(layer * 0.9) * (0.6 + 0.4 * sin(layer * 0.23 + 1.0));
    strata = mix(strata, 0.5 + 0.5 * tNoise(vec2(layer * 0.7, 3.0)), 0.4);
    float fine = (0.5 + 0.5 * sin(layer * 4.3 + 1.5 * n3)) * near;
    // Noise over x/z only is constant up a vertical face: erosion streaks
    float gully = tFbm(xz * 0.22 + 91.0);
    vec3 rock = mix(SANDSTONE, SANDSTONE_DARK, strata * 0.55);
    rock = mix(rock, SANDSTONE_LIGHT, smoothstep(0.55, 0.95, fine) * 0.35);
    rock *= 0.82 + 0.3 * (0.5 + 0.5 * gully);
    rock = mix(rock, ROCK, smoothstep(30.0, 8.0, y + 5.0 * n2));
    rock = mix(rock, ROCK_DARK, smoothstep(5.0, -1.0, y + n3));
    // Plants holding on to ledges and the gentler parts of the face
    float ledge = smoothstep(0.15, 0.55, n2 + 0.6 * n3 * mid) * (1.0 - smoothstep(0.22, 0.5, slope)) * smoothstep(4.0, 12.0, y);
    float exposed = rockiness * (1.0 - 0.8 * ledge);
    col = mix(col, rock, exposed);
    bump = mix(bump, strata * 0.9 + fine * 0.3 + gully * 0.8, exposed);
    rough = mix(rough, 0.9, exposed);
  }

  // Rock armour of the harbour moles
  float armour = smoothstep(0.3, 0.6, feat.g);
  col = mix(col, ROCK * (0.8 + 0.35 * (0.5 + 0.5 * n3)), armour * 0.9);
  bump = mix(bump, n3 * 0.6, armour);

  // Grain
  col *= 0.93 + 0.14 * (0.5 + 0.5 * n4) * (1.0 - seabed);
  bump += n4 * 0.04;
  bump *= mid;
  return col;
}
`;

export function createTerrainMaterial() {
  const masks = createMaskTextures();
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const uniforms = {
    uCover: { value: masks.cover },
    uFeature: { value: masks.feature },
    uGridMin: { value: new THREE.Vector2(detailGrid.minX, detailGrid.minZ) },
    uGridN: { value: new THREE.Vector2(detailGrid.nx, detailGrid.nz) },
    uGridCell: { value: detailGrid.cell },
    uLargo: { value: new THREE.Vector4(LARGO.minX, LARGO.maxX, LARGO.minZ, LARGO.maxZ) },
    uFort: { value: new THREE.Vector3(FORT_POSITION.x, FORT_POSITION.z, FORT_GROUND) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARATIONS}`)
      .replace(
        '#include <color_fragment>',
        `float terrainBump;\nfloat terrainRough;\ndiffuseColor.rgb = terrainShade(terrainBump, terrainRough);`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= terrainRough;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nnormal = terrainPerturbNormal(-vViewPosition, normal, vec2(dFdx(terrainBump), dFdy(terrainBump)), faceDirection);`
      );
  };
  material.customProgramCacheKey = () => 'nazare-terrain';

  const dispose = material.dispose.bind(material);
  material.dispose = () => {
    masks.cover.dispose();
    masks.feature.dispose();
    dispose();
  };
  return material;
}
