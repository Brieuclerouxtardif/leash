// Console screenshots for the docs and the deck, taken with a headless Chromium over CDP (no extra deps).
// Usage: node scripts/screens.mjs [url] [outDir]   (BROWSER=path to msedge/chrome)
// Drives the real console: hijacks the agent four ways, runs the routine, executes tier 1, opens the tier-2 dialog
// and signs, compiles mandate texts, settles a sealed bill, launches the sixteen attacks, pulls the kill switch.
// Run it on a fresh deploy (local or Sepolia).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8791/console';
const OUT = process.argv[3] ?? 'docs/screens';
mkdirSync(OUT, { recursive: true });

const browser = await launch({ width: 1600, height: 1000, scale: 2 });
const { S, js, until } = browser;
// Still pictures: no entrance motion, so nothing is caught halfway in.
await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });

async function shot(name, selector) {
  let clip;
  if (selector) {
    const r = await js(`const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'start' });
      await new Promise((r) => setTimeout(r, 400));
      const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };`);
    clip = { ...r, x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32, scale: 1 };
  }
  const { data } = await S('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`${name}.png`);
}
const chip = (group, label) => `[...document.querySelectorAll('#${group} button')].find((b) => b.textContent.startsWith(${JSON.stringify(label)}))`;
const click = (expr) => js(`(${expr}).click();`);

await S('Page.navigate', { url: URL_ });
await until(`document.querySelectorAll('#attacks .atk').length && document.querySelectorAll('#sampleChips button').length && document.querySelectorAll('#sayChips button').length`, 'console loaded');
await js(`document.querySelector('.bar').style.position = 'static'; window.scrollTo(0, 0);`);
await sleep(600);
await shot('console-top');

// Hijack the agent: the fake owner at the airport, sent by the hijacked server with the vault's agent key, then
// with a plain wallet's key. The first is refused by the contract; the second empties the plain wallet.
for (const [agent, label] of [['server', 'Model + server'], ['plain', 'No LEASH']]) {
  await click(chip('agentSeg', label));
  await click(chip('sayChips', 'Owner stuck'));
  await click(`document.getElementById('send')`);
  await until(`document.querySelector('#thread li.ex.${agent} .verdict')`, `chat ${agent}`, 120000);
}
await sleep(5500); // one refresh tick: the meter shows the plain wallet emptied
await js(`window.scrollTo(0, 0);`);
await shot('chat-no-leash', '.hero');

// Weekly routine (recorded replay): proposals with their outcome; the injected documents are tagged.
await click(`document.getElementById('run')`);
await until(`document.querySelectorAll('#proposals .prop').length`, 'routine');
await shot('routine', '#routine');

// Tier 1: execute the two clean bills.
for (let i = 0; i < 2; i++) {
  await js(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('button.primary').click();`);
  await until(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('.settled')`, `execute ${i}`);
}
await sleep(5500); // one refresh tick
await js(`window.scrollTo(0, 0);`);
await shot('after-tier1');

// Tier 2: the tuition needs the owner's EIP-712 signature; the text is rendered by code.
await click(`[...document.querySelectorAll('#proposals .prop button')].find((b) => b.textContent.startsWith('Review'))`);
await until(`document.getElementById('mandateDlg').open`, 'tier-2 dialog');
await shot('tier2-dialog');
await click(`document.getElementById('mSign')`);
await until(`document.querySelectorAll('#proposals .prop')[2].querySelector('.settled')`, 'tier-2 signed');
await shot('routine-settled', '#proposals');

// Rules in the owner's words: a loosening request is flagged, a redirect is not enforceable, a vague value becomes
// a question the owner answers, and a Chinese text with a transfer slipped in.
const compile = async (label, done, what) => {
  await click(chip('sampleChips', label));
  await click(`document.getElementById('compile')`);
  await until(done, what);
};
await compile('Let it pay the school', `document.querySelectorAll('#diffBody tr').length && !document.getElementById('diff').hidden`, 'compile loosen');
await shot('mandate-editor-loosen', '#editor');
await compile('Landlord', `document.querySelector('#cNotes li')`, 'compile redirect');
await shot('mandate-editor-redirect', '#editor');
await compile('A bit more rent', `!document.getElementById('cAsk').hidden`, 'compile vague');
await shot('mandate-editor-ask', '#editor');
await click(`document.getElementById('answer')`);
await until(`document.getElementById('cAsk').hidden && !document.getElementById('worstShift').hidden`, 'compile answered');
await shot('mandate-editor-answered', '#editor');
await compile('In Chinese', `document.querySelector('#cNotes li.unm, #cNotes li.err')`, 'compile zh');
await shot('mandate-editor-zh', '#editor');

// Sealed bill: the agent settles the school's semester fees alone; the vault holds them for the contest window.
await click(`document.querySelector('#bills button')`);
await until(`document.querySelector('#holds .hold')`, 'sealed bill held');
await sleep(2200);
await shot('sealed', '#invoices');

// Red team: the sixteen attacks, sent for real.
await click(`document.getElementById('runAll')`);
await until(`document.querySelectorAll('#attacks .atk.pass, #attacks .atk.fail').length === document.querySelectorAll('#attacks .atk').length`, 'sixteen attacks', 600000);
await sleep(1200);
await shot('redteam', '#redteam');

// Receipts: every transaction this console sent.
await sleep(5500);
await js(`window.scrollTo(0, 0); document.getElementById('receiptsBtn').click();`);
await sleep(400);
await shot('ledger');
await js(`document.getElementById('receiptsClose').click();`);

// Kill switch.
await click(`document.getElementById('kill')`);
await until(`!document.getElementById('pausedBand').hidden`, 'paused');
await js(`window.scrollTo(0, 0);`);
await sleep(400);
await shot('paused');

// Phone width: the owner's view on the go.
await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await S('Page.navigate', { url: URL_ });
await until(`document.querySelectorAll('#attacks .atk').length`, 'mobile load');
await sleep(800);
await shot('mobile');

browser.close();
