// Records the demo of docs/VIDEO.md from the real console: a headless browser plays every scene while the
// DevTools screencast saves each painted frame. compose-video.mjs then cuts the block waits and adds the cards,
// subtitles and spotlights. This is the fallback video; a recording narrated by a person is better.
// Usage: node scripts/record-demo.mjs [consoleUrl] [outDir]   Needs a fresh deployment (scripts/preflight.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const URL_ = process.argv[2] ?? 'http://127.0.0.1:8791/';
const OUT = process.argv[3] ?? join('work', `demo-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
const W = 1920;
const H = 1080;
mkdirSync(join(OUT, 'frames'), { recursive: true });

const browser = await launch({ width: W, height: H, scale: 1, port: 9334 });
const { S, on, js, until } = browser;

const frames = [];
const marks = [];
const mark = (kind, extra = {}) => marks.push({ kind, t: Date.now(), ...extra });
let network = null;
const save = (extra) => writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ url: URL_, network, width: W, height: H, recordedAt: new Date().toISOString(), ...extra, frames, marks }, null, 1));
// A take that fails still leaves its timeline, with the error and the last mark reached.
process.on('uncaughtException', (e) => { save({ error: e.message }); console.error(`failed after "${marks.at(-1)?.kind} ${marks.at(-1)?.what ?? marks.at(-1)?.label ?? marks.at(-1)?.id ?? ''}": ${e.message}`); browser.close(); process.exit(1); });
on('Page.screencastFrame', (p) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
  writeFileSync(join(OUT, 'frames', file), Buffer.from(p.data, 'base64'));
  frames.push({ file, t: Date.now() });
  S('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
});

// The on-screen box around every element an expression returns, for the composer's spotlight.
const RECT = `((els) => { els = [els].flat().filter(Boolean).map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
  if (!els.length) return null; const x = Math.min(...els.map((b) => b.left)), y = Math.min(...els.map((b) => b.top));
  return { x, y, w: Math.max(...els.map((b) => b.right)) - x, h: Math.max(...els.map((b) => b.bottom)) - y }; })`;
const all = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})]`;

// Scroll so that `selector` sits just under the sticky header, smoothly, as a person would.
async function show(selector, offset = 16) {
  mark('scroll');
  await js(`const el = document.querySelector(${JSON.stringify(selector)}); const top = document.querySelector('.top')?.offsetHeight ?? 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - top - ${offset}, behavior: 'smooth' });`);
  await sleep(1200);
}
async function center(expr) {
  mark('scroll');
  await js(`(${expr}).scrollIntoView({ block: 'center', behavior: 'smooth' })`);
  await sleep(1200);
}
// Click an element; the composer draws a ring there and spotlights `focus` (an expression) while the line is said.
async function click(expr, label, focus) {
  const r = await js(`const el = ${expr}; const y0 = scrollY; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); await new Promise((r) => setTimeout(r, 500));
    const b = el.getBoundingClientRect(); el.click();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, scrolled: scrollY !== y0, rect: ${focus ? `${RECT}(${focus})` : 'null'} };`);
  mark('click', { ...r, label });
}
// A moment the voice-over points at without a click, with the box to spotlight.
async function beat(what, focus) {
  mark('beat', { what, rect: await js(`return ${RECT}(${focus})`) });
}
// A result changed the size of the spotlit element: the spotlight follows it.
async function resize(focus) {
  await sleep(150);
  mark('resize', { rect: await js(`return ${RECT}(${focus})`) });
}
// A transaction is on its way: the composer cuts this stretch on a testnet.
async function waitFor(cond, what, ms) {
  mark('wait-start', { what });
  await until(cond, what, ms);
  mark('wait-end', { what });
}
const scene = (id) => mark('scene', { id });
const atk = (id) => `[...document.querySelectorAll('#attacks .atk')].find((c) => c.querySelector('b').textContent === ${JSON.stringify(id)})`;
const pick = (prefix) => js(`const sel = document.getElementById('sample'); sel.value = [...sel.options].find((o) => o.textContent.startsWith(${JSON.stringify(prefix)})).value; sel.dispatchEvent(new Event('change'));`);

await S('Page.navigate', { url: URL_ });
await until(`document.querySelectorAll('#attacks .atk').length && document.querySelectorAll('#sample option').length`, 'console loaded');
network = await js(`return document.getElementById('net').textContent`);
await S('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
await sleep(500);

scene('top');
await js(`window.scrollTo(0, 0)`);
await sleep(1000);
await beat('vault', `document.getElementById('vaultCard')`);
await sleep(3000);
await beat('mandate', `document.getElementById('mandateCard')`);
await sleep(3000);

scene('routine');
await show('.routine');
await click(`document.getElementById('run')`, 'Run routine');
await until(`document.querySelectorAll('#proposals .prop').length`, 'routine');
await sleep(1500);
await show('#inbox .doc.flagged');
await beat('inbox', all('#inbox .doc.flagged'));
await sleep(2500);
await show('#planMeta', 60);
await beat('replay', `document.getElementById('planMeta')`);
await sleep(2000);

scene('tier1');
await show('#proposals');
for (let i = 0; i < 2; i++) {
  await click(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('button.primary')`, 'Execute', `document.querySelectorAll('#proposals .prop')[${i}]`);
  await waitFor(`document.querySelectorAll('#proposals .prop')[${i}].querySelector('.settled')`, `execute ${i}`);
  await resize(`document.querySelectorAll('#proposals .prop')[${i}]`);
  await sleep(650);
}
await until(`document.querySelectorAll('#ledger > li.success').length >= 2`, 'ledger shows both payments');
await beat('hashes', all('#ledger > li:nth-child(-n+2)'));
await sleep(1500);

scene('tier2');
await click(`[...document.querySelectorAll('#proposals .prop button')].find((b) => b.textContent.startsWith('Review'))`, 'Review & sign');
await until(`document.getElementById('mandateDlg').open`, 'tier-2 dialog');
await sleep(300);
await beat('dialog', `document.getElementById('mText')`);
await sleep(4000);
await click(`document.getElementById('mSign')`, 'Sign as owner');
await waitFor(`document.querySelectorAll('#proposals .prop')[2].querySelector('.settled')`, 'tier-2 signed');
await center(`document.querySelectorAll('#proposals .prop')[2]`);
await beat('signed', `document.querySelectorAll('#proposals .prop')[2].querySelector('.settled')`);
await sleep(1500);

// The school's sealed invoice: the agent settles it alone, the vault holds it for the contest window, then releases it.
scene('seal');
await show('#sealCard');
await beat('sealed', `document.querySelector('#seal .atk')`);
await sleep(3000);
await click(`document.querySelector('#seal .atk button')`, 'Settle as agent', `document.querySelector('#seal .atk')`);
await waitFor(`document.querySelector('#seal .atk').matches('.pass, .fail')`, 'sealed invoice held, then released', 400000);
await resize(`document.querySelector('#seal .atk')`);
await sleep(1500);
await beat('released', `document.querySelector('#seal .atk')`);
await sleep(1500);

scene('editor');
await show('#editor');
await pick('Let the agent');
await sleep(500);
await beat('english', `document.getElementById('ownerText')`);
await sleep(1500);
await click(`document.getElementById('compile')`, 'Compile');
await until(`document.querySelectorAll('#diffBody tr').length`, 'compile loosen');
await sleep(300);
await beat('diff', `document.getElementById('diff')`);
await sleep(1500);
await beat('loosen', all('#diffBody tr.looser'));
await sleep(1500);
await beat('blocked', all('#cNotes li.err, #applyMandate'));
await sleep(2000);
// A vague value: the model asks, the owner answers, the second turn gives the row (two recorded live turns).
await pick('My rent went up');
await sleep(800);
await click(`document.getElementById('compile')`, 'Compile');
await until(`!document.getElementById('cAsk').hidden`, 'compile vague');
await sleep(300);
await beat('ask', `[document.getElementById('cAsk'), document.getElementById('applyMandate')]`);
await sleep(3000);
await click(`document.getElementById('answer')`, 'Answer and compile again');
await until(`document.getElementById('cMeta').textContent.includes('turn 2')`, 'compile answered');
await sleep(300);
await beat('answered', all('#diffBody tr.looser'));
await sleep(2000);
await pick('房租涨了');
await sleep(800);
await click(`document.getElementById('compile')`, 'Compile');
await until(`document.querySelector('#cNotes li.unm')`, 'compile zh');
await center(`document.querySelector('#cNotes li.unm')`);
await beat('redirect', `document.querySelector('#cNotes li.unm')`);
await sleep(3000);

scene('redteam');
await show('#attacks');
await beat('attacks', `document.getElementById('attacks')`);
await sleep(1500);
for (const id of ['A2', 'A7', 'A14', 'A9']) {
  await click(`${atk(id)}.querySelector('button')`, `Launch ${id}`, atk(id));
  await waitFor(`${atk(id)}.matches('.pass, .fail')`, `attack ${id}`, 120000);
  await resize(atk(id));
  await sleep(1050);
}
await until(`document.querySelectorAll('#ledger > li.reverted').length >= 4`, 'ledger shows the refusals');
await beat('refusals', all('#ledger > li:nth-child(-n+4)'));
await sleep(1500);

// The fake-owner message, sent by the hijacked server with the vault's agent key, then with a plain wallet's key.
// Neither touches the vault's state: the first reverts, the second moves the plain wallet's tUSD.
scene('chat');
const agent = (v) => js(`const a = document.getElementById('agent'); a.value = ${JSON.stringify(v)}; a.dispatchEvent(new Event('change'));`);
const AGENT_BOX = `[document.getElementById('agent'), document.getElementById('agentNote')]`;
await show('#talk');
await agent('server');
await js(`const s = document.getElementById('say'); s.value = [...s.options].find((o) => o.textContent.startsWith('This is the owner')).value; s.dispatchEvent(new Event('change'));`);
await sleep(800);
await beat('message', `document.getElementById('msg')`);
await sleep(3000);
await click(`document.getElementById('send')`, 'Send (hijacked server)', AGENT_BOX);
await waitFor(`document.querySelector('#thread li.ex.server .settled')`, 'chat server', 120000);
await center(`document.querySelector('#thread li.ex.server .settled')`);
await beat('chat-refused', `document.querySelector('#thread li.ex.server .settled')`);
await sleep(2000);
await show('#talk');
await agent('plain');
await sleep(800);
await click(`document.getElementById('send')`, 'Send (no LEASH)', AGENT_BOX);
await waitFor(`document.querySelector('#thread li.ex.plain .settled')`, 'chat plain', 120000);
await center(`document.querySelector('#thread li.ex.plain .settled')`);
await sleep(2000);
await show('#talk');
await until(`!document.querySelector('.wplain')?.textContent.includes('12,000 tUSD now')`, 'meter shows the plain wallet emptied');
await beat('meter', `document.getElementById('worst')`);
await sleep(3000);

scene('kill');
await click(`${atk('A10')}.querySelector('button')`, 'Launch A10', atk('A10'));
await waitFor(`${atk('A10')}.matches('.pass, .fail')`, 'attack A10', 120000);
await resize(atk('A10'));
await sleep(850);
mark('scroll');
await js(`window.scrollTo({ top: 0, behavior: 'smooth' })`);
await sleep(1500);
await until(`!document.getElementById('unpause').hidden`, 'paused pill');
await beat('paused', `[document.getElementById('agentPill'), document.getElementById('unpause')]`);
await sleep(2000);
await click(`document.getElementById('unpause')`, 'Owner: restart agent', `document.getElementById('unpause')`);
await waitFor(`document.getElementById('unpause').hidden`, 'restart');
await sleep(2500);

scene('end');
await S('Page.stopScreencast');
const results = await js(`return [...document.querySelectorAll('#attacks .atk')].filter((c) => c.matches('.pass, .fail')).map((c) => [c.querySelector('b').textContent, c.matches('.pass')])`);
save({ results });
browser.close();
console.log(`${frames.length} frames, ${marks.filter((m) => m.kind === 'scene').length - 1} scenes, attacks ${results.map(([id, ok]) => `${id}:${ok ? 'pass' : 'FAIL'}`).join(' ')} → ${OUT}`);
if (results.some(([, ok]) => !ok)) process.exit(1);
