// Cuts the fallback demo video from a record-demo.mjs capture, inside a headless browser (no ffmpeg needed):
// title and closing cards, the voice-over of docs/VIDEO.md as subtitles (and, with --voice, spoken by the Windows
// voice), a ring on every click, and each block wait cut and labelled. Where a sentence is still being spoken when
// its moment comes, the picture holds on the frame before that moment instead of running ahead of the words.
// Usage: node scripts/compose-video.mjs <captureDir> [--voice] [--repo <url>] [--out <file without extension>] [--plan] [--preview]
// --plan prints the timing (length, cuts, holds) and stops before the real-time render.
// --preview renders a 720p copy at a low bitrate (~25 MB for 3 min), small enough to send to a phone.
// Writes <out>.mp4 (or .webm) and <out>.srt.
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const DIR = resolve(args[0] ?? '');
if (!args[0] || !existsSync(join(DIR, 'timeline.json'))) { console.error('usage: node scripts/compose-video.mjs <captureDir> [--voice] [--repo <url>] [--out <file>]'); process.exit(2); }
const VOICE = args.includes('--voice');
const PREVIEW = args.includes('--preview');
const REPO = opt('--repo');
const OUT = resolve(opt('--out') ?? join(DIR, VOICE ? 'leash-demo-voice' : 'leash-demo'));

const tl = JSON.parse(readFileSync(join(DIR, 'timeline.json'), 'utf8'));
const T0 = tl.frames[0].t;
const src = (ms) => (ms - T0) / 1000;
const marks = tl.marks.map((m) => ({ ...m, s: src(m.t) }));

// ---- The script: one row of the VIDEO.md table per slot.
const SLOTS = ['title', 'top', 'routine', 'tier1', 'tier2', 'editor', 'redteam', 'kill', 'closing'];
const rows = readFileSync(join(ROOT, 'docs', 'VIDEO.md'), 'utf8').split('\n')
  .map((l) => l.match(/^\| \d:\d\d–\d:\d\d \| (.*) \| "(.*)" \|\s*$/)).filter(Boolean)
  .map(([, screen, voice]) => ({ screen, voice }));
if (rows.length !== SLOTS.length) throw new Error(`VIDEO.md has ${rows.length} voice-over rows, expected ${SLOTS.length}`);
const script = Object.fromEntries(SLOTS.map((id, i) => [id, rows[i]]));
const sentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

// The sentence waits for this mark of the recording (first match inside its scene, after the previous anchor),
// and the box the mark recorded is spotlit while it is said.
const beat = (what) => (m) => m.kind === 'beat' && m.what === what;
const click = (label) => (m) => m.kind === 'click' && m.label === label;
const ANCHORS = {
  'This vault belongs': beat('vault'),
  'The rules in the Mandate card': beat('mandate'),
  'Once a week': click('Run routine'),
  'Five documents': beat('inbox'),
  'This is a recorded replay': beat('replay'),
  'Rent and electricity': click('Execute'),
  'Each payment': beat('hashes'),
  'Tuition is': click('Review & sign'),
  'What the owner reads': beat('dialog'),
  'One signature': beat('signed'),
  'The owner can change': beat('english'),
  'The model turns them': beat('diff'),
  'Red means': beat('loosen'),
  'This one is blocked': beat('blocked'),
  'And when the text': beat('redirect'),
  'Now we attack': beat('attacks'),
  'A stolen agent key': click('Launch A2'),
  'It forges': click('Launch A7'),
  'A pumped pool': click('Launch A9'),
  'Every refusal is mined': beat('refusals'),
  'If anything looks wrong': click('Launch A10'),
  'Only the owner': beat('paused'),
};
const used = new Set();
const anchorOf = (text) => Object.keys(ANCHORS).find((k) => text.startsWith(k) && used.add(k));

// ---- Speech: Windows SAPI renders each sentence to a WAV; without --voice, a reading time stands in for it.
const lines = SLOTS.flatMap((id) => sentences(script[id].voice).map((text) => ({ id, text })));
const spoken = (s) => s
  .replace(/\bEIP-712\b/g, 'E I P 7 12')
  .replace(/\bLEASH\b/g, 'Leash')
  .replace(/\bETH\b/g, 'E T H')
  .replace(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g, (w) => w.replace(/([a-z])([A-Z])/g, '$1 $2'));
if (VOICE) {
  mkdirSync(join(DIR, 'voice'), { recursive: true });
  lines.forEach((l, i) => { l.audio = `voice/s${String(i).padStart(2, '0')}.wav`; });
  const list = join(DIR, 'voice', 'list.json');
  writeFileSync(list, JSON.stringify(lines.map((l) => ({ file: join(DIR, l.audio), text: spoken(l.text) }))));
  const ps = `Add-Type -AssemblyName System.Speech
$list = Get-Content -Raw -Encoding UTF8 $env:LEASH_TTS_LIST | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop'); $s.Rate = -1
foreach ($i in $list) { $s.SetOutputToWaveFile($i.file); $s.Speak($i.text) }
$s.SetOutputToNull(); $s.Dispose()`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { env: { ...process.env, LEASH_TTS_LIST: list }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`speech synthesis failed: ${r.stderr}`);
  for (const l of lines) l.dur = wavSeconds(readFileSync(join(DIR, l.audio)));
} else {
  for (const l of lines) l.dur = Math.max(1.8, 0.4 + l.text.split(/\s+/).length / 2.6);
}
function wavSeconds(buf) {
  let byteRate = 0;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(p + 16);
    if (id === 'data') return size / byteRate;
    p += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in WAV');
}

// ---- Edit decision list, in output seconds.
const GAP = 0.35; // between two sentences
const LEAD = 0.6; // before a scene's first unanchored sentence
const TAIL = 1.0; // after a scene's last sentence
const segments = [];
const subs = [];
const rings = [];
const captions = [];
const spots = [];
let o = 0;

function card(id, lines_, { min }) {
  const say = lines.filter((l) => l.id === id);
  let t = o + 0.8;
  for (const l of say) { subs.push({ o0: t, o1: t + l.dur, text: l.text, audio: l.audio }); t += l.dur + GAP; }
  const o1 = Math.max(o + min, t + 0.8);
  segments.push({ kind: 'card', id, o0: o, o1, lines: lines_ });
  o = o1;
}

// A block wait longer than this is cut, keeping the click with its "Sending…" label and the result.
const CUT_OVER = 2.5;
const cuts = [];
for (const m of marks.filter((x) => x.kind === 'wait-start')) {
  const end = marks.find((x) => x.kind === 'wait-end' && x.what === m.what && x.s >= m.s);
  if (end && end.s - m.s > CUT_OVER) cuts.push({ s0: m.s + 0.8, s1: end.s - 0.5, what: m.what, wait: end.s - m.s });
}

// Footage seconds between two source moments once the cuts are taken out.
const span = (a, b) => b - a - cuts.reduce((x, c) => x + Math.max(0, Math.min(b, c.s1) - Math.max(a, c.s0)), 0);
const EVENTS = new Set(['scroll', 'click', 'beat']); // a block wait is not one: its result must play
const sceneMarks = marks.filter((m) => m.kind === 'scene');
for (const id of SLOTS.slice(1, -1)) {
  const i = sceneMarks.findIndex((m) => m.id === id);
  if (i < 0) throw new Error(`scene ${id} missing from the capture`);
  const s0 = sceneMarks[i].s;
  const s1 = sceneMarks[i + 1].s;
  let pos = s0; // source time already emitted
  const advance = (to) => { // emit footage up to source time `to`, skipping the cuts
    while (pos < to) {
      const cut = cuts.find((c) => c.s1 > pos && c.s0 < to);
      const stop = cut ? Math.max(pos, cut.s0) : to;
      if (stop > pos) { segments.push({ kind: 'footage', o0: o, o1: o + stop - pos, s0: pos }); o += stop - pos; }
      if (!cut) { pos = to; break; }
      if (cut.s0 >= pos) captions.push({ o0: o, o1: o + 2.6, text: `block wait cut · ${Math.round(cut.wait)} s` });
      pos = Math.min(to, cut.s1);
    }
  };
  const hold = (sec) => { if (sec > 0.05) { segments.push({ kind: 'hold', o0: o, o1: o + sec, s: Math.max(s0, pos - 0.03) }); o += sec; } };
  let free = o + LEAD;
  let after = s0;
  for (const l of lines.filter((x) => x.id === id)) {
    const key = anchorOf(l.text);
    let start = free;
    let m = null;
    if (key) {
      m = marks.find((x) => x.s >= after && x.s < s1 && ANCHORS[key](x));
      if (!m) throw new Error(`no mark for "${key}" in scene ${id}`);
      // When the words run behind, hold at the first change of the page after the previous anchor: what is
      // being talked about stays on screen, and the steps that lead to this anchor play just before it.
      const first = marks.find((x) => x.s > after && x.s < m.s && EVENTS.has(x.kind)) ?? m;
      advance(first.s);
      const ahead = span(first.s, m.s);
      if (free > o + ahead + 0.25) hold(free - o - ahead);
      advance(m.s);
      after = m.s;
      start = Math.max(o, free);
    }
    subs.push({ o0: start, o1: start + l.dur, text: l.text, audio: l.audio });
    if (m?.rect) spots.push({ o0: start, o1: start + l.dur + 0.3, rect: m.rect, s: m.s, scene: s1 });
    free = start + l.dur + GAP;
  }
  advance(s1);
  hold(free - GAP + TAIL - o);
}
// Output time of a source moment: inside a cut, the moment the footage resumes.
function outAt(s) {
  const seg = segments.find((x) => x.kind === 'footage' && x.s0 + (x.o1 - x.o0) > s + 1e-6);
  return !seg ? o : s < seg.s0 ? seg.o0 : seg.o0 + s - seg.s0;
}
for (const m of marks.filter((x) => x.kind === 'click')) rings.push({ o: outAt(m.s), x: m.x, y: m.y });
// A spotlight goes out when the page moves under it.
const movers = marks.filter((m) => m.kind === 'scroll' || m.kind === 'scene' || (m.kind === 'click' && m.scrolled));
for (const sp of spots) {
  const next = movers.find((m) => m.s > sp.s);
  sp.o1 = Math.min(sp.o1, outAt(next ? next.s : sp.scene));
  const grown = marks.find((m) => m.kind === 'resize' && m.s > sp.s && (!next || m.s < next.s) && m.rect);
  if (grown && outAt(grown.s) < sp.o1) Object.assign(sp, { to: grown.rect, ot: outAt(grown.s) });
}
const unused = Object.keys(ANCHORS).filter((k) => !used.has(k));
if (unused.length) console.warn(`warning: no VIDEO.md sentence starts with ${unused.map((k) => `"${k}"`).join(', ')}`);

const net = tl.network;
const footnote = [`Recorded from the live console on ${net}.`, cuts.length ? `${cuts.length} block waits cut and labelled.` : null,
  VOICE ? 'Synthetic voice (Windows).' : null].filter(Boolean).join(' ');
const title = script.title.screen.match(/"(.+)"/)[1];
const stats = script.closing.screen.replace(/^Closing card:\s*/, '').replace(/\.$/, '').split(' · ').filter((x) => x !== 'repo URL');
// The body was laid out from 0; the title card goes in front of it and the closing card after.
const cardsStart = o;
o = 0;
const body = segments.splice(0);
const bodySubs = subs.splice(0);
card('title', { big: title.split(': ')[0], tag: title.split(': ').slice(1).join(': '), foot: footnote }, { min: 5 });
const shift = o;
for (const s of body) segments.push({ ...s, o0: s.o0 + shift, o1: s.o1 + shift });
for (const s of bodySubs) subs.push({ ...s, o0: s.o0 + shift, o1: s.o1 + shift });
for (const r of rings) r.o += shift;
for (const c of [...captions, ...spots]) { c.o0 += shift; c.o1 += shift; if (c.ot !== undefined) c.ot += shift; }
o = cardsStart + shift;
card('closing', { big: 'LEASH', stats, repo: REPO ?? null, tag: title.split(': ').slice(1).join(': ') }, { min: 6 });
const total = o;

const plan = { width: tl.width, height: tl.height, total, frames: tl.frames.map((f) => ({ file: f.file, t: src(f.t) })), segments, subs, rings, captions, spots };
writeFileSync(join(DIR, 'plan.json'), JSON.stringify(plan));
const srt = (x) => { const ms = Math.round(x * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
writeFileSync(`${OUT}.srt`, subs.map((s, i) => `${i + 1}\n${srt(s.o0)} --> ${srt(s.o1)}\n${s.text}\n`).join('\n'));

const holds = segments.filter((s) => s.kind === 'hold');
const fmt = (x) => { const s = Math.round(x); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
console.log(`${fmt(total)} in all · ${cuts.length} cuts (${Math.round(cuts.reduce((a, c) => a + c.s1 - c.s0, 0))} s removed) · ${holds.length} holds (${holds.reduce((a, h) => a + h.o1 - h.o0, 0).toFixed(1)} s)`);
for (const h of holds) if (h.o1 - h.o0 > 1.5) console.log(`  hold ${(h.o1 - h.o0).toFixed(1)} s at ${fmt(h.o0)}`);
if (args.includes('--plan')) process.exit(0); // the timing above is all that was asked for

// ---- Render: a page draws the plan on a canvas in real time and records it.
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
let outFile = null;
let finished;
const done = new Promise((r) => { finished = r; });
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const data = Buffer.concat(parts);
      if (path === '/start') { outFile = `${OUT}${data.toString().startsWith('video/mp4') ? '.mp4' : '.webm'}`; writeFileSync(outFile, ''); }
      else if (path === '/chunk') appendFileSync(outFile, data);
      else if (path === '/done') finished();
      res.end('ok');
    });
    return;
  }
  const file = path === '/' ? null : path === '/leash.svg' ? join(ROOT, 'app', 'public', 'leash.svg') : path === '/plan.json' ? join(DIR, 'plan.json')
    : /^\/(frames|voice)\/[\w.-]+$/.test(path) ? join(DIR, path) : null;
  if (path === '/') { res.setHeader('content-type', 'text/html'); return res.end(page()); }
  if (!file || !existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launch({ width: tl.width, height: tl.height, scale: 1, port: 9336, args: ['--autoplay-policy=no-user-gesture-required'] });
await browser.S('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
console.log(`recording ${fmt(total)} in real time…`);
let last = 0;
while (!(await browser.js('return !!window.__done || !!window.__error'))) {
  await sleep(2000);
  const p = await browser.js('return window.__progress ?? 0');
  if (Date.now() - last > 20000) { console.log(`  ${Math.round(p * 100)} %`); last = Date.now(); }
}
const err = await browser.js('return window.__error ?? null');
if (err) { browser.close(); server.close(); throw new Error(`composer page: ${err}`); }
await done;
browser.close();
server.close();
console.log(`→ ${outFile} (${(readFileSync(outFile).length / 1e6).toFixed(1)} MB) and ${OUT}.srt`);

// Declared as a function so that the server, which starts above, can already serve it.
function page() {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<canvas id="c"></canvas>
<script type="module">
window.onerror = (m) => { window.__error = String(m); };
window.onunhandledrejection = (e) => { window.__error = String(e.reason?.stack ?? e.reason); };
const plan = await (await fetch('plan.json')).json();
const { width: W, height: H, frames, segments, subs, rings, captions, spots, total } = plan;
// Everything is drawn in capture pixels; a preview scales the whole canvas down once.
const S = ${PREVIEW ? '2 / 3' : '1'};
const cv = document.getElementById('c'); cv.width = Math.round(W * S); cv.height = Math.round(H * S);
const g = cv.getContext('2d');
g.setTransform(S, 0, 0, S, 0, 0);
const C = { bg: '#0b0d10', panel: '#12161b', line: '#232b35', text: '#e7ecf2', muted: '#8a96a3', accent: '#f5a524' };
const FONT = '"Segoe UI", system-ui, sans-serif';
const logo = new Image(); logo.src = 'leash.svg'; await logo.decode().catch(() => {});

const ac = new AudioContext({ sampleRate: 48000 }); await ac.resume();
const dest = ac.createMediaStreamDestination();
const voice = await Promise.all(subs.map(async (s) => s.audio ? ac.decodeAudioData(await (await fetch(s.audio)).arrayBuffer()) : null));

// Frames decode a little ahead of the playhead; a frame not ready yet leaves the previous one on screen.
const cache = new Map();
function want(i) {
  if (i < 0 || i >= frames.length || cache.has(i)) return;
  const e = {}; cache.set(i, e);
  e.p = fetch('frames/' + frames[i].file).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((b) => { e.bmp = b; });
}
function frameAt(s) { let lo = 0, hi = frames.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= s) lo = m; else hi = m - 1; } return lo; }
let segIdx = 0;
function segAt(o) { while (segIdx < segments.length - 1 && o >= segments[segIdx].o1) segIdx++; return segments[segIdx]; }
function srcAt(seg, o) { return seg.kind === 'hold' ? seg.s : seg.s0 + (o - seg.o0); }
function frameFor(o) { let k = segIdx; while (k < segments.length - 1 && o >= segments[k].o1) k++; const s = segments[k]; return s.kind === 'card' ? -1 : frameAt(srcAt(s, Math.min(o, s.o1))); }
let shown = null;

function wrap(text, max) { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
function rrect(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
const clamp = (x) => Math.max(0, Math.min(1, x));

function drawCard(seg, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.globalAlpha = clamp((o - seg.o0) / 0.6) * clamp((seg.o1 - o) / 0.5);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const L = seg.lines;
  if (seg.id === 'title') {
    g.drawImage(logo, W / 2 - 60, 250, 120, 120);
    g.fillStyle = C.text; g.font = '700 150px ' + FONT; g.letterSpacing = '14px'; g.fillText(L.big, W / 2 + 7, 560); g.letterSpacing = '0px';
    g.font = '400 50px ' + FONT; g.fillText(L.tag.charAt(0).toUpperCase() + L.tag.slice(1), W / 2, 660);
    g.fillStyle = C.muted; g.font = '400 28px ' + FONT; g.fillText(L.foot, W / 2, 900);
  } else {
    g.drawImage(logo, W / 2 - 40, 150, 80, 80);
    g.fillStyle = C.text; g.font = '700 90px ' + FONT; g.letterSpacing = '10px'; g.fillText(L.big, W / 2 + 5, 340); g.letterSpacing = '0px';
    g.font = '600 52px ' + FONT;
    g.fillStyle = C.text; L.stats.forEach((s, i) => g.fillText(s, W / 2, 470 + i * 80));
    let y = 470 + L.stats.length * 80 + 30;
    if (L.repo) { g.fillStyle = C.accent; g.font = '500 40px ' + FONT; g.fillText(L.repo, W / 2, y); y += 70; }
    g.fillStyle = C.muted; g.font = '400 36px ' + FONT; g.fillText(L.tag.charAt(0).toUpperCase() + L.tag.slice(1), W / 2, Math.max(y + 40, 900));
  }
  g.globalAlpha = 1;
}

function render(o) {
  const seg = segAt(o);
  const sp = seg.kind === 'card' ? null : spots.findLast((x) => o >= x.o0 && o < x.o1);
  if (seg.kind === 'card') drawCard(seg, o);
  else {
    const i = frameAt(srcAt(seg, o));
    for (let k = 0; k <= 24; k++) want(frameFor(o + k * 0.1));
    const e = cache.get(i);
    if (e?.bmp && shown?.i !== i) { shown = { i, bmp: e.bmp }; for (const [j, x] of cache) if (j < i && x.bmp) { x.bmp.close(); cache.delete(j); } }
    if (shown) g.drawImage(shown.bmp, 0, 0, W, H); else { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
    // Footage fades in after a card and out before one.
    const prev = segments[segments.indexOf(seg) - 1], next = segments[segments.indexOf(seg) + 1];
    let fade = 0;
    if (prev?.kind === 'card') fade = Math.max(fade, 1 - clamp((o - seg.o0) / 0.4));
    if (next?.kind === 'card') fade = Math.max(fade, 1 - clamp((seg.o1 - o) / 0.4));
    if (fade) { g.fillStyle = 'rgba(0,0,0,' + fade + ')'; g.fillRect(0, 0, W, H); }
    // Spotlight: dim the page around what the sentence is about.
    if (sp) {
      const a = clamp((o - sp.o0) / 0.25) * clamp((sp.o1 - o) / 0.25);
      const k = sp.to ? clamp((o - sp.ot) / 0.3) : 0;
      const r = Object.fromEntries(['x', 'y', 'w', 'h'].map((p) => [p, sp.rect[p] + k * ((sp.to?.[p] ?? 0) - sp.rect[p])]));
      const x = Math.max(4, r.x - 10), y = Math.max(4, r.y - 10);
      const w = Math.min(W - 4, r.x + r.w + 10) - x, h = Math.min(H - 4, r.y + r.h + 10) - y;
      g.fillStyle = 'rgba(0,0,0,' + (0.6 * a) + ')';
      g.beginPath(); g.rect(0, 0, W, H); g.roundRect(x, y, w, h, 14); g.fill('evenodd');
      g.globalAlpha = a; g.strokeStyle = C.accent; g.lineWidth = 3; rrect(x, y, w, h, 14); g.stroke(); g.globalAlpha = 1;
    }
  }
  for (const r of rings) {
    const p = (o - r.o) / 0.9; if (p < 0 || p > 1) continue;
    g.strokeStyle = C.accent; g.globalAlpha = 1 - p; g.lineWidth = 5;
    g.beginPath(); g.arc(r.x, r.y, 18 + 36 * p, 0, Math.PI * 2); g.stroke();
    g.fillStyle = C.accent; g.beginPath(); g.arc(r.x, r.y, 8, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  }
  for (const c of captions) {
    if (o < c.o0 || o > c.o1) continue;
    g.globalAlpha = clamp((o - c.o0) / 0.2) * clamp((c.o1 - o) / 0.3);
    g.font = '600 26px ' + FONT; const w = g.measureText(c.text).width + 44;
    g.fillStyle = 'rgba(11,13,16,0.92)'; g.strokeStyle = C.accent; g.lineWidth = 2;
    // In the middle of the console's header bar, which is empty there: clear of the page and of subtitles moved to the top.
    rrect(W / 2 - w / 2, 12, w, 50, 25); g.fill(); g.stroke();
    g.fillStyle = C.accent; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.text, W / 2, 38); g.globalAlpha = 1;
  }
  const s = subs.find((x) => o >= x.o0 && o < x.o1);
  if (s) {
    g.globalAlpha = clamp((o - s.o0) / 0.12) * clamp((s.o1 - o) / 0.12);
    g.font = '500 38px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    const ls = wrap(s.text, 1500); const lh = 52; const w = Math.max(...ls.map((l) => g.measureText(l).width)) + 56; const h = ls.length * lh + 28;
    // Subtitles sit at the bottom, or at the top when the bottom would hide the spotlit box.
    let y = H - 56 - h;
    if (sp && sp.rect.y + sp.rect.h > y - 10 && sp.rect.y > 100 + h + 10) y = 100;
    g.fillStyle = 'rgba(0,0,0,0.8)'; rrect(W / 2 - w / 2, y, w, h, 14); g.fill();
    g.fillStyle = '#fff'; ls.forEach((l, k) => g.fillText(l, W / 2, y + 14 + lh / 2 + k * lh)); g.globalAlpha = 1;
  }
}

for (let k = 0; k <= 30; k++) want(frameFor(k * 0.1));
await Promise.all([...cache.values()].map((e) => e.p));
render(0);
const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus'].find((t) => MediaRecorder.isTypeSupported(t));
await fetch('start', { method: 'POST', body: mime });
const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: ${PREVIEW ? '1.1e6' : '10e6'}, audioBitsPerSecond: ${PREVIEW ? '96e3' : '160e3'} });
let chain = Promise.resolve();
rec.ondataavailable = (e) => { if (e.data.size) { const b = e.data; chain = chain.then(() => fetch('chunk', { method: 'POST', body: b })); } };
rec.onstop = () => chain.then(() => fetch('done', { method: 'POST' })).then(() => { window.__done = true; });
rec.start(1000);
// The audio clock drives the picture, so the voice cannot drift from it.
const at = ac.currentTime + 0.3;
subs.forEach((s, i) => { if (!voice[i]) return; const n = ac.createBufferSource(); n.buffer = voice[i]; n.connect(dest); n.start(at + s.o0); });
function tick() {
  const o = ac.currentTime - at;
  window.__progress = Math.max(0, o) / total;
  if (o > total + 0.3) { rec.stop(); return; }
  render(Math.max(0, Math.min(o, total - 0.001)));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script>`;
}
