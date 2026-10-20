// Los 4 datos del control de misión, descritos como objetos de dominio de Open MCT:
// identificador, nombre y telemetry.values (key, nombre, unidad, hints domain/range).
// `explain` es la frase simple que dice qué significa el valor.

export const num = (n, digits = 1) =>
  n.toLocaleString('es', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace('-', '−');

const SOL = { key: 'sol', name: 'Sol (día marciano de la misión)', hints: { domain: 1 } };
const MARATHON_KM = 42.195;

export const OBJECTS = [
  {
    identifier: { namespace: 'percy', key: 'distance' },
    name: 'Distancia recorrida',
    type: 'percy.telemetry',
    telemetry: { values: [SOL, { key: 'value', name: 'Distancia recorrida', unit: 'km', digits: 1, hints: { range: 1 } }] },
    chart: { fromZero: true },
    explain: ({ latest }) =>
      `Es todo lo que Percy ha rodado desde que aterrizó: ${num(latest.value / MARATHON_KM, 1)} maratones. ` +
      `Cada punto de la gráfica es el final de un manejo.`,
  },
  {
    identifier: { namespace: 'percy', key: 'elevation' },
    name: 'Altura del terreno',
    type: 'percy.telemetry',
    telemetry: { values: [SOL, { key: 'value', name: 'Altura sobre el nivel de referencia', unit: 'm', digits: 0, hints: { range: 1 } }] },
    explain: ({ latest, history }) => {
      const climbed = latest.value - history[0].value;
      return (
        `Se mide contra el «nivel del mar» de Marte, una referencia matemática: allí no hay mar. ` +
        `Percy empezó en ${num(history[0].value, 0)} m, en el fondo del cráter Jezero, y ya subió ${num(climbed, 0)} m.`
      );
    },
  },
  {
    identifier: { namespace: 'percy', key: 'tilt' },
    name: 'Inclinación',
    type: 'percy.telemetry',
    telemetry: { values: [SOL, { key: 'value', name: 'Inclinación total del rover', unit: '°', digits: 1, hints: { range: 1 } }] },
    chart: { fromZero: true },
    explain: ({ latest, history }) => {
      const peak = history.reduce((a, b) => (b.value > a.value ? b : a));
      const grade = Math.tan((peak.value * Math.PI) / 180) * 100;
      return (
        `Cuánto se ladea el rover en total; 0° es suelo plano. Su récord fue ${num(peak.value, 1)}° en el sol ${peak.sol}, ` +
        `una rampa del ${num(grade, 0)} %.`
      );
    },
  },
  {
    identifier: { namespace: 'percy', key: 'lighttime' },
    name: 'Luz Tierra ↔ Marte',
    type: 'percy.telemetry',
    telemetry: { values: [SOL, { key: 'value', name: 'Tiempo de luz en un sentido', unit: 'min', digits: 2, hints: { range: 1 } }] },
    explain: ({ latest }) => {
      const s = Math.round(latest.value * 60);
      const at = (secs) => `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`;
      return (
        `Una orden enviada ahora tarda ${at(s)} en llegar a Percy, y su respuesta otro tanto (${at(2 * s)} ida y vuelta). ` +
        `Por eso maneja casi sola.`
      );
    },
  },
];
