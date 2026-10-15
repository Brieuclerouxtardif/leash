// Console screenshots for the docs and the deck, taken with a headless Chromium over CDP (no extra deps).
// Usage: node scripts/screens.mjs [url] [outDir]   (BROWSER=path to msedge/chrome)
// Drives the real console: runs the routine, executes tier 1, opens the tier-2 dialog and signs,
// compiles a mandate text, launches attacks, pulls the kill switch. Run it on a fresh deploy (local or Sepolia).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8791/';
const OUT = process.argv[3] ?? 'docs/screens';
mkdirSync(OUT, { recursive: true });

const browser = await launch({ width: 1600, height: 1000, scale: 2 });
const { S, js, until } = browser;

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

// Mandate editor: a vague value becomes a question, and the owner's answer fills it (two recorded turns).
await js(`const sel = document.getElementById('sample'); sel.value = [...sel.options].find((o) => o.textContent.startsWith('My rent went up')).value; sel.dispatchEvent(new Event('change')); document.getElementById('compile').click();`);
await until(`!document.getElementById('cAsk').hidden`, 'compile vague');
await shot('mandate-editor-ask', '#editor');
await js(`document.getElementById('answer').click();`);
await until(`document.getElementById('cMeta').textContent.includes('turn 2')`, 'compile answered');
await shot('mandate-editor-answered', '#editor');

// Mandate editor: a Chinese owner text with a transfer to an address slipped in.
await js(`const sel = document.getElementById('sample'); sel.value = [...sel.options].find((o) => o.textContent.startsWith('房租涨了')).value; sel.dispatchEvent(new Event('change')); document.getElementById('compile').click();`);
await until(`document.querySelector('#cNotes li.unm')`, 'compile zh');
await shot('mandate-editor-zh', '#editor');

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

browser.close();
