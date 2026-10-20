// Posición aproximada de la Tierra y Marte con los elementos keplerianos de JPL
// ("Approximate Positions of the Planets", tabla 1, válida de 1800 a 2050).
// Sirve para saber a qué distancia están hoy sin llamar a ningún servicio.
// Cada elemento es [valor en J2000, cambio por siglo]; los ángulos van en grados.

const ELEMENTS = {
  earth: {
    // Baricentro Tierra-Luna (la diferencia con la Tierra es de ~0,015 s de luz)
    a: [1.00000261, 0.00000562],
    e: [0.01671123, -0.00004392],
    I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981],
    peri: [102.93768193, 0.32327364],
    node: [0.0, 0.0],
  },
  mars: {
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    peri: [-23.94362959, 0.44441088],
    node: [49.55953891, -0.29257343],
  },
};

const AU_LIGHT_SECONDS = 499.004784; // lo que tarda la luz en recorrer 1 UA
const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_CENTURY = 36525 * 86400000;

function heliocentric(el, T) {
  const at = (pair) => pair[0] + pair[1] * T;
  const a = at(el.a);
  const e = at(el.e);
  const I = at(el.I) * DEG;
  const peri = at(el.peri);
  const node = at(el.node) * DEG;
  // Anomalía media en (-180°, 180°] y ecuación de Kepler por Newton
  let M = (((at(el.L) - peri) % 360) + 540) % 360 - 180;
  M *= DEG;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = (peri - at(el.node)) * DEG; // argumento del perihelio
  const cw = Math.cos(w), sw = Math.sin(w);
  const cn = Math.cos(node), sn = Math.sin(node);
  const cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cn - sw * sn * cI) * xp + (-sw * cn - cw * sn * cI) * yp,
    (cw * sn + sw * cn * cI) * xp + (-sw * sn + cw * cn * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

/** Distancia Tierra–Marte en unidades astronómicas para una fecha (ms desde 1970). */
export function earthMarsAU(ms) {
  const T = (ms - J2000_MS) / MS_PER_CENTURY;
  const [ex, ey, ez] = heliocentric(ELEMENTS.earth, T);
  const [mx, my, mz] = heliocentric(ELEMENTS.mars, T);
  return Math.hypot(mx - ex, my - ey, mz - ez);
}

/** Minutos que tarda la luz (o una señal de radio) en ir entre la Tierra y Marte. */
export function lightTimeMinutes(ms) {
  return (earthMarsAU(ms) * AU_LIGHT_SECONDS) / 60;
}
