// Records the product shots of the launch video (docs/VIDEO-LAUNCH.md) from the real front door: a headless Edge
// plays each scene while the DevTools screencast saves every painted frame, with marks (scenes, beats with the box
// to zoom on, transaction waits to cut). compose-launch.mjs cuts them into the video. Every send is a real transaction.
// Usage: node scripts/record-launch.mjs [doorUrl] [outDir]
//   doorUrl: the server on the public-key vault, e.g. http://127.0.0.1:8792/
//   (node app/src/server.js --network sepolia --deployment sepolia-public-key --port 8792 --allow-live)
// node scripts/record-launch.mjs --retake-blockscout <outDir>: films the Blockscout scene again into that capture,
//   for when Blockscout had not decoded the refusal yet during the take (no transaction is sent).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { fresh } from './take-lines.mjs';

const ARGS = process.argv.slice(2);
const RETAKE = ARGS.includes('--retake-blockscout');
const POS = ARGS.filter((a) => !a.startsWith('--'));
const OUT = (RETAKE ? POS[0] : POS[1]) ?? join('work', `launch-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
const OLD = RETAKE ? JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8')) : null;
const URL_ = OLD?.url ?? POS[0] ?? 'http://127.0.0.1:8792/';
const W = 1920;
const H = 1080;
const README = 'https://github.com/Brieuclerouxtardif/leash#the-agents-key-is-public-try-to-empty-the-vault';
// Words the model has never answered, so each answer is a live call (scripts/take-lines.mjs).
const LINE = RETAKE ? {} : { pay: fresh('pay'), scam: fresh('scam'), school: fresh('school') };
for (const [kind, text] of Object.entries(LINE)) if (!text) throw new Error(`no fresh ${kind} line left: add one in scripts/take-lines.mjs`);
mkdirSync(join(OUT, 'frames'), { recursive: true });

const browser = await launch({ width: W, height: H, scale: 1, port: 9337 });
const { S, on, js, until } = browser;
// A retake keeps the take and drops the old Blockscout scene's marks; its frames are appended, later on the same clock.
const frames = OLD?.frames ?? [];
const marks = OLD ? OLD.marks.filter((m, i, all) => {
  const start = all.findIndex((x) => x.kind === 'scene' && x.id === 'blockscout');
  const end = all.findIndex((x, j) => j > start && (x.kind === 'scene' || x.kind === 'end'));
  return start < 0 || i < start || i >= end;
}) : [];
const mark = (kind, extra = {}) => marks.push({ kind, t: Date.now(), ...extra });
const save = (extra) => writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ url: URL_, width: W, height: H, recordedAt: new Date().toISOString(), ...extra, frames, marks }, null, 1));
process.on('uncaughtException', (e) => { save({ error: e.message }); console.error(`failed after "${marks.at(-1)?.kind} ${marks.at(-1)?.id ?? marks.at(-1)?.what ?? ''}": ${e.message}`); browser.close(); process.exit(1); });
on('Page.screencastFrame', (p) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(join(OUT, 'frames', file), Buffer.from(p.data, 'base64'));
  frames.push({ file, t: Date.now() });
  S('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
});

const RECT = `((els) => { els = [els].flat().filter(Boolean).map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
  if (!els.length) return null; const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top));
  return { x, y, w: Math.max(...els.map((b) => b.right)) - x, h: Math.max(...els.map((b) => b.bottom)) - y }; })`;
const scene = (id) => { mark('scene', { id }); console.log(`scene ${id}`); };
const beat = async (what, focus) => mark('beat', { what, rect: await js(`return ${RECT}(${focus})`) });
async function click(expr, label) {
  const r = await js(`const el = ${expr}; el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); el.click(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  mark('click', { ...r, label });
}
async function waitFor(cond, what, ms = 120000) {
  mark('wait-start', { what });
  await until(cond, what, ms);
  mark('wait-end', { what });
}
// Typed a key at a time, as a person types; `paste` puts the whole line in at once.
async function type(text, paste = false) {
  await js(`const i = document.getElementById('say'); i.focus(); i.value = '';`);
  if (paste) { await S('Input.insertText', { text }); return; }
  for (const ch of text) { await S('Input.insertText', { text: ch }); await sleep(45 + Math.random() * 40); }
}
const shoot = async () => { await S('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); };
const stop = async () => { await S('Page.stopScreencast').catch(() => {}); };
async function go(url, ready, what) {
  await stop();
  await S('Page.navigate', { url });
  await until(ready, what, 90000);
  await sleep(800);
  await shoot();
}
const verdict = `document.querySelector('#answer .verdict:not(:has(button))') ?? document.querySelector('#answer .verdict')`;
// What read the message, as the page labels it: "live model · 9 s", "recorded model answer", "offline reader…".
const sources = {};
const source = async (scene) => { sources[scene] = await js(`return document.querySelector('#answer .replied span[title]')?.textContent ?? null`); };

// ---- The refusal on Blockscout, decoded by a third party.
async function blockscout(decoded) {
  let seen = false;
  scene('blockscout');
  await go(decoded, `document.readyState === 'complete'`, 'blockscout');
  // The sponsored row is a third-party ad (an app-store "DOWNLOAD" banner): hidden, nothing else on the page is touched.
  const noAd = `for (const l of [...document.querySelectorAll('div')].filter((x) => !x.children.length && x.textContent.trim() === 'Sponsored')) {
    const row = l.parentElement?.parentElement; if (row) { row.style.display = 'none'; if (row.nextElementSibling) row.nextElementSibling.style.display = 'none'; } }`;
  const reveal = `[...document.querySelectorAll('span, button, a')].find((x) => x.textContent.trim() === 'Show revert reason')`;
  for (let k = 0; k < 40 && !seen; k++) {
    await sleep(1500);
    await js(noAd);
    if (await js(`return !!${reveal}`)) { await sleep(1200); await click(reveal, 'revert'); await sleep(1200); }
    seen = await js(`return document.body.innerText.includes('PayeeNotAllowed')`);
    if (!seen) { await sleep(3000); if (k % 5 === 4) await go(decoded, `document.readyState === 'complete'`, 'blockscout'); }
  }
  await sleep(800);
  // The decoded box: the error's name with its argument, the payee the contract refused.
  await beat('decoded', `(() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes('PayeeNotAllowed')) { let e = n.parentElement; for (let k = 0; k < 8 && e; k++, e = e.parentElement) if (e.innerText.includes('0x5DF4')) return e; return n.parentElement; } return null; })()`);
  await sleep(4000);
  return seen;
}

if (RETAKE) {
  const decodedSeen = await blockscout(OLD.decoded);
  await stop();
  mark('end');
  save({ network: OLD.network, decoded: OLD.decoded, decodedSeen, refusal: OLD.refusal, takenAt: OLD.recordedAt });
  browser.close();
  console.log(`Blockscout retaken: ${decodedSeen ? 'decoded' : 'still not decoded'} → ${OUT}`);
  process.exit(0);
}

// ---- The door, then inside.
await js(`try { sessionStorage.clear(); } catch {}`);
await go(URL_, `document.body?.classList.contains('door') && document.querySelectorAll('#chips button').length`, 'door');
const net = await js(`return document.getElementById('net').textContent`);
scene('door');
await beat('door', `document.querySelector('.door-copy')`);
await sleep(2500);
await click(`document.getElementById('enter')`, 'enter');
await sleep(2600);
scene('hero');
await beat('hero', `document.querySelector('.cap')`);
await sleep(2500);

// ---- A bill inside the rules, by the live model.
scene('pay');
await type(LINE.pay);
await sleep(400);
await click(`document.getElementById('send')`, 'send');
await waitFor(`document.querySelector('#answer .verdict')`, 'pay');
await source('pay');
await sleep(300);
await beat('paid', `[document.querySelector('#answer .replied'), document.querySelector('#answer .verdict')]`);
await sleep(2600);
await beat('reach', `document.querySelector('.cap')`);
await sleep(1500);

// ---- The scam, healthy agent: the model says no on its own.
scene('scam');
await js(`document.getElementById('answer').replaceChildren()`);
await type(LINE.scam, true);
await sleep(900);
await click(`document.getElementById('send')`, 'send');
await waitFor(`document.querySelector('#answer .verdict')`, 'scam');
await source('scam');
await sleep(300);
await beat('no', `[document.querySelector('#answer .replied'), document.querySelector('#answer .verdict')]`);
await sleep(3000);

// ---- The same scam, model and server hijacked: the contract refuses.
scene('hijack');
await js(`document.getElementById('answer').replaceChildren()`);
await click(`document.querySelector('label.switch')`, 'hijack');
await sleep(1500);
await beat('coral', `document.getElementById('agent')`);
await type(LINE.scam, true);
await sleep(700);
await click(`document.getElementById('send')`, 'send');
await waitFor(`document.querySelector('#answer .verdict')`, 'hijack');
await source('hijack');
await sleep(300);
await beat('refused', `document.querySelector('#answer .verdict')`);
await sleep(3000);
const decoded = await js(`return [...document.querySelectorAll('#answer a')].find((a) => a.href.includes('blockscout'))?.href ?? null`);
const refusal = await js(`return document.querySelector('#answer .verdict')?.innerText ?? ''`);

// ---- Tuition: above the agent's limits, the owner signs a sentence written by code.
scene('mandate');
await click(`document.querySelector('label.switch')`, 'unhijack');
await js(`document.getElementById('answer').replaceChildren()`);
await sleep(800);
await type(LINE.school);
await sleep(400);
await click(`document.getElementById('send')`, 'send');
await waitFor(`document.querySelector('#answer .verdict button')`, 'ask');
await source('mandate');
await sleep(1200);
await click(`document.querySelector('#answer .verdict button')`, 'review');
await until(`document.getElementById('mandateDlg').open`, 'dialog');
await sleep(500);
await beat('sentence', `document.querySelector('#mandateDlg form')`);
await sleep(3500);
await click(`document.getElementById('mSign')`, 'sign');
await waitFor(`document.querySelector('#answer .verdict .word')?.textContent === 'Paid'`, 'mandate');
await sleep(300);
await beat('paid', `document.querySelector('#answer .verdict')`);
await sleep(2500);

// ---- The guardian's kill switch.
scene('kill');
await click(`document.getElementById('kill')`, 'kill');
await waitFor(`!document.getElementById('pausedBand').hidden`, 'pause');
await sleep(1800);
await beat('zero', `[document.getElementById('pausedBand'), document.querySelector('.cap')]`);
await sleep(2500);
await click(`document.getElementById('unpause')`, 'unpause');
await waitFor(`document.getElementById('pausedBand').hidden`, 'unpause');
await sleep(1500);

// ---- The refusal on Blockscout (filmed after the kill switch, cut back in after the hijack).
const decodedSeen = decoded ? await blockscout(decoded) : false;

// ---- The README: the agent's key is public.
await go(README, `document.querySelector('article')`, 'readme');
scene('readme');
await js(`const h = [...document.querySelectorAll('article h2')].find((x) => x.textContent.includes('key is public')); h?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24);`);
await sleep(1500);
await beat('section', `[...document.querySelectorAll('article h2')].find((x) => x.textContent.includes('key is public'))`);
await sleep(2000);
await beat('key', `[...document.querySelectorAll('article td')].find((x) => x.textContent.trim() === 'Agent private key')?.closest('tr')`);
await sleep(3500);

await stop();
mark('end');
save({ network: net, decoded, decodedSeen, refusal, lines: LINE, sources });
browser.close();
console.log(`${frames.length} frames, ${Math.round((marks.at(-1).t - frames[0].t) / 1000)} s → ${OUT}`);
console.log(`refusal: ${refusal.replace(/\s+/g, ' ')}${decoded ? ` · Blockscout ${decodedSeen ? 'decoded it' : 'had not decoded it yet'}` : ''}`);
for (const [scene, label] of Object.entries(sources)) console.log(`${scene.padEnd(8)} read by: ${label}${/^live model/.test(label ?? '') ? '' : '   ← NOT LIVE'}`);
