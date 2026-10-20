// npm run check: abre la escena en Chrome headless (el Chrome instalado, sin descargar
// navegadores), guarda una captura y lista los errores de consola.
import { chromium } from 'playwright-core';
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
const SHOT_DRIVE = path.join(ROOT, 'check', 'screenshot-drive.png');
let drive = null;

mkdirSync(path.dirname(SHOT), { recursive: true });
try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__roverReady === true, null, { timeout: 90000 });
  await page.waitForTimeout(1500); // deja asentar algunos frames
  await page.screenshot({ path: SHOT });

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
const roverLogs = logs.filter((l) => l.startsWith('[rover]'));
if (roverLogs.length) console.log('\n' + roverLogs.join('\n'));
if (problems.length) {
  console.log(`\n${problems.length} problema(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('0 errores de consola.');
