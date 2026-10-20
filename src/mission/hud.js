// Panel «Control de misión» dentro del juego. Pide cada dato a MissionTelemetry (historial con
// request, valor actual con subscribe) y lo muestra con nombre, unidad, proveedor, gráfica de
// toda la misión y una frase que explica qué significa. La tecla T lo oculta o lo muestra.

import { num } from './dictionary.js';
import { clockUTC, dateAtSol, shortDate, solAt } from './mars-time.js';

const COLORS = { line: '#ffb27a', fill: 'rgba(255, 150, 80, 0.22)', grid: 'rgba(255, 220, 190, 0.12)', text: 'rgba(243, 217, 189, 0.7)', now: '#ffe1c2' };

export function createHud({ telemetry, objects }) {
  const root = document.createElement('aside');
  root.id = 'mission';
  root.setAttribute('aria-label', 'Control de misión');
  root.innerHTML = `
    <header class="m-head">
      <div><h2>Control de misión</h2><p class="m-sub">Cráter Jezero · datos reales</p></div>
      <div class="m-clock"><span class="m-sol">SOL —</span><span class="m-utc"></span></div>
    </header>
    <div class="m-cards"></div>
    <footer class="m-foot"><kbd>T</kbd> ocultar · cada dato: nombre, unidad, proveedor</footer>`;
  document.body.append(root);
  const cardsEl = root.querySelector('.m-cards');
  const solEl = root.querySelector('.m-sol');
  const utcEl = root.querySelector('.m-utc');

  const cards = objects.map((obj) => makeCard(obj));
  let remaining = cards.length;

  function makeCard(obj) {
    const metadata = telemetry.getMetadata(obj);
    const range = metadata.valuesForHints(['range'])[0];
    const provider = telemetry.providerFor(obj);
    const el = document.createElement('article');
    el.className = 'm-card';
    el.dataset.id = obj.identifier.key;
    el.innerHTML = `
      <header><h3>${obj.name}</h3><span class="m-prov"></span></header>
      <div class="m-row">
        <div class="m-value"><b>—</b><span class="m-unit">${range.unit}</span></div>
        <div class="m-chart"><canvas></canvas><span class="m-readout" aria-hidden="true"></span></div>
      </div>
      <p class="m-meaning">Cargando…</p>
      <footer><span class="m-stamp"></span></footer>`;
    cardsEl.append(el);
    const card = {
      obj, el, range, provider, history: [], latest: null, hover: null, updates: 0, loaded: false,
      canvas: el.querySelector('canvas'),
      valueEl: el.querySelector('.m-value b'),
      meaningEl: el.querySelector('.m-meaning'),
      stampEl: el.querySelector('.m-stamp'),
      readoutEl: el.querySelector('.m-readout'),
      provEl: el.querySelector('.m-prov'),
    };
    card.provEl.textContent = provider.name;
    wireHover(card);

    telemetry
      .request(obj)
      .then((history) => {
        card.history = history;
        card.loaded = true;
      })
      .catch((err) => {
        card.meaningEl.textContent = 'No se pudo cargar este dato.';
        console.error(`[misión] ${obj.name}:`, err);
      })
      .finally(() => {
        refreshProvider(card);
        if (card.latest) render(card); // el valor actual pudo llegar antes que el historial
        else draw(card);
        if (--remaining === 0) window.__missionReady = true;
      });
    telemetry.subscribe(obj, (datum) => {
      card.latest = datum;
      card.updates++;
      render(card);
    });
    return card;
  }

  function refreshProvider(card) {
    const note = { live: 'en vivo', snapshot: 'copia local' }[card.provider.source];
    card.provEl.textContent = note ? `${card.provider.name} · ${note}` : card.provider.name;
    card.provEl.classList.toggle('is-stale', card.provider.source === 'snapshot');
  }

  function render(card) {
    const { latest, range } = card;
    if (!latest) return;
    card.valueEl.textContent = num(latest.value, range.digits);
    if (card.loaded && card.history.length) card.meaningEl.textContent = card.obj.explain({ latest, history: card.history });
    card.stampEl.textContent = latest.utc
      ? `ahora · ${clockUTC(new Date(latest.utc))} UTC`
      : `último dato: sol ${latest.sol} · ${shortDate(dateAtSol(latest.sol))}`;
    refreshProvider(card);
    draw(card);
  }

  // ---------- Gráfica de toda la misión ----------
  const nowSol = () => solAt(Date.now());

  function geometry(card, w, h) {
    const pad = { l: 30, r: 5, t: 7, b: 13 }; // l: margen para los valores del eje Y
    const values = card.history.map((d) => d.value);
    const dataHi = Math.max(...values);
    const dataLo = card.obj.chart?.fromZero ? Math.min(0, ...values) : Math.min(...values);
    // Las líneas de la cuadrícula marcan el mínimo y el máximo reales; el dibujo deja un margen alrededor
    const margin = (dataHi - dataLo || 1) * 0.1;
    const hi = dataHi + margin;
    const lo = dataLo - margin;
    const xMax = Math.max(nowSol(), card.history.at(-1)?.sol ?? 1);
    return {
      pad, lo, hi, dataLo, dataHi, xMax,
      x: (sol) => pad.l + (sol / xMax) * (w - pad.l - pad.r),
      y: (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b),
      solAtX: (px) => ((px - pad.l) / (w - pad.l - pad.r)) * xMax,
    };
  }

  function draw(card) {
    const { canvas, history, latest, range } = card;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // panel oculto: se redibuja al mostrarlo
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;
    const g = geometry(card, w, h);

    // Cuadrícula en el máximo y el mínimo reales, con su valor en el margen izquierdo
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = COLORS.text;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of [g.dataHi, g.dataLo]) {
      const yy = Math.round(g.y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(g.pad.l, yy); ctx.lineTo(w - g.pad.r, yy); ctx.stroke();
      ctx.fillText(num(v, range.digits), g.pad.l - 4, yy);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('sol 0', g.pad.l, h - 2);
    ctx.textAlign = 'right';
    ctx.fillText(`sol ${Math.round(g.xMax)}`, w - g.pad.r, h - 2);

    // Área y línea
    ctx.beginPath();
    history.forEach((d, i) => (i ? ctx.lineTo(g.x(d.sol), g.y(d.value)) : ctx.moveTo(g.x(d.sol), g.y(d.value))));
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo(g.x(history.at(-1).sol), h - g.pad.b);
    ctx.lineTo(g.x(history[0].sol), h - g.pad.b);
    ctx.closePath();
    ctx.fillStyle = COLORS.fill;
    ctx.fill();

    // Dato actual
    if (latest) {
      const px = g.x(latest.sol);
      const py = g.y(latest.value);
      ctx.strokeStyle = COLORS.now;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(px, g.pad.t); ctx.lineTo(px, h - g.pad.b); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.now;
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Cursor
    if (card.hover) {
      const px = g.x(card.hover.sol);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.moveTo(px, g.pad.t); ctx.lineTo(px, h - g.pad.b); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px, g.y(card.hover.value), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function wireHover(card) {
    const { canvas, readoutEl } = card;
    canvas.addEventListener('pointermove', (e) => {
      if (card.history.length < 2) return;
      const rect = canvas.getBoundingClientRect();
      const g = geometry(card, rect.width, rect.height);
      const sol = g.solAtX(e.clientX - rect.left);
      // Datum más cercano por búsqueda binaria (el historial viene ordenado por sol)
      let a = 0, b = card.history.length - 1;
      while (b - a > 1) {
        const mid = (a + b) >> 1;
        if (card.history[mid].sol < sol) a = mid; else b = mid;
      }
      const near = Math.abs(card.history[a].sol - sol) < Math.abs(card.history[b].sol - sol) ? card.history[a] : card.history[b];
      card.hover = near;
      readoutEl.textContent = `sol ${Math.round(near.sol)} · ${num(near.value, card.range.digits)} ${card.range.unit}`;
      readoutEl.hidden = false;
      draw(card);
    });
    canvas.addEventListener('pointerleave', () => {
      card.hover = null;
      readoutEl.hidden = true;
      draw(card);
    });
    readoutEl.hidden = true;
  }

  // ---------- Reloj de la misión y tecla T ----------
  const tick = () => {
    const now = new Date();
    solEl.textContent = `SOL ${Math.floor(nowSol())}`;
    utcEl.textContent = `${shortDate(now)} · ${clockUTC(now)} UTC`;
  };
  tick();
  setInterval(tick, 1000);

  const redrawAll = () => cards.forEach(draw);
  window.addEventListener('resize', redrawAll);

  function toggle(force) {
    root.hidden = force ?? !root.hidden;
    if (!root.hidden) requestAnimationFrame(redrawAll);
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) toggle();
  });

  return {
    toggle,
    // Estado para depuración y para `npm run check`
    state: () => ({
      visible: !root.hidden,
      sol: nowSol(),
      objects: cards.map((c) => ({
        id: c.obj.identifier.key,
        name: c.obj.name,
        unit: c.range.unit,
        provider: c.provider.name,
        source: c.provider.source,
        loaded: c.loaded,
        value: c.latest?.value ?? null,
        sol: c.latest?.sol ?? null,
        utc: c.latest?.utc ?? null,
        points: c.history.length,
        updates: c.updates,
        meaning: c.meaningEl.textContent,
      })),
    }),
  };
}
