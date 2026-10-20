// Visor de fotos: obturador y flash, spinner mientras la foto llega desde la API de NASA, revelado
// poco a poco (como un dato que baja línea a línea), pausa de unos segundos con la foto grande y,
// si no se toca nada, vuelve solo al juego.
//   clic en la foto → ampliar (y cargar la versión de máxima resolución de NASA) · otro clic → reducir
//   ← → → más fotos de esa cámara · Esc → volver al juego
// Mientras está abierto, el rover no recibe teclas.

import { CAMERAS, cameraLabel } from './cameras.js';
import { agoText } from './catalog.js';

const HOLD_MS = 7000; // pausa con la foto revelada antes de volver solo al juego
const REVEAL_FIRST_MS = 3200;
const REVEAL_NEXT_MS = 1800;

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createViewer({ catalog, rover }) {
  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <div id="shutter" aria-hidden="true"><i class="blade top"></i><i class="blade bottom"></i><i class="flash"></i></div>
    <div id="photo" role="dialog" aria-modal="true" aria-label="Foto de Marte" tabindex="-1" hidden>
      <div class="ph-shade"></div>
      <figure class="ph-frame">
        <div class="ph-stage">
          <img class="ph-base" alt="" draggable="false">
          <img class="ph-sharp" alt="" draggable="false">
          <i class="ph-scan"></i>
          <div class="ph-loading" role="status" hidden>
            <i class="ph-spinner" aria-hidden="true"></i>
            <p>Recibiendo la foto desde Marte…</p>
            <small class="ph-wait"></small>
          </div>
          <div class="ph-error" role="alert" hidden>
            <p class="ph-error-text">No se pudo cargar esta foto.</p>
            <button class="ph-retry" type="button">Reintentar</button>
          </div>
          <i class="ph-timer"></i>
        </div>
        <figcaption>
          <div class="ph-line"><strong class="ph-cam"></strong><span class="ph-sol"></span><span class="ph-ago"></span></div>
          <p class="ph-note"></p>
          <p class="ph-meta"><span class="ph-count"></span><span class="ph-credit"></span></p>
        </figcaption>
      </figure>
      <button class="ph-nav prev" type="button" aria-label="Foto anterior">‹</button>
      <button class="ph-nav next" type="button" aria-label="Foto siguiente">›</button>
      <button class="ph-close" type="button" aria-label="Volver al juego">Esc</button>
      <p class="ph-hint"><kbd>clic</kbd> ampliar · <kbd>←</kbd> <kbd>→</kbd> más fotos · <kbd>Esc</kbd> volver al juego</p>
    </div>`,
  );
  const $ = (sel) => document.querySelector(sel);
  const shutterEl = $('#shutter');
  const root = $('#photo');
  const frame = $('#photo .ph-frame');
  const stage = $('#photo .ph-stage');
  const baseImg = $('#photo .ph-base');
  const sharpImg = $('#photo .ph-sharp');
  const scanEl = $('#photo .ph-scan');
  const loadingEl = $('#photo .ph-loading');
  const waitEl = $('#photo .ph-wait');
  const errorEl = $('#photo .ph-error');
  const errorText = $('#photo .ph-error-text');
  const timerEl = $('#photo .ph-timer');
  const el = {
    cam: $('#photo .ph-cam'), sol: $('#photo .ph-sol'), ago: $('#photo .ph-ago'),
    note: $('#photo .ph-note'), count: $('#photo .ph-count'), credit: $('#photo .ph-credit'),
  };

  const st = { open: false, camId: null, index: 0, mode: 'preview', revealed: false, pinned: false, hires: false, loading: false, error: null };
  let seq = 0; // invalida revelados, esperas y temporizadores de una foto anterior
  let anims = [];
  let closeTimer = null;
  let waitTimer = null;
  const images = new Map();

  // ---------- Carga de imágenes (directo desde los servidores de NASA) ----------
  function preload(src) {
    if (!images.has(src)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      const p = img.decode().then(() => img);
      p.catch(() => images.delete(src));
      images.set(src, p);
    }
    return images.get(src);
  }
  /** Pide en segundo plano los datos y la imagen de una foto para que luego abra enseguida. */
  function warm(camId, index) {
    catalog
      .get(camId, index)
      .then((photo) => preload(photo.src))
      .catch(() => {});
  }

  // ---------- Obturador, flash y sonido ----------
  let audio;
  function shutterSound() {
    try {
      audio ??= new AudioContext();
      audio.resume?.();
      const t = audio.currentTime;
      const burst = (at, dur, freq, vol) => {
        const buf = audio.createBuffer(1, Math.ceil(audio.sampleRate * dur), audio.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
        const src = audio.createBufferSource();
        src.buffer = buf;
        const filter = audio.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        const gain = audio.createGain();
        gain.gain.value = vol;
        src.connect(filter).connect(gain).connect(audio.destination);
        src.start(t + at);
      };
      burst(0, 0.045, 2600, 0.5); // clic de las cortinillas
      burst(0.075, 0.06, 1500, 0.4);
    } catch {
      /* sin audio: el obturador sigue siendo visual */
    }
  }

  function shutter() {
    shutterSound();
    const flash = shutterEl.querySelector('.flash');
    const blades = shutterEl.querySelectorAll('.blade');
    if (reduceMotion()) {
      flash.animate([{ opacity: 0 }, { opacity: 0.6, offset: 0.3 }, { opacity: 0 }], { duration: 400 });
      return;
    }
    blades[0].animate(
      [{ transform: 'translateY(-101%)' }, { transform: 'translateY(0)', offset: 0.22 }, { transform: 'translateY(0)', offset: 0.34 }, { transform: 'translateY(-101%)' }],
      { duration: 520, easing: 'ease-in-out' },
    );
    blades[1].animate(
      [{ transform: 'translateY(101%)' }, { transform: 'translateY(0)', offset: 0.22 }, { transform: 'translateY(0)', offset: 0.34 }, { transform: 'translateY(101%)' }],
      { duration: 520, easing: 'ease-in-out' },
    );
    flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0 }], { duration: 760, easing: 'ease-out' });
  }

  // ---------- Espera: spinner con los segundos transcurridos ----------
  function setLoading(on) {
    st.loading = on;
    loadingEl.hidden = !on;
    clearInterval(waitTimer);
    if (on) {
      const t0 = performance.now();
      waitEl.textContent = '';
      waitTimer = setInterval(() => {
        const s = Math.floor((performance.now() - t0) / 1000);
        waitEl.textContent = s >= 3 ? `${s} s · la API de NASA a veces tarda` : '';
      }, 500);
    }
  }

  // ---------- Revelado ----------
  const stopAnims = () => {
    anims.forEach((a) => a.cancel());
    anims = [];
    clearTimeout(closeTimer);
    timerEl.getAnimations().forEach((a) => a.cancel());
  };

  async function showPhoto(index, { first = false } = {}) {
    const count = catalog.count(st.camId);
    st.index = ((index % count) + count) % count;
    const cam = CAMERAS.find((c) => c.id === st.camId);
    const mine = ++seq;
    stopAnims();
    Object.assign(st, { revealed: false, hires: false, error: null });
    errorEl.hidden = true;
    frame.classList.remove('is-revealed');
    sharpImg.style.clipPath = 'inset(0 0 100% 0)';
    scanEl.style.opacity = '0';
    baseImg.removeAttribute('src');
    sharpImg.removeAttribute('src');

    // Mientras llega: se ve la cámara y el spinner
    el.cam.textContent = cameraLabel(cam);
    el.sol.textContent = '';
    el.ago.textContent = '';
    el.note.textContent = 'Pidiendo la foto a la API de NASA…';
    el.count.textContent = `${st.index + 1} / ${count}`;
    el.credit.textContent = '';
    setLoading(true);

    let photo;
    try {
      photo = await catalog.get(st.camId, st.index);
      if (mine !== seq) return;
      stage.style.setProperty('--ar', String(photo.w / photo.h));
      // Las fotos crudas de Mastcam-Z traen una franja negra del sensor en los bordes: se recorta ~1,5 %
      stage.style.setProperty('--zoom', photo.instrument.startsWith('MCZ') ? '1.03' : '1');
      el.sol.textContent = `Sol ${photo.sol}`;
      el.ago.textContent = agoText(photo.ms);
      el.note.textContent = photo.note;
      el.credit.textContent = photo.credit;
      await preload(photo.src);
    } catch (err) {
      if (mine !== seq) return;
      console.error('[fotos]', err);
      setLoading(false);
      st.error = String(err.message ?? err);
      errorText.textContent = 'No llegó la foto desde la API de NASA.';
      el.note.textContent = '';
      errorEl.hidden = false;
      return;
    }
    if (mine !== seq) return;
    setLoading(false);
    baseImg.src = sharpImg.src = photo.src;
    warm(st.camId, st.index + 1);
    warm(st.camId, st.index - 1);

    const ms = reduceMotion() ? 500 : first ? REVEAL_FIRST_MS : REVEAL_NEXT_MS;
    const ease = 'cubic-bezier(.35,.05,.25,1)';
    if (reduceMotion()) {
      sharpImg.style.clipPath = 'inset(0)';
      anims.push(sharpImg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms }));
    } else {
      // La imagen nítida baja de arriba abajo sobre una versión borrosa y apagada de la misma foto
      anims.push(sharpImg.animate([{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)' }], { duration: ms, easing: ease, fill: 'forwards' }));
      anims.push(scanEl.animate([{ top: '0%', opacity: 1 }, { top: '100%', opacity: 1, offset: 0.97 }, { top: '100%', opacity: 0 }], { duration: ms, easing: ease, fill: 'forwards' }));
      anims.push(baseImg.animate([{ filter: 'blur(22px) saturate(0.35) brightness(0.5)' }, { filter: 'blur(14px) saturate(0.7) brightness(0.8)' }], { duration: ms, fill: 'forwards' }));
    }
    try {
      await Promise.all(anims.map((a) => a.finished));
    } catch {
      return; // cancelado por otra foto o por cerrar
    }
    if (mine !== seq) return;
    sharpImg.style.clipPath = 'inset(0)';
    scanEl.style.opacity = '0';
    frame.classList.add('is-revealed');
    st.revealed = true;
    if (st.mode === 'enlarged') upgradeToFull(photo, mine);
    if (!st.pinned) startHold(mine);
  }

  // En modo ampliado se cambia a la versión de máxima resolución (PNG de NASA, ~1 MB)
  async function upgradeToFull(photo, mine) {
    if (!photo.full || st.hires) return;
    try {
      const big = await preload(photo.full);
      if (mine === seq && st.mode === 'enlarged') {
        baseImg.src = sharpImg.src = big.src;
        st.hires = true;
      }
    } catch {
      /* se queda con la de 1200 px */
    }
  }

  // ---------- Pausa y regreso automático ----------
  function startHold(mine) {
    const bar = timerEl.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: HOLD_MS, easing: 'linear', fill: 'forwards' });
    anims.push(bar);
    closeTimer = setTimeout(() => {
      if (mine === seq && !st.pinned) close();
    }, HOLD_MS);
  }
  function pin() {
    if (st.pinned) return;
    st.pinned = true;
    clearTimeout(closeTimer);
    timerEl.getAnimations().forEach((a) => a.cancel());
    timerEl.style.transform = 'scaleX(0)';
    root.classList.add('is-pinned');
  }

  // ---------- Abrir, cambiar, ampliar y cerrar ----------
  function open(camId) {
    if (st.open || !catalog.count(camId)) return false;
    Object.assign(st, { open: true, camId, index: 0, mode: 'preview', pinned: false, revealed: false, error: null });
    rover.setInputEnabled(false);
    root.classList.remove('is-big', 'is-pinned');
    shutter();
    // El visor aparece justo cuando el flash está en su punto más blanco; si la foto aún no llegó, muestra el spinner
    setTimeout(() => {
      if (!st.open) return;
      root.hidden = false;
      root.classList.remove('is-leaving');
      root.focus({ preventScroll: true });
      showPhoto(0, { first: true });
    }, reduceMotion() ? 0 : 150);
    return true;
  }

  function step(delta) {
    if (!st.open) return;
    pin();
    showPhoto(st.index + delta);
  }

  function toggleBig() {
    if (!st.open || st.loading || st.error) return;
    pin();
    st.mode = st.mode === 'enlarged' ? 'preview' : 'enlarged';
    root.classList.toggle('is-big', st.mode === 'enlarged');
    if (st.mode === 'enlarged' && st.revealed) {
      catalog.get(st.camId, st.index).then((photo) => upgradeToFull(photo, seq));
    }
  }

  function close() {
    if (!st.open) return;
    st.open = false;
    seq++;
    stopAnims();
    setLoading(false);
    root.classList.add('is-leaving');
    setTimeout(() => {
      if (st.open) return;
      root.hidden = true;
      root.classList.remove('is-leaving', 'is-big', 'is-pinned');
    }, 220);
    rover.setInputEnabled(true);
  }

  // ---------- Entrada ----------
  window.addEventListener(
    'keydown',
    (e) => {
      if (!st.open) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        step(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
      }
    },
    true,
  );
  stage.addEventListener('click', toggleBig);
  $('#photo .ph-retry').addEventListener('click', (e) => {
    e.stopPropagation();
    showPhoto(st.index, { first: true });
  });
  $('#photo .ph-nav.prev').addEventListener('click', () => step(-1));
  $('#photo .ph-nav.next').addEventListener('click', () => step(1));
  $('#photo .ph-close').addEventListener('click', close);
  $('#photo .ph-shade').addEventListener('click', close);

  return {
    open,
    close,
    warm,
    isOpen: () => st.open,
    state: () => ({
      open: st.open,
      camera: st.camId,
      index: st.index,
      total: st.camId ? catalog.count(st.camId) : 0,
      mode: st.mode,
      loading: st.loading,
      error: st.error,
      revealed: st.revealed,
      pinned: st.pinned,
      hires: st.hires,
      label: el.cam.textContent,
      sol: el.sol.textContent,
      ago: el.ago.textContent,
      note: el.note.textContent,
      credit: el.credit.textContent,
      src: sharpImg.currentSrc || sharpImg.src,
      naturalWidth: sharpImg.naturalWidth,
      naturalHeight: sharpImg.naturalHeight,
      shown: !root.hidden,
      spinnerVisible: !loadingEl.hidden,
    }),
  };
}
