import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const MODEL_URL = '/models/perseverance.glb';

// Medidas reales de Perseverance (NASA/JPL): 2,7 m de ancho incluyendo ruedas.
// El largo (3,0 m) y la altura (2,2 m con el mástil) se loguean como comprobación.
const REAL_WIDTH = 2.7;

// Conducción (el rover real avanza a 4 cm/s; aquí se acelera para poder jugarlo)
const MAX_SPEED = 3.5; // m/s
const BOOST = 2.4; // multiplicador con Shift
const REVERSE_FACTOR = 0.6;
const ACCEL = 4.5; // m/s²
const BRAKE = 9;
const TURN_RATE = 1.0; // rad/s
const BODY_RADIUS = 1.5; // para chocar con rocas grandes

// La cámara apunta un poco por encima del rover: queda en el tercio inferior y deja ver el cielo
const FOCUS_HEIGHT = 2.0;

// Huellas
const TRACK_SPACING = 0.22; // m recorridos entre sellos de una misma rueda
const TRACK_CAPACITY = 14000;
const TRACK_WIDTH = 0.4;
const TRACK_LENGTH = TRACK_SPACING + 0.02; // los sellos encajan sin solaparse (si no, la banda se ve cuadriculada)

// Piezas que son cámaras (por nombre de nodo en el GLB)
const CAMERA_NAME = /cam|watson/i;
const NOT_A_CAMERA = /cover|wiring|bracket/i;

const _v = new THREE.Vector3();

export function createRover({ scene, camera, controls, groundAt, obstacles, start, envMap }) {
  const group = new THREE.Group(); // posición y orientación del rover en el mundo
  group.position.set(start.x, groundAt(start.x, start.z), start.z);
  scene.add(group);

  const state = {
    heading: start.heading, // 0 = frente hacia +Z
    speed: 0,
    yawRate: 0,
    distance: 0,
  };
  // Contactos de las 6 ruedas en el marco del rover: x > 0 = izquierda, z > 0 = frente.
  // Valores por defecto hasta medir el modelo.
  let wheels = defaultWheels();
  const cameras = {};
  const cameraAnchors = {}; // centro de cada pieza-cámara en el marco del rover (para los puntos de las fotos)
  let resolveLoaded;
  const loaded = new Promise((resolve) => (resolveLoaded = resolve));

  // ---------- Entrada ----------
  const keys = new Set();
  const onKey = (down) => (e) => {
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (down) keys.add(e.code);
    else keys.delete(e.code);
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));
  window.addEventListener('blur', () => keys.clear());
  // Mientras se ve una foto las teclas (flechas, Esc) son de la foto y no del manejo
  let inputEnabled = true;
  const pressed = (...codes) => inputEnabled && codes.some((c) => keys.has(c));

  // ---------- Carga del modelo ----------
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loader.load(
    MODEL_URL,
    (gltf) => {
      try {
        mountModel(gltf);
      } catch (err) {
        console.error('[rover] error al preparar el modelo', err);
      }
      window.__roverReady = true;
      resolveLoaded();
    },
    undefined,
    (err) => {
      console.error('[rover] no se pudo cargar el modelo', err);
      window.__roverReady = true;
      resolveLoaded();
    },
  );

  function mountModel(gltf) {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    // Escala: el ancho total del modelo debe ser el real
    let box = measure(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = REAL_WIDTH / size.x;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    // Origen del rover: centro de la huella de ruedas, a ras de suelo
    box = measure(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -box.min.y, -center.z);
    model.updateMatrixWorld(true);
    // Caja exacta (incluye las piezas con huesos, como el mástil)
    const dims = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
    console.log(
      `[rover] tamaño real: ${dims.z.toFixed(2)} m largo × ${dims.x.toFixed(2)} m ancho × ${dims.y.toFixed(2)} m alto ` +
        `(escala ${scale.toFixed(4)}; NASA: 3,0 × 2,7 × 2,2 m)`,
    );

    wheels = measureWheels(model) ?? wheels;
    console.log(
      '[rover] ruedas (x izq+, z frente+):',
      wheels.map((w) => `(${w.x.toFixed(2)}, ${w.z.toFixed(2)})`).join(' '),
    );

    prevWheel.fill(null);
    prepareMaterials(model, envMap);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // mallas con huesos: la caja de Three no las contiene bien
      }
    });
    group.add(model);
    group.updateMatrixWorld(true);

    // Piezas que son cámaras
    const found = [];
    model.traverse((o) => {
      if (o.name && CAMERA_NAME.test(o.name) && !NOT_A_CAMERA.test(o.name)) {
        cameras[o.name] = o;
        found.push(o);
        const box = new THREE.Box3().setFromObject(o);
        const center = box.isEmpty() ? o.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
        cameraAnchors[o.name] = group.worldToLocal(center);
      }
    });
    console.log(
      `[rover] Piezas que son cámaras (${found.length}):\n` +
        found.map((o) => `  • ${o.name}  ←  ${pathOf(o, model)}`).join('\n'),
    );
  }

  // ---------- Huellas ----------
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x2a1209,
    roughness: 1,
    transparent: true,
    opacity: 0.8,
    alphaMap: makeTreadTexture(),
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const trackGeo = new THREE.PlaneGeometry(TRACK_WIDTH, TRACK_LENGTH);
  trackGeo.rotateX(-Math.PI / 2); // tendida en XZ; el largo va a lo largo de Z
  const tracks = new THREE.InstancedMesh(trackGeo, trackMat, TRACK_CAPACITY);
  tracks.receiveShadow = true;
  tracks.frustumCulled = false;
  tracks.count = 0;
  scene.add(tracks);
  let trackHead = 0;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _one = new THREE.Vector3(1, 1, 1);

  function stampTrack(x, z, dirX, dirZ) {
    // Normal local del terreno (diferencias finitas sobre la malla real)
    const e = 0.4;
    const nx = groundAt(x - e, z) - groundAt(x + e, z);
    const nz = groundAt(x, z - e) - groundAt(x, z + e);
    const normal = _v.set(nx, 2 * e, nz).normalize().clone();
    const fwd = new THREE.Vector3(dirX, 0, dirZ);
    fwd.addScaledVector(normal, -fwd.dot(normal)).normalize();
    const left = new THREE.Vector3().crossVectors(normal, fwd);
    _m.makeBasis(left, normal, fwd);
    _q.setFromRotationMatrix(_m);
    // Altura: el punto más alto bajo el sello, para que no se hunda en los pliegues de la malla
    const hw = TRACK_WIDTH / 2;
    const hl = TRACK_LENGTH / 2;
    let y = groundAt(x, z);
    for (const [a, b] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl]]) {
      y = Math.max(y, groundAt(x + left.x * a + fwd.x * b, z + left.z * a + fwd.z * b));
    }
    _m.compose(new THREE.Vector3(x, y + 0.025, z), _q, _one);
    tracks.setMatrixAt(trackHead, _m);
    trackHead = (trackHead + 1) % TRACK_CAPACITY;
    tracks.count = Math.min(tracks.count + 1, TRACK_CAPACITY);
    tracks.instanceMatrix.needsUpdate = true;
  }

  // ---------- Física ligera ----------
  const prevWheel = wheels.map(() => null);
  const trackAcc = wheels.map(() => 0);
  const targetQuat = new THREE.Quaternion();
  let poseReady = false;

  function wheelWorld(w, out) {
    const s = Math.sin(state.heading);
    const c = Math.cos(state.heading);
    // izquierda = (cos, -sin); frente = (sin, cos)
    return out.set(group.position.x + w.x * c + w.z * s, 0, group.position.z - w.x * s + w.z * c);
  }

  function solveGround() {
    // Plano por mínimos cuadrados con las 6 ruedas, elevado hasta que ninguna se hunda
    let sumZ = 0;
    let sumH = 0;
    const hs = wheels.map((w) => {
      wheelWorld(w, _v);
      const h = groundAt(_v.x, _v.z);
      sumH += h;
      sumZ += w.z;
      return h;
    });
    const n = wheels.length;
    const meanH = sumH / n;
    const meanZ = sumZ / n;
    let sxx = 0;
    let sxh = 0;
    let szz = 0;
    let szh = 0;
    wheels.forEach((w, i) => {
      sxx += w.x * w.x;
      sxh += w.x * (hs[i] - meanH);
      szz += (w.z - meanZ) ** 2;
      szh += (w.z - meanZ) * (hs[i] - meanH);
    });
    const roll = sxx > 0 ? sxh / sxx : 0; // pendiente hacia la izquierda
    const pitch = szz > 0 ? szh / szz : 0; // pendiente hacia el frente
    let lift = -Infinity;
    wheels.forEach((w, i) => {
      lift = Math.max(lift, hs[i] - (meanH + pitch * (w.z - meanZ) + roll * w.x));
    });
    const y = meanH - pitch * meanZ + lift;

    const s = Math.sin(state.heading);
    const c = Math.cos(state.heading);
    const f = new THREE.Vector3(s, pitch, c);
    const l = new THREE.Vector3(c, roll, -s);
    const normal = new THREE.Vector3().crossVectors(f, l).normalize();
    f.set(s, 0, c);
    f.addScaledVector(normal, -f.dot(normal)).normalize();
    const left = new THREE.Vector3().crossVectors(normal, f);
    _m.makeBasis(left, normal, f);
    targetQuat.setFromRotationMatrix(_m);
    return y;
  }

  let frames = 0;
  function update(dt) {
    frames++;
    // Entrada
    const fwd = (pressed('KeyW', 'ArrowUp') ? 1 : 0) - (pressed('KeyS', 'ArrowDown') ? 1 : 0);
    const turn = (pressed('KeyA', 'ArrowLeft') ? 1 : 0) - (pressed('KeyD', 'ArrowRight') ? 1 : 0);
    const boost = pressed('ShiftLeft', 'ShiftRight') ? BOOST : 1;
    const target = fwd * MAX_SPEED * boost * (fwd < 0 ? REVERSE_FACTOR : 1);
    const rate = Math.abs(target) > Math.abs(state.speed) && Math.sign(target) === Math.sign(state.speed || target) ? ACCEL : BRAKE;
    state.speed += THREE.MathUtils.clamp(target - state.speed, -rate * dt, rate * dt);
    state.yawRate += (turn * TURN_RATE - state.yawRate) * (1 - Math.exp(-6 * dt));
    state.heading += state.yawRate * dt;

    // Avance
    const before = group.position.clone();
    group.position.x += Math.sin(state.heading) * state.speed * dt;
    group.position.z += Math.cos(state.heading) * state.speed * dt;

    // Rocas grandes: se empuja al rover fuera y se frena
    for (const o of obstacles) {
      const dx = group.position.x - o.x;
      const dz = group.position.z - o.z;
      const min = o.r + BODY_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        group.position.x = o.x + (dx / d) * min;
        group.position.z = o.z + (dz / d) * min;
        state.speed *= 0.5;
      }
    }
    // Límites del terreno
    const LIMIT = 380;
    group.position.x = THREE.MathUtils.clamp(group.position.x, -LIMIT, LIMIT);
    group.position.z = THREE.MathUtils.clamp(group.position.z, -LIMIT, LIMIT);
    state.distance += group.position.distanceTo(before);

    // Pose sobre el terreno (la suspensión suaviza)
    const y = solveGround();
    if (!poseReady) {
      group.position.y = y;
      group.quaternion.copy(targetQuat);
      poseReady = true;
    } else {
      const k = 1 - Math.exp(-12 * dt);
      group.position.y += (y - group.position.y) * k;
      group.quaternion.slerp(targetQuat, k);
    }
    group.updateMatrixWorld(true);

    // Huellas: cada rueda sella cada TRACK_SPACING metros recorridos
    wheels.forEach((w, i) => {
      const now = wheelWorld(w, new THREE.Vector3());
      const prev = prevWheel[i];
      prevWheel[i] = now;
      if (!prev) return;
      const dx = now.x - prev.x;
      const dz = now.z - prev.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) return;
      let acc = trackAcc[i] + len;
      while (acc >= TRACK_SPACING) {
        const t = (len - (acc - TRACK_SPACING)) / len; // sello dentro del tramo recorrido
        stampTrack(prev.x + dx * t, prev.z + dz * t, dx / len, dz / len);
        acc -= TRACK_SPACING;
      }
      trackAcc[i] = acc;
    });

    updateCamera(dt, fwd !== 0 || turn !== 0);  }

  // ---------- Cámara que sigue ----------
  const offset = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let dragging = false;
  let lastUserInput = -10;
  let clock = 0;
  controls.addEventListener('start', () => {
    dragging = true;
    lastUserInput = clock;
  });
  controls.addEventListener('end', () => {
    dragging = false;
    lastUserInput = clock;
  });

  function placeCameraBehind(dist = 9.5, height = 0.7) {
    const s = Math.sin(state.heading);
    const c = Math.cos(state.heading);
    focus.set(group.position.x, group.position.y + FOCUS_HEIGHT, group.position.z);
    camera.position.set(focus.x - s * dist, focus.y + height, focus.z - c * dist);
    controls.target.copy(focus);
    controls.update();
  }

  function updateCamera(dt, driving) {
    clock += dt;
    focus.set(group.position.x, group.position.y + FOCUS_HEIGHT, group.position.z);
    offset.copy(camera.position).sub(controls.target);

    // Mientras se conduce, la cámara se recoloca suavemente detrás del rover
    if (driving && !dragging && clock - lastUserInput > 2.0) {
      const want = state.heading + Math.PI; // dirección de rover → cámara
      const cur = Math.atan2(offset.x, offset.z);
      let diff = want - cur;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const a = cur + diff * (1 - Math.exp(-1.6 * dt));
      const r = Math.hypot(offset.x, offset.z);
      offset.x = Math.sin(a) * r;
      offset.z = Math.cos(a) * r;
    }

    controls.target.copy(focus);
    camera.position.copy(focus).add(offset);
    // La cámara no atraviesa el terreno
    const floor = groundAt(camera.position.x, camera.position.z) + 0.8;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  // ---------- API ----------
  const api = {
    group,
    cameras,
    cameraAnchors,
    setInputEnabled(enabled) {
      inputEnabled = enabled;
      keys.clear(); // al cerrar un visor no deben quedar flechas «pulsadas»
    },
    loaded,
    update,
    placeCameraBehind,
    get position() {
      return group.position;
    },
    get heading() {
      return state.heading;
    },
    get speed() {
      return state.speed;
    },
    state: () => ({
      x: group.position.x,
      y: group.position.y,
      z: group.position.z,
      heading: state.heading,
      speed: state.speed,
      distance: state.distance,
      tracks: tracks.count,
      keys: [...keys],
      frames,
    }),
    // Caja exacta del rover en el mundo (con huesos), para comprobar su tamaño real
    bounds: () => {
      const b = new THREE.Box3().setFromObject(group, true);
      const s = b.getSize(new THREE.Vector3());
      return { largo: s.z, ancho: s.x, alto: s.y };
    },
  };
  return api;
}

// ---------- Utilidades del modelo ----------
function measure(root) {
  // Caja de las mallas sin huesos (las de huesos distorsionan la medida)
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry) return;
    if (o.matrixWorld.determinant() === 0) return; // piezas con escala 0 (ocultas)
    o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(tmp);
  });
  return box;
}

function defaultWheels() {
  const x = 1.1;
  return [1.1, -0.1, -1.1].flatMap((z) => [
    { x, z },
    { x: -x, z },
  ]);
}

// Las 6 ruedas son una sola malla ("Wheels_objs"): se agrupan por huecos entre vértices.
function measureWheels(model) {
  const root = model.getObjectByName('Wheels_objs');
  if (!root) return null;
  // Se llama antes de añadir `model` al grupo: matrixWorld ya es el marco del rover
  model.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const pts = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pts.push([v.x, v.z]);
    }
  });
  if (!pts.length) return null;
  const result = [];
  for (const side of [1, -1]) {
    const part = pts.filter((q) => q[0] * side > 0.05).sort((a, b) => a[1] - b[1]);
    if (!part.length) return null;
    const total = part[part.length - 1][1] - part[0][1];
    const gap = total * 0.06;
    const clusters = [[part[0]]];
    for (let i = 1; i < part.length; i++) {
      if (part[i][1] - part[i - 1][1] > gap) clusters.push([]);
      clusters[clusters.length - 1].push(part[i]);
    }
    for (const c of clusters) {
      const zs = c.map((q) => q[1]);
      const xs = c.map((q) => q[0]);
      result.push({
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        z: (Math.min(...zs) + Math.max(...zs)) / 2,
      });
    }
  }
  return result.length === 6 ? result : null;
}

function prepareMaterials(model, envMap) {
  const seen = new Set();
  model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (seen.has(m)) continue;
      seen.add(m);
      // La transmisión obliga a renderizar toda la escena otra vez: se sustituye por transparencia simple
      if (m.transmission > 0) {
        m.transmission = 0;
        m.transparent = true;
        m.opacity = Math.min(m.opacity, 0.35);
        m.depthWrite = false;
      }
      // Solo el rover recibe reflejos del cielo; el terreno y las rocas no cambian
      m.envMap = envMap;
      m.envMapIntensity = 0.9;
    }
  });
}

function pathOf(o, root) {
  const names = [];
  for (let n = o.parent; n && n !== root; n = n.parent) if (n.name) names.unshift(n.name);
  return names.length ? names.join(' › ') : '(raíz)';
}

// Bandas en chevrón como la banda de rodadura de las ruedas de aluminio
function makeTreadTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 5;
  for (let y = -8; y < 72; y += 16) {
    g.beginPath();
    g.moveTo(4, y + 14);
    g.lineTo(32, y);
    g.lineTo(60, y + 14);
    g.stroke();
  }
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, 4, 64);
  g.fillRect(60, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
