// npm run check: abre la escena en Chrome headless (el Chrome instalado, sin descargar
// navegadores), guarda capturas, lista los errores de consola y confirma que:
//   · el rover se maneja con teclas reales y deja huellas;
//   · los 4 datos del control de misión cargaron con números reales (contrastados con el JSON de
//     NASA y con la misma efeméride calculada aparte) y la tecla T oculta el panel.
import { chromium } from 'playwright-core';
import { lightTimeMinutes } from '../src/mission/orbit.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.CHECK_URL ?? 'http://localhost:5173/';
const SHOT = path.join(ROOT, 'check', 'screenshot.png');
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

async function isUp() {
  try {
    return (await fetch(URL)).ok;
  } catch {
    return false;
  }
}

// Si el servidor de desarrollo no está corriendo, levanta uno temporal
let devServer = null;
if (!(await isUp())) {
  console.log('Servidor no encontrado, levantando Vite temporal…');
  devServer = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
}

const executablePath = CHROME_PATHS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No encontré Chrome. Define CHROME_PATH.');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const problems = [];
const logs = [];
// Avisos de rendimiento del driver GL por software (los provoca la propia captura), no de la app
const IGNORED = [/GL Driver Message .*Performance/];
page.on('console', (msg) => {
  if ((msg.type() === 'error' || msg.type() === 'warning') && !IGNORED.some((re) => re.test(msg.text()))) {
    problems.push(`[console.${msg.type()}] ${msg.text()}`);
  } else if (msg.type() === 'log') {
    logs.push(msg.text());
  }
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`));

const roverState = () => page.evaluate(() => window.__rover?.state());
const missionState = () => page.evaluate(() => window.__mission?.state());
const SHOT_DRIVE = path.join(ROOT, 'check', 'screenshot-drive.png');
const SHOT_HIDDEN = path.join(ROOT, 'check', 'screenshot-hud-hidden.png');
let drive = null;
let missionReport = [];

// Valores que NASA publica hoy, calculados aparte con el JSON crudo (sin pasar por el código del juego)
const NASA_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
async function nasaExpected() {
  const json = await (await fetch(NASA_URL, { signal: AbortSignal.timeout(30000) })).json();
  const rows = json.features.map((f) => f.properties).sort((a, b) => a.sol - b.sol);
  const lastEnd = rows.filter((r) => r.final === 'y').at(-1);
  const lastMeasured = rows.filter((r) => r.final !== 'i').at(-1);
  return {
    distance: lastEnd.dist_total_m / 1000,
    elevation: lastMeasured.elev_geoid,
    tilt: lastMeasured.tilt,
    sol: lastMeasured.sol,
  };
}

// Rango físico razonable de cada dato (si algo sale de aquí, el dato no es real)
const PLAUSIBLE = { distance: [0.5, 500, 'km'], elevation: [-3000, -1000, 'm'], tilt: [0, 45, '°'], lighttime: [3, 23, 'min'] };

async function checkMission() {
  const lines = [];
  const fail = (msg) => problems.push(`[misión] ${msg}`);
  const st = await missionState();
  if (!st) return fail('window.__mission no existe: el control de misión no arrancó');
  if (st.objects.length !== 4) fail(`se esperaban 4 datos y hay ${st.objects.length}`);
  const expected = await nasaExpected().catch((err) => (fail(`no pude leer el JSON de NASA desde Node: ${err.message}`), null));

  for (const o of st.objects) {
    const [lo, hi] = PLAUSIBLE[o.id] ?? [-Infinity, Infinity];
    const notes = [];
    if (!o.loaded) fail(`${o.name}: el historial no cargó`);
    if (!Number.isFinite(o.value)) fail(`${o.name}: sin valor numérico (${o.value})`);
    else if (o.value < lo || o.value > hi) fail(`${o.name}: ${o.value} ${o.unit} fuera del rango físico [${lo}, ${hi}]`);
    if (o.points < 50) fail(`${o.name}: la gráfica de la misión tiene solo ${o.points} puntos`);
    if (!o.meaning || /Cargando|No se pudo/.test(o.meaning)) fail(`${o.name}: sin frase de significado ("${o.meaning}")`);

    if (o.id === 'lighttime') {
      // El valor de la página debe coincidir con la misma efeméride calculada aquí para esa hora
      const mine = lightTimeMinutes(o.utc);
      if (Math.abs(mine - o.value) > 0.005) fail(`${o.name}: la página dice ${o.value} y el cálculo aparte ${mine}`);
      await page.waitForTimeout(2200);
      const later = (await missionState()).objects.find((x) => x.id === 'lighttime');
      if (later.updates <= o.updates) fail(`${o.name}: no se actualiza en vivo (${o.updates} → ${later.updates})`);
      else notes.push(`en vivo (${later.updates - o.updates} actualizaciones en 2 s)`);
    } else {
      if (o.source !== 'live') fail(`${o.name}: usó la ${o.source === 'snapshot' ? 'copia local' : o.source} en vez de la NASA en vivo`);
      if (expected) {
        const want = expected[o.id];
        if (Math.abs(want - o.value) > 1e-6) fail(`${o.name}: la página dice ${o.value} y el JSON de NASA ${want}`);
        else notes.push(`coincide con el JSON de NASA (sol ${expected.sol})`);
      }
    }
    lines.push(`  ${o.name.padEnd(20)} ${String(Number(o.value).toFixed(2)).padStart(9)} ${o.unit.padEnd(3)} · ${String(o.points).padStart(3)} puntos · ${o.provider} · ${notes.join(', ')}`);
  }

  // La tecla T oculta y vuelve a mostrar el panel
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(300);
  const hiddenState = (await missionState()).visible;
  const hiddenDom = await page.evaluate(() => getComputedStyle(document.getElementById('mission')).display);
  if (hiddenState || hiddenDom !== 'none') fail(`T no ocultó el panel (visible=${hiddenState}, display=${hiddenDom})`);
  await page.screenshot({ path: SHOT_HIDDEN });
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(300);
  if (!(await missionState()).visible) fail('T no volvió a mostrar el panel');
  lines.push(`  Tecla T: oculta (display=${hiddenDom}) y vuelve a mostrar → ${path.relative(ROOT, SHOT_HIDDEN)}`);
  return lines;
}

mkdirSync(path.dirname(SHOT), { recursive: true });
try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__roverReady === true, null, { timeout: 90000 });
  await page.waitForFunction(() => window.__missionReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(1500); // deja asentar algunos frames
  await page.screenshot({ path: SHOT });
  missionReport = await checkMission();

  // Prueba de conducción con teclas reales: avanza ~14 m, gira a la derecha y se detiene
  const s0 = await roverState();
  await page.keyboard.down('KeyW');
  for (let i = 0; i < 120 && (await roverState()).distance - s0.distance < 14; i++) await page.waitForTimeout(250);
  await page.keyboard.down('KeyD');
  const h0 = (await roverState()).heading;
  for (let i = 0; i < 60 && Math.abs((await roverState()).heading - h0) < 0.7; i++) await page.waitForTimeout(250);
  await page.keyboard.up('KeyD');
  for (let i = 0; i < 20; i++) await page.waitForTimeout(250); // sigue recto un poco para marcar la curva
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(2500); // la cámara se asienta detrás del rover
  const s1 = await roverState();
  drive = { s0, s1 };
  await page.screenshot({ path: SHOT_DRIVE });
  if (s1.distance - s0.distance < 3) problems.push(`[check] El rover casi no avanzó con W (${(s1.distance - s0.distance).toFixed(2)} m)`);
  if (s1.tracks === 0) problems.push('[check] El rover avanzó pero no dejó huellas');
} catch (err) {
  problems.push(`[check] Falló la prueba: ${err.message.split('\n')[0]}`);
  await page.screenshot({ path: SHOT }).catch(() => {});
}

await browser.close();
devServer?.kill();

console.log(`Captura: ${path.relative(ROOT, SHOT)}`);
if (drive) {
  const { s0, s1 } = drive;
  console.log(
    `Conducción: ${(s1.distance - s0.distance).toFixed(1)} m recorridos, giro ${((s1.heading - s0.heading) * 57.2958).toFixed(0)}°, ` +
      `${s1.tracks} huellas → ${path.relative(ROOT, SHOT_DRIVE)}`,
  );
}
if (missionReport.length) console.log('\nControl de misión:\n' + missionReport.join('\n'));
const roverLogs = logs.filter((l) => l.startsWith('[rover]'));
if (roverLogs.length) console.log('\n' + roverLogs.join('\n'));
if (problems.length) {
  console.log(`\n${problems.length} problema(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('0 errores de consola.');
