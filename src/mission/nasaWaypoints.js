// Proveedor de telemetría: historial de manejos reales de Perseverance (NASA/JPL, MMGIS).
// Cada registro es un punto del recorrido; aquí solo se usan sol, distancia total, altura e inclinación.
// El servidor permite CORS, así que se lee en vivo; si no responde, se usa una copia local mínima.

const LIVE_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const SNAPSHOT_URL = '/data/m20_waypoints_snapshot.json';

// final: 'y' = fin de un manejo (trae la distancia acumulada), 'm' = localización a mitad de manejo,
// 'i' = punto interpolado. Las filas 'm' e 'i' traen dist_total_m = 0 como relleno, por eso la
// distancia sale solo de las 'y'. Altura e inclinación valen en las medidas ('y' y 'm').
const SERIES = {
  distance: { keep: (r) => r.final === 'y', pick: (r) => r.distM / 1000 },
  elevation: { keep: (r) => r.final !== 'i', pick: (r) => r.elevM },
  tilt: { keep: (r) => r.final !== 'i', pick: (r) => r.tilt },
};

let loading;
const load = () => (loading ??= fetchRows());

async function fetchRows() {
  try {
    const res = await fetch(LIVE_URL, { signal: AbortSignal.timeout(15000), cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = json.features.map(({ properties: p }) => ({
      sol: p.sol,
      final: p.final,
      distM: p.dist_total_m,
      elevM: p.elev_geoid,
      tilt: p.tilt,
    }));
    return { rows: clean(rows), source: 'live' };
  } catch (err) {
    console.warn(`[misión] NASA no respondió (${err.message}); uso la copia local del 15 oct 2026`);
    const snap = await (await fetch(SNAPSHOT_URL)).json();
    const rows = snap.rows.map(([sol, final, distM, elevM, tilt]) => ({ sol, final, distM, elevM, tilt }));
    return { rows: clean(rows), source: 'snapshot' };
  }
}

const clean = (rows) =>
  rows
    .filter((r) => [r.sol, r.distM, r.elevM, r.tilt].every(Number.isFinite))
    .sort((a, b) => a.sol - b.sol);

export const nasaWaypointsProvider = {
  name: 'NASA/JPL · M20 waypoints',
  source: 'cargando', // 'live' | 'snapshot' una vez cargado

  supportsRequest: (domainObject) => domainObject.identifier.key in SERIES,
  supportsSubscribe: (domainObject) => domainObject.identifier.key in SERIES,

  async request(domainObject) {
    const { keep, pick } = SERIES[domainObject.identifier.key];
    const { rows, source } = await load();
    this.source = source;
    return rows.filter(keep).map((r) => ({ sol: r.sol, value: pick(r) }));
  },

  // NASA publica un manejo nuevo cada pocos soles: no hay flujo continuo. Se entrega el último
  // dato publicado y la función de baja que exige el contrato.
  subscribe(domainObject, callback) {
    let active = true;
    this.request(domainObject).then((data) => {
      if (active && data.length) callback(data[data.length - 1]);
    });
    return () => {
      active = false;
    };
  },
};
