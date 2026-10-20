// Fotos reales del feed de imágenes crudas de Mars 2020 (mars.nasa.gov/rss/api). Nada se guarda en
// el repo: al hacer clic en una cámara se pide cada foto elegida (picks.js) a la API por su
// identificador, y la imagen se carga directamente desde los servidores de NASA.
//
// La API es lenta e intermitente: la primera consulta de una foto puede tardar 25 s o más (las
// repetidas, menos de 1 s por el caché) y a veces responde 403 o se corta. Por eso cada consulta
// espera con calma, reintenta y deja que el visor muestre un spinner mientras tanto.

const API = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&ver=1.2';
const ATTEMPTS = 3;
const TIMEOUT_MS = 90000;
const RETRY_WAIT_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPhotoJson(id) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${API}&id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const raw = (json.image ?? json.images)?.[0];
      if (!raw?.image_files?.large) throw new Error('la API no devolvió la foto');
      return raw;
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) await sleep(RETRY_WAIT_MS * attempt);
    }
  }
  throw new Error(`No se pudo obtener ${id} de la API de NASA (${lastError?.message ?? 'error'})`);
}

function toPhoto(raw, note) {
  const [w, h] = raw.extended.dimension.replace(/[()]/g, '').split(',').map(Number);
  return {
    id: raw.imageid,
    instrument: raw.camera.instrument,
    sol: raw.sol,
    ms: Date.parse(`${raw.date_taken_utc}Z`), // la API da la hora en UTC sin sufijo
    w,
    h,
    note,
    credit: raw.credit,
    page: raw.link,
    src: raw.image_files.large, // 1200 px
    full: raw.image_files.full_res, // PNG a máxima resolución
  };
}

/** Catálogo perezoso: `get(cámara, n)` devuelve una Promise con la foto n de esa cámara. */
export function createCatalog(picks) {
  const memo = new Map();
  const wrap = (i, count) => ((i % count) + count) % count;
  return {
    count: (camId) => picks[camId]?.length ?? 0,
    get(camId, index) {
      const list = picks[camId];
      const pick = list[wrap(index, list.length)];
      if (!memo.has(pick.id)) {
        const p = fetchPhotoJson(pick.id).then((raw) => toPhoto(raw, pick.note));
        p.catch(() => memo.delete(pick.id)); // si falla, el siguiente intento vuelve a pedirla
        memo.set(pick.id, p);
      }
      return memo.get(pick.id);
    },
  };
}

/** «hace 5 horas», «hace 1 día», «hace 6 días» a partir de la hora real de la toma. */
export function agoText(ms, now = Date.now()) {
  const hours = (now - ms) / 3600000;
  if (hours < 1) return 'hace menos de 1 hora';
  if (hours < 24) {
    const h = Math.floor(hours);
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.floor(hours / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
