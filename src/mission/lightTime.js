// Proveedor de telemetría: tiempo que tarda una señal en ir entre la Tierra y Marte, calculado
// en vivo con la hora del equipo. La efeméride (orbit.js) se contrastó con JPL Horizons en 5 fechas
// (aterrizaje, oposición 2022, conjunción 2023, 2024 y 2026): diferencia máxima de 0,1 s.

import { lightTimeMinutes } from './orbit.js';
import { LANDING_MS, SOL_MS, solAt } from './mars-time.js';

const HISTORY_STEP_SOLS = 4;

const datum = (ms) => ({ sol: solAt(ms), utc: ms, value: lightTimeMinutes(ms) });

export const lightTimeProvider = {
  name: 'Cálculo en vivo · órbitas JPL',
  source: 'calculado',

  supportsRequest: (domainObject) => domainObject.identifier.key === 'lighttime',
  supportsSubscribe: (domainObject) => domainObject.identifier.key === 'lighttime',

  // Toda la misión: un punto cada 4 soles desde el aterrizaje hasta ahora
  request() {
    const now = Date.now();
    const data = [];
    for (let ms = LANDING_MS; ms < now; ms += HISTORY_STEP_SOLS * SOL_MS) data.push(datum(ms));
    data.push(datum(now));
    return Promise.resolve(data);
  },

  // Un dato nuevo cada segundo
  subscribe(domainObject, callback) {
    callback(datum(Date.now()));
    const timer = setInterval(() => callback(datum(Date.now())), 1000);
    return () => clearInterval(timer);
  },
};
