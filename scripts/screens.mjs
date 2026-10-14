// Console screenshots for the docs and the deck, taken with a headless Chromium over CDP (no extra deps).
// Usage: node scripts/screens.mjs [url] [outDir]   (BROWSER=path to msedge/chrome)
// Drives the real console: runs the routine, executes tier 1, opens the tier-2 dialog and signs,
// compiles a mandate text, launches attacks, pulls the kill switch. Run it on a fresh deploy (local or Sepolia).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8791/';
const OUT = process.argv[3] ?? 'docs/screens';
const BROWSER = process.env.BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'leash-shot-'));
const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let info;
for (let i = 0; i < 50 && !info; i++) {
  try { info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); }
}
if (!info) throw new Error('browser did not start');

const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(`${m.error.message}`)); else resolve(m.result);
  }
});
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const S = (method, params) => cdp(method, params, sessionId);
const W = 1600;
const H = 1000;
await S('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await S('Page.enable');

async function js(expr) {
  const r = await S('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
// Sepolia waits for blocks: an action takes 9–18 s there, A9 about 50 s.
async function until(cond, what, ms = 60000) {
  for (let t = 0; t < ms; t += 250) {
    if (await js(`return !!(${cond})`)) return;
    await sleep(250);
  }
  throw new Error(`timeout: ${what}`);
}
async function shot(name, selector) {
  let clip;
  if (selector) {
    const r = await js(`const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'start' });
      const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };`);
    clip = { ...r, x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24, scale: 1 };
  }
  const { data } = await S('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`${name}.png`);
}

await S('Page.navigate', { url: URL_ });
await until(`document.querySelectorAll('#attacks .atk').length && document.querySelectorAll('#sample option').length`, 'console loaded');
await js(`document.querySelector('.top').style.position = 'static'; window.scrollTo(0, 0);`);
await shot('console-top');

// Weekly routine (recorded replay) → proposals with every check.
await js(`document.getElementById('run').click();`);
await until(`document.querySelectorAll('#proposals .prop').length`, 'routine');
await shot('routine', '.routine');

// Tier 1: execute the two clean bills.
for (let i = 0; i < 2; i++) {
  await js(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('button.primary').click();`);
  await until(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('.settled')`, `execute ${i}`);
}
await js(`window.scrollTo(0, 0);`);
await sleep(5500); // one refresh tick
await shot('after-tier1');

// Tier 2: the tuition needs the owner's EIP-712 signature; the text is rendered by code.
await js(`[...document.querySelectorAll('#proposals .prop button')].find((b) => b.textContent.startsWith('Review')).click();`);
await until(`document.getElementById('mandateDlg').open`, 'tier-2 dialog');
await js(`window.scrollTo(0, 0);`);
await shot('tier2-dialog');
await js(`document.getElementById('mSign').click();`);
await until(`document.querySelectorAll('#proposals .prop')[2].querySelector('.settled')`, 'tier-2 signed');
await shot('routine-settled', '#proposals');

// Mandate editor: a loosening request is flagged and blocked.
await js(`const sel = document.getElementById('sample'); sel.value = [...sel.options].find((o) => o.textContent.startsWith('Let the agent')).value; sel.dispatchEvent(new Event('change')); document.getElementById('compile').click();`);
await until(`document.querySelectorAll('#diffBody tr').length`, 'compile loosen');
await shot('mandate-editor-loosen', '#editor');
await js(`const sel = document.getElementById('sample'); sel.value = [...sel.options].find((o) => o.textContent.startsWith('My landlord')).value; sel.dispatchEvent(new Event('change')); document.getElementById('compile').click();`);
await until(`document.querySelector('#cNotes li.unm')`, 'compile redirect');
await shot('mandate-editor-redirect', '#editor');

// Red team: stolen-key attacks and the pumped pool, sent for real.
for (const id of ['A1', 'A2', 'A3', 'A4', 'A7', 'A9']) {
  await js(`[...document.querySelectorAll('#attacks .atk')].find((c) => c.querySelector('b').textContent === ${JSON.stringify(id)}).querySelector('button').click();`);
  await until(`[...document.querySelectorAll('#attacks .atk')].find((c) => c.querySelector('b').textContent === ${JSON.stringify(id)}).matches('.pass, .fail')`, `attack ${id}`, 120000);
}
await shot('redteam', '#attacks');
await sleep(5500);
await shot('ledger', '.col-side');

// Kill switch.
await js(`document.getElementById('kill').click();`);
await until(`!document.getElementById('unpause').hidden`, 'paused');
await js(`window.scrollTo(0, 0);`);
await shot('paused');

// Phone width: the owner's view on the go.
await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await S('Page.navigate', { url: URL_ });
await until(`document.querySelectorAll('#attacks .atk').length`, 'mobile load');
await sleep(500);
await shot('mobile');

ws.close();
proc.kill();
