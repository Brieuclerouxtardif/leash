// Cuts the launch video of docs/VIDEO-LAUNCH.md from a record-launch.mjs capture, inside a headless browser (no
// ffmpeg): the generated hook picture with a push-in, word cards, and the real product in a window with zooms on what
// each line is about. Transaction waits are cut and labelled. Silent unless --voice-dir; the voice-over goes to an .srt.
// Usage: node scripts/compose-launch.mjs <captureDir> [--plan] [--guide] [--voice-dir <dir>] [--hook <png>] [--out <file without extension>]
//   --plan       print the timing and stop
//   --guide      burn the voice-over as subtitles, to read along while recording the voices
//   --voice-dir  clips v01.wav … v13.wav, one per row of the table, each starting with its shot
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
if (!args[0] || args[0].startsWith('--')) { console.error('usage: node scripts/compose-launch.mjs <captureDir> [--plan] [--guide] [--voice-dir <dir>]'); process.exit(2); }
const DIR = resolve(args[0]);
const GUIDE = args.includes('--guide');
const VOICE_DIR = opt('--voice-dir') ? resolve(opt('--voice-dir')) : null;
// The one generated picture (Higgsfield, Cinema Studio Image 2.5): a metaphor, never shown as the product.
const HOOK = resolve(opt('--hook') ?? join(ROOT, 'docs', 'screens', 'launch-hook-generated.png'));
const OUT = resolve(opt('--out') ?? join(DIR, GUIDE ? 'leash-launch-guide' : VOICE_DIR ? 'leash-launch-voiced' : 'leash-launch'));
const REPO = 'github.com/Brieuclerouxtardif/leash';

// ---- The table of docs/VIDEO-LAUNCH.md: shot id, words on screen, voice-over.
const rows = readFileSync(join(ROOT, 'docs', 'VIDEO-LAUNCH.md'), 'utf8').split('\n')
  .filter((l) => /^\| \d+ \| \w+ \|/.test(l))
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
  .map(([n, id, , screen, vo]) => ({ n: Number(n), id, screen: screen ? screen.split(' / ') : [], vo: vo.replace(/^"|"$/g, '') }));
const tl = JSON.parse(readFileSync(join(DIR, 'timeline.json'), 'utf8'));
if (tl.error) throw new Error(`the capture failed: ${tl.error}`);
// The pay shot says "Live model": a take whose answer was replayed from a recording cannot be cut into it.
if (!/^live model/.test(tl.sources?.pay ?? '')) throw new Error(`the bill was read by "${tl.sources?.pay ?? 'unknown'}", not the live model: record again (scripts/take-lines.mjs gives fresh words)`);
for (const [scene, label] of Object.entries(tl.sources)) if (!/^live model/.test(label ?? '')) console.log(`  ${scene}: read by "${label}", not live`);
const T0 = tl.frames[0].t;
const sec = (t) => (t - T0) / 1000;
const frames = tl.frames.map((f) => ({ file: f.file, t: sec(f.t) }));
const marks = tl.marks.map((m) => ({ ...m, t: sec(m.t) }));
const sceneAt = (id) => marks.find((m) => m.kind === 'scene' && m.id === id);
const sceneEnd = (id) => { const i = marks.indexOf(sceneAt(id)); return marks.slice(i + 1).find((m) => m.kind === 'scene' || m.kind === 'end').t; };
const inScene = (id) => { const a = sceneAt(id).t, b = sceneEnd(id); return marks.filter((m) => m.t >= a && m.t <= b); };
const beat = (id, what) => inScene(id).find((m) => m.kind === 'beat' && m.what === what);
const clickOf = (id, label) => inScene(id).find((m) => m.kind === 'click' && m.label === label);
// A scene that opens another page has no frames while it loads: it starts on its first new frame.
const firstFrame = (id) => frames.find((f) => f.t > sceneAt(id).t)?.t ?? sceneAt(id).t;

// Typing a line plays at 2.5 times its speed, up to the click on Send.
const typing = (id) => [[sceneAt(id).t, clickOf(id, 'send').t, 2.5]];
// Blockscout's decoded box, with the row labels on its left and the Failed status above it, up to the payee's address.
const withLabels = (b) => ({ ...b, rect: { x: b.rect.x - 240, y: b.rect.y - 50, w: Math.min(b.rect.w + 240, 1040), h: b.rect.h + 50 } });

// What each capture shot shows: a source range, and the boxes the camera moves to (null: the whole page).
const PICTURE = {
  door: () => ({ a: sceneAt('door').t, b: clickOf('door', 'enter').t + 2.4, cams: [], full: true }),
  hero: () => ({ a: sceneAt('hero').t - 0.2, b: sceneEnd('hero'), cams: [[0.3, beat('hero', 'hero')]] }),
  pay: () => ({ a: sceneAt('pay').t, b: sceneEnd('pay'), fast: typing('pay'), cams: [['paid', beat('pay', 'paid')], ['reach', beat('pay', 'reach')]] }),
  scam: () => ({ a: sceneAt('scam').t, b: sceneEnd('scam'), cams: [['no', beat('scam', 'no')]] }),
  hijack: () => ({ a: sceneAt('hijack').t, b: sceneEnd('hijack'), cams: [['coral', beat('hijack', 'coral')], ['send', null], ['refused', beat('hijack', 'refused')]] }),
  blockscout: () => (beat('blockscout', 'decoded')?.rect ? { a: (clickOf('blockscout', 'revert')?.t ?? beat('blockscout', 'decoded').t - 1) - 1.4, b: sceneEnd('blockscout'), cams: [['decoded', withLabels(beat('blockscout', 'decoded'))]] } : null),
  mandate: () => ({ a: sceneAt('mandate').t, b: sceneEnd('mandate'), fast: typing('mandate'), cams: [['sentence', beat('mandate', 'sentence')], ['paid', beat('mandate', 'paid')]] }),
  kill: () => ({ a: sceneAt('kill').t, b: clickOf('kill', 'unpause').t - 0.2, cams: [['zero', beat('kill', 'zero')]] }),
  readme: () => ({ a: firstFrame('readme'), b: sceneEnd('readme'), cams: [['section', beat('readme', 'section')], ['key', beat('readme', 'key')]] }),
};
const CARD = { hook: 6, problem: 5.5, how: 9, end: 7 };

// ---- Voice-over lengths: the recorded clips, or an estimate at 2.6 words a second.
function wavSeconds(file) {
  const b = readFileSync(file);
  let p = 12, rate = 48000, ch = 1, bits = 16;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') return size / (rate * ch * bits / 8);
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: no data chunk`);
}
const clip = (n) => (VOICE_DIR ? join(VOICE_DIR, `v${String(n).padStart(2, '0')}.wav`) : null);
const voLen = (r) => (clip(r.n) && existsSync(clip(r.n)) ? wavSeconds(clip(r.n)) : r.vo.split(/\s+/).length / 2.6);
if (VOICE_DIR) for (const r of rows) if (!existsSync(clip(r.n))) console.log(`  no ${clip(r.n)}: shot ${r.id} is timed on an estimate`);

// ---- The plan: each shot's place on the output clock.
const shots = [];
let o = 0;
for (const r of rows) {
  const need = r.vo ? voLen(r) + 0.6 : 0;
  if (CARD[r.id]) {
    const d = Math.max(CARD[r.id], need);
    shots.push({ id: r.id, kind: 'card', o0: o, o1: o + d, lines: r.screen, vo: r.vo, n: r.n });
    o += d;
    continue;
  }
  const p = PICTURE[r.id]?.();
  if (!p) { console.log(`  shot ${r.id}: nothing usable in the capture, skipped`); continue; }
  // Waits longer than 1.5 s are cut, keeping a moment at each end.
  const waits = [];
  for (const m of marks.filter((x) => x.kind === 'wait-start' && x.t >= p.a && x.t <= p.b)) {
    const e = marks.find((x) => x.kind === 'wait-end' && x.what === m.what && x.t >= m.t);
    if (e && e.t - m.t > 1.5) waits.push([m.t + 0.7, e.t - 0.4]);
  }
  // The source ranges kept, each with its speed k: waits cut out, typing played faster.
  const split = (ranges, f0, f1, inside) => ranges.flatMap(([s0, s1, k]) => (f1 <= s0 || f0 >= s1 ? [[s0, s1, k]]
    : [...(f0 > s0 ? [[s0, f0, k]] : []), ...inside(Math.max(s0, f0), Math.min(s1, f1), k), ...(f1 < s1 ? [[f1, s1, k]] : [])]));
  let ranges = [[p.a, p.b, 1]];
  for (const [f0, f1, k] of p.fast ?? []) ranges = split(ranges, f0, f1, (x0, x1) => [[x0, x1, k]]);
  for (const [c0, c1] of waits) ranges = split(ranges, c0, c1, () => []);
  const pieces = [];
  const badges = [];
  let oo = o;
  ranges.forEach(([s0, s1, k], i) => {
    const gap = i ? s0 - ranges[i - 1][1] : 0;
    if (gap > 0.01) badges.push({ o0: oo, o1: oo + 1.8, text: `${Math.round(gap + 1.1)} s of waiting cut` });
    pieces.push({ o0: oo, o1: oo + (s1 - s0) / k, s0, k });
    oo += (s1 - s0) / k;
  });
  const toOut = (t) => { for (const q of pieces) if (t <= q.s0 + (q.o1 - q.o0) * q.k) return q.o0 + Math.max(0, t - q.s0) / q.k; return oo; };
  const hold = Math.max(0, need - (oo - o));
  const cams = p.cams.map(([k, b]) => ({ o: typeof k === 'number' ? o + k : toOut(b?.t ?? marks.find((m) => m.kind === 'click' && m.label === k && m.t >= p.a)?.t ?? p.a), rect: b?.rect ?? null }));
  const clicks = marks.filter((m) => m.kind === 'click' && m.t >= p.a && m.t <= p.b && m.x != null).map((m) => ({ o: toOut(m.t), x: m.x, y: m.y }));
  shots.push({ id: r.id, kind: 'capture', full: !!p.full, o0: o, o1: oo + hold, pieces, hold: hold ? { o0: oo, s: p.b } : null, cams, clicks, badges, lines: r.screen, vo: r.vo, n: r.n });
  o = oo + hold;
}
const total = o;
const subs = shots.filter((x) => x.vo).map((x) => ({ o0: x.o0 + 0.25, o1: Math.min(x.o1, x.o0 + 0.25 + voLen(rows.find((r) => r.n === x.n))), text: x.vo, audio: clip(x.n) && existsSync(clip(x.n)) ? `voice/v${String(x.n).padStart(2, '0')}.wav` : null }));
const srt = (x) => { const ms = Math.round(x * 1000); const p = (v, n = 2) => String(v).padStart(n, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
writeFileSync(`${OUT}.srt`, subs.map((x, i) => `${i + 1}\n${srt(x.o0)} --> ${srt(x.o1)}\n${x.text}\n`).join('\n'));
const UNTIL = opt('--until') ? Number(opt('--until')) : total;
writeFileSync(join(DIR, 'launch-plan.json'), JSON.stringify({ W: tl.width, H: tl.height, frames, shots, subs, total, until: Math.min(UNTIL, total), guide: GUIDE, repo: REPO, mbps: Number(opt('--mbps') ?? 8) }));

const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
for (const x of shots) console.log(`${fmt(x.o0)}  ${x.id.padEnd(10)} ${(x.o1 - x.o0).toFixed(1).padStart(5)} s${x.hold ? `  (holds ${(x.o1 - x.hold.o0).toFixed(1)} s for the voice)` : ''}${x.badges?.length ? `  ${x.badges.map((b) => b.text).join(', ')}` : ''}`);
console.log(`${fmt(total)} in all → ${OUT}.srt`);
if (args.includes('--plan')) process.exit(0);

// ---- Render in real time on a canvas, recorded by the page.
const TYPES = { '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };
let outFile = null, finished;
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
  if (path === '/') { res.setHeader('content-type', 'text/html'); return res.end(page()); }
  const file = path === '/plan.json' ? join(DIR, 'launch-plan.json') : path === '/hook.png' ? HOOK : path === '/leash.svg' ? join(ROOT, 'app', 'public', 'leash.svg')
    : /^\/frames\/[\w.-]+$/.test(path) ? join(DIR, path) : VOICE_DIR && /^\/voice\/v\d\d\.wav$/.test(path) ? join(VOICE_DIR, path.slice(7)) : null;
  if (!file || !existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launch({ width: tl.width, height: tl.height, scale: 1, port: 9338, args: ['--autoplay-policy=no-user-gesture-required'] });
await browser.S('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
console.log(`recording ${fmt(total)} in real time…`);
let shownAt = 0;
while (!(await browser.js('return !!window.__done || !!window.__error'))) {
  await sleep(2000);
  const at = await browser.js('return window.__progress ?? 0');
  if (at - shownAt >= 15) { shownAt = at; console.log(`  ${fmt(at)}`); }
}
const err = await browser.js('return window.__error ?? null');
if (process.env.LAUNCH_DEBUG) console.log('chunks', await browser.js('return JSON.stringify(window.__chunks)'), 'track', await browser.js('return JSON.stringify({ muted: window.__track?.muted, state: window.__track?.readyState })'));
browser.close();
server.close();
if (err) throw new Error(`composer page: ${err}`);
await done;
console.log(`→ ${outFile} (${(statSync(outFile).size / 1e6).toFixed(1)} MB)`);

function page() {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<canvas id="c"></canvas>
<script type="module">
window.onerror = (m) => { window.__error = String(m); };
window.onunhandledrejection = (e) => { window.__error = String(e.reason?.stack ?? e.reason); };
const P = await (await fetch('plan.json')).json();
const { W, H, frames, shots, subs, total } = P;
const cv = document.getElementById('c'); cv.width = W; cv.height = H;
const g = cv.getContext('2d');
// The app's own colours.
const C = { bg: '#0f1f10', surface: '#162a17', deep: '#0a150b', ink: '#ffffff', muted: '#a3ada3', accent: '#c6f19d', accentInk: '#0f1f10', coral: '#ff7a66' };
const FONT = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const img = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
const hook = await img('hook.png');
const logo = await img('leash.svg');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);

const ac = new AudioContext({ sampleRate: 48000 }); await ac.resume();
const dest = ac.createMediaStreamDestination();
// A steady silence: with no voice the audio track stays empty, and the MP4 muxer waits for it and drops the picture.
const hush = ac.createConstantSource(); hush.offset.value = 0; hush.connect(dest); hush.start();
const voice = await Promise.all(subs.map(async (s) => s.audio ? ac.decodeAudioData(await (await fetch(s.audio)).arrayBuffer()) : null));

// Frames decode a little ahead of the playhead.
const cache = new Map();
function want(i) { if (i < 0 || i >= frames.length || cache.has(i)) return; const e = {}; cache.set(i, e); e.p = fetch('frames/' + frames[i].file).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((b) => { e.bmp = b; }); }
function frameAt(s) { let lo = 0, hi = frames.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= s) lo = m; else hi = m - 1; } return lo; }
const shotAt = (o) => shots.find((x) => o >= x.o0 && o < x.o1) ?? shots.at(-1);
function srcAt(x, o) { if (x.hold && o >= x.hold.o0) return x.hold.s; const q = x.pieces.find((p) => o < p.o1) ?? x.pieces.at(-1); return q.s0 + (Math.min(o, q.o1) - q.o0) * q.k; }
let shown = null;

// Big words, rising into place a line at a time.
function words(lines, x, y, size, o, color, width, gap = 1.25) {
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = '700 ' + size + 'px ' + FONT;
  let yy = y;
  for (const l of lines) {
    const a = out((o - l.o) / 0.45);
    if (a <= 0) { yy += wrap(l.text, width).length * size * gap; continue; }
    g.globalAlpha = a; g.fillStyle = l.color ?? color;
    for (const t of wrap(l.text, width)) { g.fillText(t, x, yy + (1 - a) * 28); yy += size * gap; }
    yy += size * 0.25;
  }
  g.globalAlpha = 1;
}
function wrap(text, max) { const r = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { r.push(line); line = w; } else line = t; } if (line) r.push(line); return r; }
const stagger = (x, first, step, colors = []) => x.lines.map((text, k) => ({ text, o: x.o0 + first + k * step, color: colors[k] }));

function drawHook(x, o) {
  const t = o - x.o0, d = x.o1 - x.o0;
  // A slow push-in toward the robot, and a jolt when the leash bites.
  const z = 1.02 + 0.1 * ease(t / d);
  const jolt = t > 1.3 && t < 2.0 ? Math.sin((t - 1.3) * 42) * 16 * (1 - (t - 1.3) / 0.7) : 0;
  const w = W * z, h = w * hook.height / hook.width;
  g.drawImage(hook, (W - w) * 0.46 + jolt, (H - h) * 0.6, w, h);
  // The words sit in the empty dark of the upper right, clear of the robot and the leash.
  const gr = g.createLinearGradient(W * 0.5, 0, W, 0); gr.addColorStop(0, 'rgba(10,21,11,0)'); gr.addColorStop(1, 'rgba(10,21,11,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  words(stagger(x, 0.4, 2.0, [C.ink, C.accent]), 1150, 200, 64, o, C.ink, 720);
}
function drawProblem(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  words(stagger(x, 0.3, 1.25, [C.ink, C.ink, C.coral]), 160, 400, 120, o, C.ink, 1700, 1.15);
}
function drawHow(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const n = x.lines.length, bw = 440, bh = 300, gapX = 130, x0 = (W - n * bw - (n - 1) * gapX) / 2, y0 = 300;
  x.lines.forEach((line, k) => {
    const [who, ...verb] = line.split(' ');
    const a = out((o - x.o0 - 0.5 - k * 1.7) / 0.5); if (a <= 0) return;
    const bx = x0 + k * (bw + gapX), last = k === n - 1;
    g.globalAlpha = a;
    g.fillStyle = last ? C.accent : C.surface; g.fillRect(bx, y0 + (1 - a) * 30, bw, bh);
    g.fillStyle = last ? C.accentInk : C.ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '700 84px ' + FONT; g.fillText(who, bx + 40, y0 + 150 + (1 - a) * 30);
    g.fillStyle = last ? C.accentInk : C.muted; g.font = '500 50px ' + FONT; g.fillText(verb.join(' '), bx + 40, y0 + 230 + (1 - a) * 30);
    if (k) { g.strokeStyle = C.accent; g.lineWidth = 6; g.beginPath(); g.moveTo(bx - gapX + 24, y0 + bh / 2); g.lineTo(bx - 24, y0 + bh / 2); g.stroke();
      g.beginPath(); g.moveTo(bx - 44, y0 + bh / 2 - 18); g.lineTo(bx - 24, y0 + bh / 2); g.lineTo(bx - 44, y0 + bh / 2 + 18); g.stroke(); }
    g.globalAlpha = 1;
  });
  const a = out((o - x.o0 - 0.5 - n * 1.7) / 0.6);
  if (a > 0) { g.globalAlpha = a; g.fillStyle = C.muted; g.font = '500 44px ' + FONT; g.textAlign = 'center'; g.fillText('Only your payees  ·  inside your limits  ·  until the key expires', W / 2, 800); g.globalAlpha = 1; }
}
function drawEnd(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const a = out((o - x.o0) / 0.6); g.globalAlpha = a;
  g.drawImage(logo, W / 2 - 70, 190, 140, 140);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = C.ink;
  g.font = '700 150px ' + FONT; g.letterSpacing = '12px'; g.fillText('LEASH', W / 2 + 6, 500); g.letterSpacing = '0px';
  g.font = '600 64px ' + FONT; g.fillText(x.lines[0] ?? '', W / 2, 610);
  g.fillStyle = C.accent; g.font = '600 44px ' + FONT; g.fillText(P.repo, W / 2, 720);
  g.fillStyle = C.muted; g.font = '400 30px ' + FONT; g.fillText('Ethereum Sepolia testnet  ·  test tokens  ·  not audited  ·  FinTechathon 2026, Topic F', W / 2, 960);
  g.globalAlpha = 1;
}

// The product in a window, the words beside it; the camera moves inside the window to each box.
const WIN = { x: 600, y: 150, w: 1248, h: 702 };
function view(r) {
  if (!r) return { x: 0, y: 0, w: W };
  const w = Math.min(W, Math.max(W / 2.6, r.w / 0.84, (r.h / 0.8) * W / H));
  const h = w * H / W;
  return { x: Math.max(0, Math.min(W - w, r.x + r.w / 2 - w / 2)), y: Math.max(0, Math.min(H - h, r.y + r.h / 2 - h / 2)), w };
}
function cam(x, o) {
  let v = view(null);
  for (const c of x.cams) {
    if (o < c.o - 0.35) break;
    const to = view(c.rect), k = ease((o - c.o + 0.35) / 0.8);
    v = { x: v.x + (to.x - v.x) * k, y: v.y + (to.y - v.y) * k, w: v.w + (to.w - v.w) * k };
  }
  return v;
}
function drawCapture(x, o) {
  const i = frameAt(srcAt(x, o));
  for (let k = 0; k <= 20; k++) { const oo = Math.min(o + k * 0.1, x.o1 - 0.001); want(frameAt(srcAt(x, oo))); }
  const e = cache.get(i);
  if (e?.bmp && shown?.i !== i) { shown = { i, bmp: e.bmp }; for (const [j, y] of cache) if (j < i - 2 && y.bmp) { y.bmp.close(); cache.delete(j); } }
  const v = cam(x, o), vh = v.w * H / W;
  const box = x.full ? { x: 0, y: 0, w: W, h: H } : WIN;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (!x.full) { g.fillStyle = C.deep; g.fillRect(box.x + 14, box.y + 18, box.w, box.h); }
  g.save(); g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  if (shown) g.drawImage(shown.bmp, v.x, v.y, v.w, vh, box.x, box.y, box.w, box.h);
  // A ring where the click landed.
  const sx = box.w / v.w;
  for (const c of x.clicks) {
    const p = (o - c.o) / 0.8; if (p < 0 || p > 1) continue;
    const cx = box.x + (c.x - v.x) * sx, cy = box.y + (c.y - v.y) * sx;
    g.globalAlpha = 1 - p; g.strokeStyle = C.accent; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 16 + 34 * p, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  }
  g.restore();
  if (!x.full) { g.strokeStyle = 'rgba(198,241,157,0.35)'; g.lineWidth = 2; g.strokeRect(box.x, box.y, box.w, box.h); }
  for (const b of x.badges) {
    if (o < b.o0 || o > b.o1) continue;
    g.globalAlpha = clamp((o - b.o0) / 0.2) * clamp((b.o1 - o) / 0.3);
    g.font = '600 26px ' + FONT; const w = g.measureText('⏩  ' + b.text).width + 40;
    g.fillStyle = C.accent; g.fillRect(box.x + box.w - w - 20, box.y + 20, w, 48);
    g.fillStyle = C.accentInk; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('⏩  ' + b.text, box.x + box.w - w, box.y + 45); g.globalAlpha = 1;
  }
  // The last of several lines is the punchline, in the accent.
  const n = x.lines.length;
  if (!x.full && n) words(stagger(x, 0.3, Math.min(2.2, (x.o1 - x.o0) / (n + 1)), x.lines.map((_, k) => (n > 1 && k === n - 1 ? C.accent : C.ink))), 72, 330, 60, o, C.ink, 470);
  // In and out of a capture through the background colour.
  const f = Math.max(1 - clamp((o - x.o0) / 0.25), 1 - clamp((x.o1 - o) / 0.2));
  if (f > 0) { g.fillStyle = 'rgba(15,31,16,' + f + ')'; g.fillRect(0, 0, W, H); }
}

function render(o) {
  const x = shotAt(o);
  if (x.id === 'hook') drawHook(x, o);
  else if (x.id === 'problem') drawProblem(x, o);
  else if (x.id === 'how') drawHow(x, o);
  else if (x.id === 'end') drawEnd(x, o);
  else drawCapture(x, o);
  if (P.guide) {
    const s = subs.find((y) => o >= y.o0 && o < y.o1);
    if (s) { g.font = '500 36px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; const ls = wrap(s.text, 1500), lh = 48, w = Math.max(...ls.map((l) => g.measureText(l).width)) + 50, h = ls.length * lh + 24, y = H - 40 - h;
      g.fillStyle = 'rgba(0,0,0,0.82)'; g.fillRect(W / 2 - w / 2, y, w, h); g.fillStyle = '#fff'; ls.forEach((l, k) => g.fillText(l, W / 2, y + 12 + lh / 2 + k * lh)); }
  }
}

for (let k = 0; k <= 40; k++) { const x = shots.find((y) => y.kind === 'capture'); if (x) want(frameAt(srcAt(x, x.o0 + k * 0.1))); }
await Promise.all([...cache.values()].map((e) => e.p));
render(0);
const mime = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus'].find((t) => MediaRecorder.isTypeSupported(t));
await fetch('start', { method: 'POST', body: mime });
// Frames are pushed after each draw: a headless browser stops delivering a canvas stream's own frames after a second.
const vt = cv.captureStream(0).getVideoTracks()[0];
const stream = new MediaStream([vt, ...dest.stream.getAudioTracks()]);
window.__track = vt;
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: P.mbps * 1e6, audioBitsPerSecond: 160e3 });
let chain = Promise.resolve();
window.__chunks = [];
rec.ondataavailable = (e) => { window.__chunks.push(e.data.size); if (e.data.size) { const b = e.data; chain = chain.then(() => fetch('chunk', { method: 'POST', body: b })); } };
rec.onerror = (e) => { window.__error = 'recorder: ' + (e.error?.message ?? e.type); };
rec.onstop = () => chain.then(() => fetch('done', { method: 'POST' })).then(() => { window.__done = true; });
rec.start(1000);
const at = ac.currentTime + 0.3;
subs.forEach((s, i) => { if (!voice[i]) return; const n = ac.createBufferSource(); n.buffer = voice[i]; n.connect(dest); n.start(at + s.o0); });
function tick() {
  const o = ac.currentTime - at;
  window.__progress = o;
  if (o > P.until + 0.3) { rec.stop(); return; }
  render(Math.max(0, Math.min(o, total - 0.001)));
  vt.requestFrame();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script>`;
}
