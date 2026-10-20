import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createRover } from './rover.js';
import { startMission } from './mission/index.js';
import { startPhotos } from './photos/index.js';

// --- Renderer ---
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();

// Paleta: cielo caramelo con polvo
const HORIZON = new THREE.Color(0xd99a64);
const MID = new THREE.Color(0xb8774a);
const ZENITH = new THREE.Color(0x6e3f24);
scene.fog = new THREE.FogExp2(HORIZON, 0.0055);

// Sol de tarde: bajo, a la izquierda del encuadre
const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 9),
  THREE.MathUtils.degToRad(180 + 28),
);

// --- Terreno ---
const perlin = new ImprovedNoise();
function heightAt(x, z) {
  // Marco del viento: las dunas se alinean perpendiculares a él
  const u = x * 0.82 + z * 0.57;
  const v = -x * 0.57 + z * 0.82;
  let h = perlin.noise(x * 0.0035, z * 0.0035, 1.3) * 22;
  const r1 = 1 - Math.abs(perlin.noise(u * 0.018, v * 0.005, 7.1));
  h += r1 * r1 * r1 * 11;
  const r2 = 1 - Math.abs(perlin.noise(u * 0.045, v * 0.016, 3.7));
  h += r2 * r2 * 2.8;
  h += perlin.noise(x * 0.25, z * 0.25, 9.2) * 0.12;
  return h;
}

const CAM_X = 0;
const CAM_Z = 34; // centro de la distribución de rocas
// El rover mira ~40° a la derecha del sol: luz lateral que lo modela, el sol en el borde del encuadre y las lunas al centro
const ROVER_START = { x: 0, z: 20, heading: THREE.MathUtils.degToRad(168) };
const TERRAIN_SIZE = 900;
const TERRAIN_SEGS = 420;
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGS, TERRAIN_SEGS);
terrainGeo.rotateX(-Math.PI / 2);
const pos = terrainGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
}
terrainGeo.computeVertexNormals();

// Altura exacta de la malla visible (no de la función de ruido): interpola la misma
// triangulación que PlaneGeometry, así el rover y las huellas pisan justo sobre la arena.
const GRID_N = TERRAIN_SEGS + 1;
const CELL = TERRAIN_SIZE / TERRAIN_SEGS;
const gridH = new Float32Array(GRID_N * GRID_N);
for (let i = 0; i < gridH.length; i++) gridH[i] = pos.getY(i);
function groundAt(x, z) {
  const gx = THREE.MathUtils.clamp((x + TERRAIN_SIZE / 2) / CELL, 0, TERRAIN_SEGS - 1e-4);
  const gz = THREE.MathUtils.clamp((z + TERRAIN_SIZE / 2) / CELL, 0, TERRAIN_SEGS - 1e-4);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const a = gridH[ix + GRID_N * iz];
  const b = gridH[ix + GRID_N * (iz + 1)];
  const c = gridH[ix + 1 + GRID_N * (iz + 1)];
  const d = gridH[ix + 1 + GRID_N * iz];
  return fx + fz <= 1 ? a + fx * (d - a) + fz * (b - a) : c + (1 - fx) * (b - c) + (1 - fz) * (d - c);
}

// Color por altura y pendiente: óxido en valles, arena clara en crestas
const colors = new Float32Array(pos.count * 3);
const normals = terrainGeo.attributes.normal;
const sandLight = new THREE.Color(0xd08a55);
const sandDark = new THREE.Color(0x8a4526);
const rust = new THREE.Color(0x6b2e18);
const tmp = new THREE.Color();
for (let i = 0; i < pos.count; i++) {
  const y = pos.getY(i);
  const slope = 1 - normals.getY(i);
  const t = THREE.MathUtils.smoothstep(y, -10, 25);
  tmp.copy(sandDark).lerp(sandLight, t);
  tmp.lerp(rust, Math.min(slope * 2.5, 0.6));
  const n = perlin.noise(pos.getX(i) * 0.08, 0, pos.getZ(i) * 0.08) * 0.06;
  colors[i * 3] = tmp.r + n;
  colors[i * 3 + 1] = tmp.g + n * 0.7;
  colors[i * 3 + 2] = tmp.b + n * 0.5;
}
terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
// Ondulaciones de arena (ripples) perpendiculares al viento, solo en el normal, cerca de la cámara
terrainMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
      {
        vec2 wind = vec2(0.82, 0.57);
        float ph = dot(vWPos.xz, wind) * 11.0 + sin(vWPos.x * 0.35) * 4.0 + sin(vWPos.z * 0.29 + 1.3) * 4.0;
        float fade = 1.0 - smoothstep(4.0, 30.0, length(vWPos - cameraPosition));
        // perfil asimétrico: ladera suave a barlovento, abrupta a sotavento
        float slope = cos(ph) * (0.6 + 0.4 * sin(ph));
        vec2 g = wind * slope * 0.22 * fade;
        normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
      }`,
    );
};
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

// --- Rocas ---
function makeRockGeometry(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    let d = 1 + perlin.noise(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3) * 0.5;
    d += perlin.noise(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.12;
    // Caras talladas: aplana parcialmente contra planos aleatorios
    d = Math.min(d, 1.05 + perlin.noise(seed, v.x * 0.7, v.z * 0.7) * 0.25);
    v.multiplyScalar(d);
    v.y *= 0.6; // rocas achatadas
    p.setXYZ(i, v.x, v.y, v.z);
    // Polvo depositado arriba, roca más oscura abajo
    const dust = THREE.MathUtils.smoothstep(v.y, -0.1, 0.5);
    const g = 0.85 + perlin.noise(v.x * 6 + seed, v.y * 6, v.z * 6) * 0.25;
    col[i * 3] = (0.62 + dust * 0.35) * g;
    col[i * 3 + 1] = (0.55 + dust * 0.2) * g;
    col[i * 3 + 2] = (0.5 + dust * 0.08) * g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a5038, vertexColors: true, roughness: 0.92 });
const rand = mulberry32(42);
const dummy = new THREE.Object3D();
const ROCK_TYPES = 5;
const ROCKS_PER_TYPE = 260;
const obstacles = []; // rocas grandes con las que el rover choca: { x, z, r }
for (let t = 0; t < ROCK_TYPES; t++) {
  const rocks = new THREE.InstancedMesh(makeRockGeometry(t * 13.7), rockMat, ROCKS_PER_TYPE);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  for (let i = 0; i < ROCKS_PER_TYPE; i++) {
    // Muchas piedras pequeñas cerca de la cámara; las grandes, más lejos
    const r = 3 + Math.pow(rand(), 1.4) * 180;
    const a = rand() * Math.PI * 2;
    const x = CAM_X + Math.cos(a) * r;
    const z = CAM_Z + Math.sin(a) * r;
    const big = Math.pow(rand(), 4) * THREE.MathUtils.smoothstep(r, 14, 50);
    let s = 0.12 + rand() * 0.35 + big * 3.2;
    // Zona despejada alrededor del punto de partida del rover
    if (Math.hypot(x - ROVER_START.x, z - ROVER_START.z) < 9) s = Math.min(s, 0.3);
    const sx = s * (0.8 + rand() * 0.7);
    const sy = s * (0.7 + rand() * 0.5);
    const sz = s * (0.8 + rand() * 0.7);
    dummy.position.set(x, groundAt(x, z) - s * 0.15, z); // semienterradas
    dummy.rotation.set(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.5);
    dummy.scale.set(sx, sy, sz);
    if (s > 0.8) obstacles.push({ x, z, r: ((sx + sz) / 2) * 0.95 });
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  scene.add(rocks);
}

// --- Polvo en suspensión ---
const DUST_COUNT = 2500;
const DUST_BOX = new THREE.Vector3(120, 30, 120);
const dustPos = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3] = (rand() - 0.5) * DUST_BOX.x;
  dustPos[i * 3 + 1] = rand() * DUST_BOX.y;
  dustPos[i * 3 + 2] = (rand() - 0.5) * DUST_BOX.z;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    color: 0xf0b888,
    size: 0.14,
    map: makeSoftDot(),
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  }),
);
dust.frustumCulled = false;
scene.add(dust);

function makeSoftDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- Cielo ---
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1500, 64, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: sunDir },
      horizon: { value: HORIZON },
      mid: { value: MID },
      zenith: { value: ZENITH },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir, horizon, mid, zenith;
      varying vec3 vWorld;
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.18, 1.0, h));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.68, 0.4) * pow(s, 5.0) * 0.4;     // resplandor cálido amplio
        col += vec3(1.0, 0.8, 0.55) * pow(s, 60.0) * 0.6;    // corona
        col += vec3(0.7, 0.82, 1.0) * pow(s, 900.0) * 0.7;   // halo azulado marciano
        col += vec3(1.0, 0.93, 0.8) * smoothstep(0.99986, 0.99993, s) * 9.0; // disco
        col = mix(col, horizon, smoothstep(0.0, -0.08, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }),
);
scene.add(sky);

// --- Luces ---
const sun = new THREE.DirectionalLight(0xffb27a, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 6;
sun.shadow.blurSamples = 16;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const sc = sun.shadow.camera;
sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
sc.near = 1; sc.far = 600;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xe8b48a, 0x5a2a16, 0.7);
scene.add(hemi);

// --- Lunas: Fobos y Deimos ---
// Luz artística: el sol real queda detrás de ellas, así que se adelanta un poco la
// dirección de la luz para mostrar una fase gibosa iluminada desde el lado del sol.
const moonLight = sunDir.clone().add(new THREE.Vector3(0, 0.05, 1.25)).normalize();
const moonMat = new THREE.ShaderMaterial({
  fog: false,
  uniforms: {
    lightDir: { value: moonLight },
    haze: { value: MID.clone().lerp(HORIZON, 0.35) },
  },
  vertexShader: /* glsl */ `
    attribute vec3 color;
    varying vec3 vN;
    varying vec3 vColor;
    void main() {
      vN = normalize(mat3(modelMatrix) * normal);
      vColor = color;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 lightDir, haze;
    varying vec3 vN;
    varying vec3 vColor;
    void main() {
      float lit = smoothstep(-0.05, 0.6, dot(normalize(vN), lightDir));
      vec3 col = vColor * (0.04 + lit * 0.8);
      // Luna diurna: el polvo atmosférico la lava hacia el color del cielo
      col = mix(haze, col, 0.22 + lit * 0.33);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

function makeMoon(radius, stretch, seed) {
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const mrand = mulberry32(seed * 1000);
  const craters = Array.from({ length: 28 }, () => ({
    c: new THREE.Vector3(mrand() - 0.5, mrand() - 0.5, mrand() - 0.5).normalize(),
    r: 0.08 + Math.pow(mrand(), 2) * 0.35,
  }));
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let d = 1 + perlin.noise(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4) * 0.1;
    let shade = 0.78 + perlin.noise(v.x * 5 + seed, v.y * 5, v.z * 5) * 0.18;
    for (const { c, r } of craters) {
      const a = v.angleTo(c) / r;
      if (a < 1) {
        d -= (1 - a * a) * r * 0.25; // cuenco
        shade -= (1 - a) * 0.18;
      } else if (a < 1.3) {
        d += (1.3 - a) * r * 0.15; // borde
        shade += 0.06;
      }
    }
    v.multiplyScalar(d).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
    col[i * 3] = shade * 0.66;
    col[i * 3 + 1] = shade * 0.54;
    col[i * 3 + 2] = shade * 0.44;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, moonMat);
  mesh.scale.setScalar(radius);
  return mesh;
}
function skyOffset(elevDeg, azDeg, dist) {
  return new THREE.Vector3().setFromSphericalCoords(
    dist,
    THREE.MathUtils.degToRad(90 - elevDeg),
    THREE.MathUtils.degToRad(180 + azDeg),
  );
}
const phobos = makeMoon(19, new THREE.Vector3(1.25, 1, 0.95), 3.1);
const deimos = makeMoon(8.5, new THREE.Vector3(1.1, 0.95, 1), 8.4);
phobos.rotation.set(0.3, 1.2, 0.2);

// --- Cámara ---
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 4000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.53; // permite mirar un poco hacia el cielo
controls.minDistance = 4;
controls.maxDistance = 45;

// --- Rover Perseverance ---
// Reflejos: el cielo caramelo y el suelo óxido se convierten en un mapa de entorno
// que solo usan los materiales del rover (metales, vidrio, pintura blanca).
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(sky.geometry, sky.material));
envScene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(1400, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x8a4a2a, side: THREE.BackSide }),
  ),
);
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(envScene, 0.02).texture;
pmrem.dispose();

const rover = createRover({ scene, camera, controls, groundAt, obstacles, start: ROVER_START, envMap });
rover.placeCameraBehind();
window.__rover = rover; // depuración y para el script `npm run check`
startMission(); // control de misión: 4 datos reales de Percy (tecla T para ocultar)

// Cámaras de Percy: puntos que brillan sobre el modelo; un clic abre una foto real de esa cámara
let photos = null;
startPhotos({ camera, canvas, rover }).then((p) => (photos = p));

// Cielo y lunas siguen al rover: se comportan como si estuvieran en el infinito
const PHOBOS_OFFSET = skyOffset(17, -15, 900);
const DEIMOS_OFFSET = skyOffset(13, -30, 900);
scene.add(phobos, deimos);

function updateSky() {
  // El mapa de sombras (±45 m) se mantiene centrado en el rover
  const f = rover.position;
  sun.target.position.set(f.x, f.y, f.z);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);
  sky.position.copy(camera.position);
  phobos.position.copy(camera.position).add(PHOBOS_OFFSET);
  deimos.position.copy(camera.position).add(DEIMOS_OFFSET);
}

// El polvo deriva con el viento y se recicla alrededor de la cámara
const WIND = new THREE.Vector3(1.6, 0.05, 0.6);
function updateDust(dt, t) {
  const p = dustGeo.attributes.position;
  const c = camera.position;
  for (let i = 0; i < DUST_COUNT; i++) {
    let x = p.getX(i) + (WIND.x + Math.sin(t * 0.7 + i) * 0.4) * dt;
    let y = p.getY(i) + (WIND.y + Math.sin(t * 0.9 + i * 1.7) * 0.15) * dt;
    let z = p.getZ(i) + WIND.z * dt;
    x = c.x + THREE.MathUtils.euclideanModulo(x - c.x + DUST_BOX.x / 2, DUST_BOX.x) - DUST_BOX.x / 2;
    z = c.z + THREE.MathUtils.euclideanModulo(z - c.z + DUST_BOX.z / 2, DUST_BOX.z) - DUST_BOX.z / 2;
    y = THREE.MathUtils.euclideanModulo(y, DUST_BOX.y);
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  dust.position.y = c.y - 12;
}

// --- Postproceso: bloom del sol, viñeta y grano de película ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 2.2);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const filmPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      vec2 c = vUv - 0.5;
      col *= mix(1.0, 0.62, smoothstep(0.25, 0.85, dot(c, c) * 2.2)); // viñeta
      col += (hash(vUv * 1000.0 + fract(time) * 37.0) - 0.5) * 0.035;  // grano
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
composer.addPass(filmPass);

// --- Bucle ---
const timer = new THREE.Timer();
let ready = false;
renderer.setAnimationLoop((time) => {
  timer.update(time);
  // El primer delta puede salir negativo (el timestamp de rAF es anterior al Timer)
  const dt = THREE.MathUtils.clamp(timer.getDelta(), 0, 0.1);
  rover.update(dt);
  controls.update();
  updateSky();
  updateDust(dt, timer.getElapsed());
  filmPass.uniforms.time.value = timer.getElapsed();
  photos?.update(timer.getElapsed());
  composer.render();
  if (!ready) {
    ready = true;
    window.__ready = true;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
