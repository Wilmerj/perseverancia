// Puntos que brillan sobre las piezas-cámara del modelo 3D. Al pasar el mouse muestran el nombre;
// al hacer clic piden abrir la foto. Se detectan por distancia en pantalla (no por rayo), así se
// pueden tocar aunque la pieza quede tapada por el cuerpo del rover.

import * as THREE from 'three';
import { cameraLabel } from './cameras.js';

const HIT_RADIUS = 26; // px
const CLICK_SLOP = 6; // px: más movimiento que esto es un arrastre de la cámara, no un clic

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.16, 'rgba(255,238,215,1)');
  grad.addColorStop(0.34, 'rgba(255,176,104,0.6)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,214,170,1)';
  g.lineWidth = 4;
  g.shadowColor = 'rgba(255,160,90,1)';
  g.shadowBlur = 8;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export function createHotspots({ camera, canvas, rover, cameras, onOpen, blocked }) {
  const glow = glowTexture();
  const ring = ringTexture();
  const dots = [];

  for (const cam of cameras) {
    const anchor = rover.cameraAnchors[cam.piece];
    if (!anchor) {
      console.warn(`[fotos] no encontré la pieza ${cam.piece} en el modelo`);
      continue;
    }
    const holder = new THREE.Group();
    holder.position.copy(anchor);
    if (cam.offset) holder.position.add(new THREE.Vector3(...cam.offset));
    const make = (map, color) =>
      new THREE.Sprite(
        new THREE.SpriteMaterial({ map, color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }),
      );
    const core = make(glow, 0xffc890);
    const halo = make(ring, 0xffb070);
    core.renderOrder = halo.renderOrder = 20;
    holder.add(halo, core);
    rover.group.add(holder);
    dots.push({ cam, holder, core, halo, x: 0, y: 0, onScreen: false });
  }

  // ---------- Etiqueta con el nombre ----------
  const tip = document.createElement('div');
  tip.id = 'cam-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let hovered = null;

  function setHover(dot) {
    if (dot === hovered) return;
    hovered = dot;
    canvas.style.cursor = dot ? 'pointer' : '';
    if (!dot) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = `<b>${cameraLabel(dot.cam)}</b><code>${dot.cam.piece}</code><span>${dot.cam.about}</span><em>Clic: tomar una foto</em>`;
    tip.hidden = false;
  }

  function placeTip() {
    if (!hovered || tip.hidden) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = hovered.x + 20;
    let y = hovered.y - h / 2;
    if (x + w > window.innerWidth - 8) x = hovered.x - w - 20;
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ---------- Proyección a pantalla ----------
  const _p = new THREE.Vector3();
  function project(dot) {
    const rect = canvas.getBoundingClientRect();
    dot.holder.getWorldPosition(_p).project(camera);
    dot.x = rect.left + (_p.x * 0.5 + 0.5) * rect.width;
    dot.y = rect.top + (-_p.y * 0.5 + 0.5) * rect.height;
    dot.onScreen = _p.z < 1 && _p.x > -1 && _p.x < 1 && _p.y > -1 && _p.y < 1;
  }

  function pick(clientX, clientY) {
    let best = null;
    let bestD = HIT_RADIUS;
    for (const dot of dots) {
      camera.updateMatrixWorld();
      rover.group.updateMatrixWorld(true);
      project(dot);
      if (!dot.onScreen) continue;
      const d = Math.hypot(dot.x - clientX, dot.y - clientY);
      if (d < bestD) {
        best = dot;
        bestD = d;
      }
    }
    return best;
  }

  window.addEventListener('pointermove', (e) => {
    if (blocked() || e.target !== canvas) return setHover(null);
    setHover(pick(e.clientX, e.clientY));
    placeTip();
  });
  canvas.addEventListener('pointerleave', () => setHover(null));

  let down = null;
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('click', (e) => {
    if (blocked()) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return; // fue un arrastre
    const dot = pick(e.clientX, e.clientY);
    if (dot) {
      setHover(null);
      onOpen(dot.cam.id);
    }
  });

  // ---------- Animación: núcleo que late y anillo que se expande ----------
  function update(timeSec) {
    const hide = blocked();
    dots.forEach((dot, i) => {
      dot.holder.visible = !hide;
      if (hide) return;
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 2.6 + i * 1.7);
      const big = dot === hovered ? 1.35 : 1;
      dot.core.scale.setScalar((0.044 + 0.007 * pulse) * big);
      const phase = (timeSec * 0.55 + i * 0.27) % 1;
      dot.halo.scale.setScalar(0.034 + phase * 0.07);
      dot.halo.material.opacity = Math.pow(1 - phase, 1.5) * 0.9;
      project(dot);
    });
    placeTip();
  }

  return {
    update,
    /** Posición en pantalla de cada punto (para `npm run check`). */
    dotScreen(id) {
      const dot = dots.find((d) => d.cam.id === id);
      if (!dot) return null;
      camera.updateMatrixWorld();
      rover.group.updateMatrixWorld(true);
      project(dot);
      return { x: dot.x, y: dot.y, onScreen: dot.onScreen };
    },
    state: () => ({
      dots: dots.map((d) => d.cam.id),
      hovered: hovered?.cam.id ?? null,
      tip: tip.hidden ? null : tip.textContent,
    }),
  };
}
