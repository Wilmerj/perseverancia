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
// Avisos de rendimiento del driver GL por software (los provoca la propia captura), no de la app
const IGNORED = [/GL Driver Message .*Performance/];
page.on('console', (msg) => {
  if ((msg.type() === 'error' || msg.type() === 'warning') && !IGNORED.some((re) => re.test(msg.text()))) {
    problems.push(`[console.${msg.type()}] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => problems.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText ?? ''}`));

try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(1500); // deja asentar algunos frames
} catch (err) {
  problems.push(`[check] La escena no indicó estar lista: ${err.message.split('\n')[0]}`);
}

mkdirSync(path.dirname(SHOT), { recursive: true });
await page.screenshot({ path: SHOT });
await browser.close();
devServer?.kill();

console.log(`Captura: ${path.relative(ROOT, SHOT)}`);
if (problems.length) {
  console.log(`\n${problems.length} problema(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('0 errores de consola.');
