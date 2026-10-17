// Front-door screenshots for the docs and the deck, taken with a headless Chromium over CDP (no extra deps).
// Usage: node scripts/home-screens.mjs [url] [outDir]   (BROWSER=path to msedge/chrome)
// The door, then inside: a bill paid by the agent, the hijacked agent held by the contract, the paused vault, and
// the same at phone width. Every send is a real transaction, so run it on a fresh deploy.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8791/';
const OUT = process.argv[3] ?? 'docs/screens';
mkdirSync(OUT, { recursive: true });

const browser = await launch({ width: 1600, height: 1000, scale: 2 });
const { S, js, until } = browser;
// Still pictures: no entrance motion, so nothing is caught halfway in. The stamps and the landed amounts still show.
await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });

async function shot(name) {
  const { data } = await S('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`${name}.png`);
}
const chip = (label) => `[...document.querySelectorAll('#chips button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)}))`;
const send = async (label, done, what) => {
  await js(`document.getElementById('answer').replaceChildren(); (${chip(label)}).click();`);
  await until(done, what, 120000);
  await sleep(300);
};

async function visit(prefix) {
  // The page remembers an entered visit for the tab's session; forget it so the door shows.
  await js(`try { sessionStorage.clear(); } catch {}`);
  await S('Page.navigate', { url: URL_ });
  await sleep(500);
  await until(`document.body?.classList.contains('door') && document.querySelectorAll('#chips button').length`, 'door loaded');
  await sleep(500);
  await shot(`${prefix}-door`);

  await js(`document.getElementById('enter').click();`);
  await until(`!document.body.classList.contains('door') && document.getElementById('bal').textContent !== '$0'`, 'entered');
  await sleep(600);
  await shot(`${prefix}-in`);

  await send('Pay the electricity', `document.querySelector('#answer .verdict') && document.querySelector('#payees em')`, 'paid');
  await shot(`${prefix}-paid`);

  await js(`document.getElementById('hijack').click();`);
  await send('Landlord', `document.querySelector('#answer .verdict') && document.querySelector('.stamp')`, 'held');
  await shot(`${prefix}-held`);
  await js(`document.getElementById('hijack').click();`);
}

await visit('home');

await js(`document.getElementById('kill').click();`);
await until(`!document.getElementById('pausedBand').hidden`, 'paused');
await sleep(400);
await shot('home-paused');
await js(`document.getElementById('unpause').click();`);
await until(`document.getElementById('pausedBand').hidden`, 'restarted');

// Phone width.
await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await visit('home-mobile');

browser.close();
