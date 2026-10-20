// El calendario de la misión se cuenta en soles (días marcianos). El sol 0 es el aterrizaje
// de Perseverance en el cráter Jezero: 18 de febrero de 2021, ~20:55 UTC.

export const LANDING_MS = Date.UTC(2021, 1, 18, 20, 55, 0);
export const SOL_MS = 88775244; // 24 h 39 min 35,244 s

export const solAt = (ms) => (ms - LANDING_MS) / SOL_MS;
export const dateAtSol = (sol) => new Date(LANDING_MS + sol * SOL_MS);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const shortDate = (date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
export const clockUTC = (date) => date.toISOString().slice(11, 19);
