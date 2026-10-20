// Cuts the launch video of docs/VIDEO-LAUNCH.md from a record-launch.mjs capture, inside a headless browser (no
// ffmpeg): the generated hook picture with a push-in, drawn cards, and the real product filling the screen while the
// camera moves to what each line is about. Transaction waits are cut and labelled. With --voice-dir the voice-over plays,
// captioned a phrase at a time as it is spoken; the captions also go to an .srt.
// Usage: node scripts/compose-launch.mjs <captureDir> [--plan] [--guide] [--voice-dir <dir>] [--hook <png>] [--out <file without extension>] [--until <s>] [--mbps <n>]
//   --plan       print the timing and stop
//   --guide      caption every shot, the cards too, to read along while recording voices
//   --voice-dir  clips v01.wav … v13.wav, one per row of the table, with the vNN.json that scripts/voice-prep.mjs writes
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
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
// The app shows the answer, and the payment or refusal with it, when the scene's first wait ends.
const waitEnd = (id) => inScene(id).find((m) => m.kind === 'wait-end').t;
// A scene that opens another page has no frames while it loads: it starts on its first new frame.
const firstFrame = (id) => frames.find((f) => f.t > sceneAt(id).t)?.t ?? sceneAt(id).t;

// Typing a line plays at 2.5 times its speed, up to the click on Send.
const typing = (id) => [[sceneAt(id).t, clickOf(id, 'send').t, 2.5]];

// ---- The camera's frames, in the capture's pixels: 16:9, x and y their top left corner, w their width.
const W = tl.width, H = tl.height;
const frame = (v) => { const w = Math.min(W, v.w), h = w * H / W; return { x: Math.max(0, Math.min(W - w, v.x)), y: Math.max(0, Math.min(H - h, v.y)), w }; };
// A box's frame: the box at 84 % of the width or 80 % of the height, never closer than 2.6 times.
const fit = (r) => { const w = Math.min(W, Math.max(W / 2.6, r.w / 0.84, (r.h / 0.8) * W / H)), h = w * H / W; return frame({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w }); };
const FULL = { x: 0, y: 0, w: W };
const HERO = frame({ x: 40, y: 120, w: 840 });    // the big number, its sentence and the vault
const CHAT = frame({ x: 29, y: 440, w: 1138 });   // the message, the agent's answer, Paid or Refused
const AGENT = frame({ x: 978, y: 130, w: 942 });  // the agent's square and the Hijack switch
const PAUSED = frame({ x: 20, y: 45, w: 1122 });  // the guardian's banner, $0 and the vault, above the captions
const DIALOG = fit({ x: 620, y: 385, w: 680, h: 308 });  // the owner's signature: the sentence and its two buttons
const TX = frame({ x: 172, y: 270, w: 1238 });    // Blockscout: the failed call, its decoded reason, the block
const README = frame({ x: 330, y: 0, w: 1400 });  // the README's column, the page's empty right for the words

// What each capture shot shows: a source range; the frames the camera moves to, each at a source time (a box given with
// it gets outlined); when each of its words on screen comes up, at a source time or {v: k} when the voice's phrase k
// starts, and where (chipY, chipLeft); how much of a wait it keeps before the answer (lead); and sync, to start the
// voice so that one of its phrases lands on a moment.
const PICTURE = {
  door: () => ({ a: sceneAt('door').t, b: clickOf('door', 'enter').t + 2.4, cams: [] }),
  hero: () => ({ a: sceneAt('hero').t - 0.2, b: sceneEnd('hero'), cams: [[sceneAt('hero').t + 0.3, HERO]], cues: [{ v: 1 }, { v: 1, d: 1.6 }] }),
  // The model answers as the voice says "our code checks it"; the camera pulls back to see the payment land everywhere at
  // once (the number counts down as the money leaves), then goes to the payment and its transaction.
  pay: () => ({ a: sceneAt('pay').t, b: sceneEnd('pay'), fast: typing('pay'), lead: 2.2,
    cams: [[sceneAt('pay').t + 0.3, CHAT], [waitEnd('pay') - 0.2, FULL], [beat('pay', 'paid').t + 2.1, CHAT, beat('pay', 'paid').rect]],
    cues: [{ v: 1 }, { v: 4 }] }),
  // The model thinks on screen until it says no, as the voice says it.
  scam: () => ({ a: sceneAt('scam').t, b: sceneEnd('scam'), lead: 3.3, cams: [[waitEnd('scam') - 0.2, CHAT, beat('scam', 'no').rect]],
    cues: [sceneAt('scam').t + 0.3, beat('scam', 'no').t] }),
  // The coral square thinks while the voice says the agent will sign anything; the refusal lands with "still says no".
  // Its words go on the left, clear of the square.
  hijack: () => ({ a: sceneAt('hijack').t, b: sceneEnd('hijack'), lead: 2.7, chipLeft: true,
    cams: [[beat('hijack', 'coral').t - 0.2, AGENT], [waitEnd('hijack') - 0.1, CHAT, beat('hijack', 'refused').rect]],
    cues: [beat('hijack', 'coral').t, beat('hijack', 'coral').t + 0.7, beat('hijack', 'refused').t] }),
  blockscout: () => {
    const d = beat('blockscout', 'decoded');
    if (!d?.rect) return null;
    const a = (clickOf('blockscout', 'revert')?.t ?? d.t - 1) - 1.4;
    // The whole page first (Sepolia, top left), then in. Outlined: Failed, the decoded PayeeNotAllowed and the address it refused.
    const proof = { x: d.rect.x - 6, y: d.rect.y - 53, w: 640, h: d.rect.h + 50 };
    return { a, b: sceneEnd('blockscout'), cams: [[a + 0.5, TX], [d.t, TX, proof]], cues: [{ v: 1 }, d.t] };
  },
  // From the answer (the school line shows in the chat): the voice's "on a sentence written by our code" lands on the sentence.
  mandate: () => {
    const s = beat('mandate', 'sentence'), sign = clickOf('mandate', 'sign').t, paid = beat('mandate', 'paid');
    return { a: waitEnd('mandate') - 0.4, b: paid.t + 2.2, cams: [[0, CHAT], [s.t - 0.2, DIALOG], [sign + 0.3, CHAT], [paid.t, CHAT, paid.rect]],
      cues: [s.t, sign + 0.3], sync: [s.t, 1] };
  },
  kill: () => ({ a: sceneAt('kill').t, b: clickOf('kill', 'unpause').t - 0.2, cams: [[beat('kill', 'zero').t - 0.6, PAUSED]], cues: [beat('kill', 'zero').t], chipY: 250 }),
  readme: () => {
    const k = beat('readme', 'key');
    return { a: firstFrame('readme'), b: Math.min(sceneEnd('readme'), k.t + 3), cams: [[0, README], [k.t, README, k.rect]], cues: [beat('readme', 'section').t, { v: 1 }] };
  },
};
const CARD = { hook: 6, problem: 5.5, how: 9, end: 7 };

// ---- The voice-over: the clips, or an estimate at 2.6 words a second.
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
const voiced = (r) => !!clip(r.n) && existsSync(clip(r.n));
const voLen = (r) => (voiced(r) ? wavSeconds(clip(r.n)) : r.vo.split(/\s+/).length / 2.6);
const voPauses = (r) => { const f = voiced(r) ? clip(r.n).replace(/\.wav$/, '.json') : null; return f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).pauses : []; };
if (VOICE_DIR) for (const r of rows) if (!voiced(r)) console.log(`  no ${clip(r.n)}: shot ${r.id} is timed on an estimate`);

// A line of voice-over cut at its punctuation, each phrase timed from the start of its clip. The voice pauses at most
// marks: marks and pauses are paired in order, nearest first (a mark the voice ran through, or a pause with no mark, costs
// as much as 0.9 s of error), and a mark left alone is placed between its neighbours by its characters.
function phrases(text, seconds, pauses) {
  const parts = text.split(/(?<=[.,:;?!])\s+/);
  const ends = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(' ').length);
  const est = ends.map((c) => (c / text.length) * seconds), mid = pauses.map(([a, b]) => (a + b) / 2);
  const SKIP = 0.9, D = est.map(() => []).concat([[]]);
  const pair = (i, j) => D[i - 1][j - 1] + Math.abs(est[i - 1] - mid[j - 1]);
  for (let i = 0; i <= est.length; i++) for (let j = 0; j <= mid.length; j++) {
    D[i][j] = i + j ? Infinity : 0;
    if (i && j) D[i][j] = Math.min(D[i][j], pair(i, j));
    if (i) D[i][j] = Math.min(D[i][j], D[i - 1][j] + SKIP);
    if (j) D[i][j] = Math.min(D[i][j], D[i][j - 1] + SKIP);
  }
  const t = [0, ...est.map(() => null)];
  for (let i = est.length, j = mid.length; i > 0;) {
    if (j && D[i][j] === pair(i, j)) { t[i] = pauses[j - 1][1]; i--; j--; } else if (D[i][j] === D[i - 1][j] + SKIP) i--; else j--;
  }
  const at = [0, ...ends.map((c) => c + 1)];
  for (let i = 1; i < t.length; i++) {
    if (t[i] != null) continue;
    let b = i + 1;
    while (b < t.length && t[b] == null) b++;
    const [tb, cb] = b < t.length ? [t[b], at[b]] : [seconds, text.length];
    t[i] = t[i - 1] + ((at[i] - at[i - 1]) / (cb - at[i - 1])) * (tb - t[i - 1]);
  }
  return parts.map((p, i) => ({ text: p, t: t[i] }));
}
// Captions: the phrases joined back into lines of up to 44 characters, never across two sentences.
function captionLines(segs) {
  const lines = [];
  for (const s of segs) {
    const last = lines.at(-1);
    if (last && !/[.?!]$/.test(last.text) && last.text.length + 1 + s.text.length <= 44) last.text += ` ${s.text}`;
    else lines.push({ ...s });
  }
  return lines;
}

// What each wait of the take waited for, said on the badge that replaces it.
const WAITED = { pay: 'the model and the blockchain', scam: 'the model', hijack: 'the model and the blockchain', ask: 'the model', mandate: 'the blockchain', pause: 'the blockchain', unpause: 'the blockchain' };

// ---- The plan: each shot's place on the output clock.
const shots = [];
let o = 0;
for (const r of rows) {
  const len = r.vo ? voLen(r) : 0, segs = r.vo ? phrases(r.vo, len, voPauses(r)) : [];
  const voice = (x, voAt) => Object.assign(x, { voAt, len, segs: segs.map((s) => ({ o: voAt + s.t, text: s.text })), audio: voiced(r) ? `voice/v${String(r.n).padStart(2, '0')}.wav` : null });
  if (CARD[r.id]) {
    const d = Math.max(CARD[r.id], r.vo ? len + 0.6 : 0);
    shots.push(voice({ id: r.id, kind: 'card', o0: o, o1: o + d, lines: r.screen, n: r.n }, o + 0.25));
    o += d;
    continue;
  }
  const p = PICTURE[r.id]?.();
  if (!p) { console.log(`  shot ${r.id}: nothing usable in the capture, skipped`); continue; }
  // Waits longer than 1.5 s are cut, keeping a moment after the click and before the answer.
  const waits = [];
  for (const m of marks.filter((x) => x.kind === 'wait-start' && x.t >= p.a && x.t <= p.b)) {
    const e = marks.find((x) => x.kind === 'wait-end' && x.what === m.what && x.t >= m.t);
    if (e && e.t - m.t > 1.5) waits.push([m.t + 0.7, e.t - (p.lead ?? 0.4), m.what]);
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
    if (gap > 0.01) {
      const w = waits.find(([c0]) => Math.abs(c0 - ranges[i - 1][1]) < 0.01);
      badges.push({ o0: oo, o1: oo + 3, text: `Skipped ${Math.round(gap)} s of waiting for ${WAITED[w?.[2]] ?? 'the blockchain'}` });
    }
    pieces.push({ o0: oo, o1: oo + (s1 - s0) / k, s0, k });
    oo += (s1 - s0) / k;
  });
  const toOut = (t) => { for (const q of pieces) if (t <= q.s0 + (q.o1 - q.o0) * q.k) return q.o0 + Math.max(0, t - q.s0) / q.k; return oo; };
  const voAt = p.sync ? Math.max(o + 0.25, toOut(p.sync[0]) + 0.15 - (segs[p.sync[1]]?.t ?? 0)) : o + 0.25;
  // A shot holds its last frame while its line runs long.
  const hold = Math.max(0, (r.vo ? voAt + len + 0.35 : o) - oo);
  const o1 = oo + hold;
  const cams = p.cams.map(([t, v, hl]) => ({ o: t <= p.a ? o : toOut(t), v, hl }));
  cams.forEach((c, i) => { if (c.hl) c.hl = { rect: c.hl, o0: c.o + 0.45, o1: (cams[i + 1]?.o ?? o1) - 0.3 }; });
  const clicks = marks.filter((m) => m.kind === 'click' && m.t >= p.a && m.t <= p.b && m.x != null).map((m) => ({ o: toOut(m.t), x: m.x, y: m.y }));
  const cueAt = (c, k) => (c == null ? o + 0.4 + k * 1.2 : typeof c === 'number' ? toOut(c) : voAt + (segs[c.v]?.t ?? 0) + (c.d ?? 0));
  const chips = r.screen.map((text, k) => ({ text, o: Math.min(o1 - 0.5, cueAt(p.cues?.[k], k)) }));
  shots.push(voice({ id: r.id, kind: 'capture', o0: o, o1, pieces, hold: hold ? { o0: oo, s: p.b } : null, cams, clicks, badges, chips, chipY: p.chipY ?? 72, chipLeft: !!p.chipLeft, lines: r.screen, n: r.n }, voAt));
  o = o1;
}
const total = o;
for (const x of shots) {
  const lines = captionLines(x.segs);
  x.caps = lines.map((c, i) => ({ text: c.text.replace(/\bLeash\b/g, 'LEASH'), o0: c.o - 0.05, o1: i + 1 < lines.length ? lines[i + 1].o - 0.05 : Math.min(x.o1 - 0.05, x.voAt + x.len + 0.3), fi: i === 0, fo: i === lines.length - 1 }));
}
const srt = (x) => { const ms = Math.round(x * 1000); const p = (v, n = 2) => String(v).padStart(n, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
writeFileSync(`${OUT}.srt`, shots.flatMap((x) => x.caps).map((c, i) => `${i + 1}\n${srt(c.o0)} --> ${srt(c.o1)}\n${c.text}\n`).join('\n'));
const UNTIL = opt('--until') ? Number(opt('--until')) : total;
writeFileSync(join(DIR, 'launch-plan.json'), JSON.stringify({ W, H, frames, shots, total, until: Math.min(UNTIL, total), guide: GUIDE, captions: !!VOICE_DIR, repo: REPO, mbps: Number(opt('--mbps') ?? 8) }));

const fmt = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
for (const x of shots) console.log(`${fmt(x.o0)}  ${x.id.padEnd(10)} ${(x.o1 - x.o0).toFixed(1).padStart(5)} s  voice ${(x.voAt - x.o0).toFixed(1)}–${(x.voAt - x.o0 + x.len).toFixed(1)}${x.hold ? `  (holds ${(x.o1 - x.hold.o0).toFixed(1)} s)` : ''}${x.badges?.length ? `  ${x.badges.map((b) => b.text).join(', ')}` : ''}`);
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
const browser = await launch({ width: W, height: H, scale: 1, port: 9338, args: ['--autoplay-policy=no-user-gesture-required'] });
await browser.S('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
console.log(`recording ${fmt(Math.min(UNTIL, total))} in real time…`);
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
const { W, H, frames, shots, total } = P;
const cv = document.getElementById('c'); cv.width = W; cv.height = H;
const g = cv.getContext('2d');
g.imageSmoothingQuality = 'high';
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
const voice = await Promise.all(shots.map(async (s) => (s.audio ? ac.decodeAudioData(await (await fetch(s.audio)).arrayBuffer()) : null)));

// Frames decode a little ahead of the playhead and are let go once it has passed them.
const cache = new Map();
let now = 0;
function want(i) { if (i < 0 || i >= frames.length) return; const old = cache.get(i); if (old) { old.used = now; return; } const e = { used: now }; cache.set(i, e); e.p = fetch('frames/' + frames[i].file).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((b) => { e.bmp = b; }); }
function frameAt(s) { let lo = 0, hi = frames.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m].t <= s) lo = m; else hi = m - 1; } return lo; }
const shotAt = (o) => shots.find((x) => o >= x.o0 && o < x.o1) ?? shots.at(-1);
function srcAt(x, o) { if (x.hold && o >= x.hold.o0) return x.hold.s; const q = x.pieces.find((p) => o < p.o1) ?? x.pieces.at(-1); return q.s0 + (Math.min(o, q.o1) - q.o0) * q.k; }
let shown = null;
// When the voice starts its phrase k (or a default delay into the shot, without a voice).
const cue = (x, k, d) => x.segs[k]?.o ?? x.o0 + d;

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

function drawHook(x, o) {
  const t = o - x.o0, d = x.o1 - x.o0, tj = cue(x, 1, 1.3) - x.o0;
  // A slow push-in toward the robot, and a jolt as the question lands.
  const z = 1.02 + 0.1 * ease(t / d);
  const jolt = t > tj && t < tj + 0.7 ? Math.sin((t - tj) * 42) * 16 * (1 - (t - tj) / 0.7) : 0;
  const w = W * z, h = w * hook.height / hook.width;
  g.drawImage(hook, (W - w) * 0.46 + jolt, (H - h) * 0.6, w, h);
  // The words sit in the empty dark of the upper right, clear of the robot and the leash.
  const gr = g.createLinearGradient(W * 0.5, 0, W, 0); gr.addColorStop(0, 'rgba(10,21,11,0)'); gr.addColorStop(1, 'rgba(10,21,11,0.55)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  words(x.lines.map((text, k) => ({ text, o: cue(x, k, 0.4 + 2 * k), color: k ? C.accent : C.ink })), 1150, 200, 64, o, C.ink, 720);
}

// The problem's three pictures, drawn around (0, 0): a poisoned message, a hacked server, an empty wallet.
function drop(x, y, r) {
  g.beginPath(); g.moveTo(x, y - r * 1.9);
  g.bezierCurveTo(x + r * 0.25, y - r * 1.1, x + r, y - r * 0.45, x + r, y + r * 0.1);
  g.arc(x, y + r * 0.1, r, 0, Math.PI);
  g.bezierCurveTo(x - r, y - r * 0.45, x - r * 0.25, y - r * 1.1, x, y - r * 1.9);
  g.fill();
}
function iconMessage(t) {
  g.lineWidth = 10; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.ink;
  const L = -140, T = -120, R = 140, B = 60, r = 30;
  g.beginPath(); g.moveTo(L + r, T); g.arcTo(R, T, R, B, r); g.arcTo(R, B, L, B, r); g.lineTo(-30, B); g.lineTo(-90, B + 58); g.lineTo(-80, B);
  g.arcTo(L, B, L, T, r); g.arcTo(L, T, R, T, r); g.closePath(); g.stroke();
  g.beginPath(); g.moveTo(-85, -60); g.lineTo(85, -60); g.stroke();
  // The poisoned line, dripping.
  g.strokeStyle = C.coral; g.beginPath(); g.moveTo(-85, -5); g.lineTo(45, -5); g.stroke();
  const f = (t * 0.8) % 1.5;
  g.fillStyle = C.coral; g.globalAlpha *= 1 - clamp((f - 1) / 0.5); drop(100, 105 + f * 70, 20);
}
function iconServer(t) {
  g.lineWidth = 10; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.ink;
  [-120, 5].forEach((y, k) => {
    g.beginPath(); g.roundRect(-150, y, 300, 100, 18); g.stroke();
    // Its lights blink coral: someone else is in.
    g.fillStyle = Math.floor(t * 3 + k * 0.5) % 2 ? 'rgba(255,122,102,0.3)' : C.coral;
    g.beginPath(); g.arc(-95, y + 50, 15, 0, Math.PI * 2); g.fill();
    g.beginPath(); for (const dx of [30, 65, 100]) { g.moveTo(dx, y + 30); g.lineTo(dx, y + 70); } g.stroke();
  });
  g.fillStyle = C.coral; g.beginPath(); g.moveTo(150, -175); g.lineTo(200, -90); g.lineTo(100, -90); g.closePath(); g.fill();
  g.fillStyle = C.bg; g.font = '800 54px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 150, -116);
}
function iconWallet() {
  g.lineWidth = 10; g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = C.coral; g.fillStyle = C.coral;
  g.beginPath(); g.moveTo(-120, -85); g.lineTo(70, -140); g.lineTo(95, -85); g.stroke();
  g.beginPath(); g.roundRect(-150, -85, 300, 195, 26); g.stroke();
  g.beginPath(); g.roundRect(55, -20, 95, 72, 16); g.stroke();
  g.beginPath(); g.arc(92, 16, 10, 0, Math.PI * 2); g.fill();
  g.font = '700 70px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$0', -45, 14);
}
function drawProblem(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const icons = [iconMessage, iconServer, iconWallet], n = x.lines.length;
  x.lines.forEach((text, k) => {
    const t0 = cue(x, k, 0.3 + 1.25 * k), a = out((o - t0) / 0.45); if (a <= 0) return;
    const cx = W / 2 + (k - 1) * 580, s = 0.9 + 0.1 * a;
    g.save(); g.globalAlpha = a; g.translate(cx, 430 + (1 - a) * 30); g.scale(s, s); icons[k]?.(o - t0); g.restore();
    g.globalAlpha = a; g.fillStyle = n > 1 && k === n - 1 ? C.coral : C.ink; g.font = '700 46px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(text, cx, 740 + (1 - a) * 20); g.globalAlpha = 1;
  });
}

function drawHow(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  // The vault: the money sits in a contract, which holds the agent's key to three rules.
  const a0 = out((o - cue(x, 0, 0.3)) / 0.5);
  if (a0 > 0) {
    const dy = (1 - a0) * 20;
    g.globalAlpha = a0; g.strokeStyle = C.accent; g.lineWidth = 4; g.beginPath(); g.roundRect(250, 110 + dy, 1420, 330, 18); g.stroke();
    g.fillStyle = C.accent; g.beginPath(); g.roundRect(310, 190 + dy, 64, 52, 8); g.fill();
    g.lineWidth = 9; g.beginPath(); g.arc(342, 190 + dy, 21, Math.PI, 0); g.stroke();
    g.fillStyle = C.ink; g.font = '700 58px ' + FONT; g.fillText('Your money sits in a smart contract', 410, 238 + dy);
    g.globalAlpha = 1;
  }
  ['Only your payees', 'Within your limits', 'Until the key expires'].forEach((rule, k) => {
    const a = out((o - cue(x, k + 1, 2 + 1.5 * k)) / 0.4); if (a <= 0) return;
    const bx = 276 + k * 464, by = 310 + (1 - a) * 16;
    g.globalAlpha = a; g.fillStyle = C.surface; g.beginPath(); g.roundRect(bx, by, 440, 88, 12); g.fill();
    g.strokeStyle = C.accent; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(bx + 30, by + 46); g.lineTo(bx + 44, by + 60); g.lineTo(bx + 68, by + 30); g.stroke();
    g.fillStyle = C.ink; g.font = '600 32px ' + FONT; g.fillText(rule, bx + 88, by + 56);
    g.globalAlpha = 1;
  });
  // Every payment: the model proposes, the code checks, the contract decides.
  const n = x.lines.length, bw = 440, bh = 250, gapX = 130, x0 = (W - n * bw - (n - 1) * gapX) / 2, y0 = 560;
  x.lines.forEach((line, k) => {
    const [who, ...verb] = line.split(' ');
    const a = out((o - cue(x, k + 4, 6 + 1.5 * k)) / 0.45); if (a <= 0) return;
    const bx = x0 + k * (bw + gapX), last = k === n - 1, dy = (1 - a) * 30;
    g.globalAlpha = a;
    g.fillStyle = last ? C.accent : C.surface; g.fillRect(bx, y0 + dy, bw, bh);
    g.fillStyle = last ? C.accentInk : C.ink; g.font = '700 84px ' + FONT; g.fillText(who, bx + 40, y0 + 130 + dy);
    g.fillStyle = last ? C.accentInk : C.muted; g.font = '500 50px ' + FONT; g.fillText(verb.join(' '), bx + 40, y0 + 205 + dy);
    if (k) { g.strokeStyle = C.accent; g.lineWidth = 6; g.beginPath(); g.moveTo(bx - gapX + 24, y0 + bh / 2); g.lineTo(bx - 24, y0 + bh / 2); g.stroke();
      g.beginPath(); g.moveTo(bx - 44, y0 + bh / 2 - 18); g.lineTo(bx - 24, y0 + bh / 2); g.lineTo(bx - 44, y0 + bh / 2 + 18); g.stroke(); }
    g.globalAlpha = 1;
  });
}

function drawEnd(x, o) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  // The hook's picture again, faint behind the name: the leash held.
  const hw = W * 1.1, hh = hw * hook.height / hook.width;
  g.globalAlpha = 0.13 * out((o - x.o0) / 1.5); g.drawImage(hook, (W - hw) / 2, (H - hh) / 2, hw, hh);
  const a = out((o - cue(x, 0, 0.2)) / 0.5), b = out((o - cue(x, 1, 1.2)) / 0.5), c = out((o - cue(x, 2, 2.2) - 0.3) / 0.6);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.globalAlpha = a; g.drawImage(logo, W / 2 - 70, 190 + (1 - a) * 20, 140, 140);
  g.fillStyle = C.ink; g.font = '700 150px ' + FONT; g.letterSpacing = '12px'; g.fillText('LEASH', W / 2 + 6, 500 + (1 - a) * 20); g.letterSpacing = '0px';
  g.globalAlpha = b; g.font = '600 64px ' + FONT; g.fillText(x.lines[0] ?? '', W / 2, 610 + (1 - b) * 16);
  g.globalAlpha = c; g.fillStyle = C.accent; g.font = '600 44px ' + FONT; g.fillText(P.repo, W / 2, 720);
  g.fillStyle = C.muted; g.font = '400 30px ' + FONT; g.fillText('Ethereum Sepolia testnet  ·  test tokens  ·  not audited  ·  FinTechathon 2026, Topic F', W / 2, 960);
  g.globalAlpha = 1;
}

// The product fills the screen; the camera eases from frame to frame, 0.35 s ahead of each moment.
function cam(x, o) {
  let v = { x: 0, y: 0, w: W };
  for (const c of x.cams) {
    if (c.o <= x.o0 + 0.01) { v = c.v; continue; }
    if (o < c.o - 0.35) break;
    const k = ease((o - c.o + 0.35) / 0.8);
    v = { x: v.x + (c.v.x - v.x) * k, y: v.y + (c.v.y - v.y) * k, w: v.w + (c.v.w - v.w) * k };
  }
  // A slow push-in keeps a still frame alive: 0.3 % a second, at most 2 %.
  const w = v.w * (1 - Math.min(0.02, 0.003 * (o - x.o0)));
  return { x: v.x + (v.w - w) / 2, y: v.y + (v.w - w) * H / W / 2, w };
}
function drawCapture(x, o) {
  const i = frameAt(srcAt(x, o));
  for (let k = 0; k <= 20; k++) { const oo = Math.min(o + k * 0.1, x.o1 - 0.001); want(frameAt(srcAt(x, oo))); }
  const e = cache.get(i);
  if (e?.bmp && shown?.i !== i) shown = { i, bmp: e.bmp };
  for (const [j, y] of cache) if (y.bmp && j !== shown?.i && now - y.used > 0.3) { y.bmp.close(); cache.delete(j); }
  const v = cam(x, o), s = W / v.w;
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (shown) g.drawImage(shown.bmp, v.x, v.y, v.w, v.w * H / W, 0, 0, W, H);
  // The box the line is about, outlined once the camera is there.
  for (const c of x.cams) {
    if (!c.hl || o < c.hl.o0 || o > c.hl.o1) continue;
    const r = c.hl.rect;
    g.save(); g.globalAlpha = clamp((o - c.hl.o0) / 0.35) * clamp((c.hl.o1 - o) / 0.25);
    g.strokeStyle = C.accent; g.lineWidth = 4; g.shadowColor = 'rgba(198,241,157,0.8)'; g.shadowBlur = 24;
    // Kept inside the screen when the box runs to the frame's edge.
    const x0 = Math.max(6, (r.x - 8 - v.x) * s), y0 = Math.max(6, (r.y - 8 - v.y) * s);
    const x1 = Math.min(W - 6, (r.x + r.w + 8 - v.x) * s), y1 = Math.min(H - 6, (r.y + r.h + 8 - v.y) * s);
    g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, 14); g.stroke(); g.restore();
  }
  // A ring where the click landed.
  for (const c of x.clicks) {
    const p = (o - c.o) / 0.8; if (p < 0 || p > 1) continue;
    g.globalAlpha = 1 - p; g.strokeStyle = C.accent; g.lineWidth = 5; g.beginPath(); g.arc((c.x - v.x) * s, (c.y - v.y) * s, 16 + 34 * p, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  }
  // Each cut wait, said at the top.
  for (const b of x.badges) {
    if (o < b.o0 || o > b.o1) continue;
    g.globalAlpha = clamp((o - b.o0) / 0.2) * clamp((b.o1 - o) / 0.3);
    g.font = '600 28px ' + FONT; const t = '⏩  ' + b.text, w = g.measureText(t).width + 44;
    g.fillStyle = C.accent; g.beginPath(); g.roundRect(W / 2 - w / 2, 28, w, 52, 10); g.fill();
    g.fillStyle = C.accentInk; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, W / 2, 55); g.globalAlpha = 1;
  }
  // The shot's words on screen, upper right (or left), one under the other, sliding in from the edge; the last of several
  // is the punchline.
  const n = x.chips.length;
  g.font = '600 32px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
  x.chips.forEach((c, k) => {
    const a = out((o - c.o) / 0.35); if (a <= 0) return;
    const last = n > 1 && k === n - 1, w = g.measureText(c.text).width + 48, y = x.chipY + k * 72;
    const cx = x.chipLeft ? 48 - (1 - a) * 30 : W - 48 - w + (1 - a) * 30;
    g.globalAlpha = a;
    g.fillStyle = last ? C.accent : 'rgba(10,21,11,0.92)'; g.beginPath(); g.roundRect(cx, y, w, 60, 12); g.fill();
    if (!last) { g.strokeStyle = 'rgba(198,241,157,0.55)'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = last ? C.accentInk : C.ink; g.fillText(c.text, cx + 24, y + 31);
    g.globalAlpha = 1;
  });
}

// The voice-over a phrase at a time, as it is spoken.
function caption(x, o) {
  const s = x.caps.find((c) => o >= c.o0 && o < c.o1); if (!s) return;
  g.font = '600 46px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  const ls = wrap(s.text, 1560), lh = 60, w = Math.max(...ls.map((l) => g.measureText(l).width)) + 60, h = ls.length * lh + 26, y = H - 60 - h;
  g.globalAlpha = (s.fi ? clamp((o - s.o0) / 0.15) : 1) * (s.fo ? clamp((s.o1 - o) / 0.2) : 1);
  g.fillStyle = 'rgba(6,12,7,0.8)'; g.beginPath(); g.roundRect(W / 2 - w / 2, y, w, h, 14); g.fill();
  g.fillStyle = '#ffffff'; ls.forEach((l, k) => g.fillText(l, W / 2, y + 13 + lh / 2 + k * lh));
  g.globalAlpha = 1;
}

function render(o) {
  now = o;
  const x = shotAt(o);
  // The next shot of the product decodes its first second before the cut, or the cut shows the last shot's frame.
  const nx = shots.find((y) => y.kind === 'capture' && y.o0 > o && y.o0 < o + 2);
  if (nx) for (let k = 0; k <= 10; k++) want(frameAt(srcAt(nx, nx.o0 + k * 0.1)));
  if (x.id === 'hook') drawHook(x, o);
  else if (x.id === 'problem') drawProblem(x, o);
  else if (x.id === 'how') drawHow(x, o);
  else if (x.id === 'end') drawEnd(x, o);
  else drawCapture(x, o);
  // Every shot comes in and goes out through the background colour.
  const f = Math.max(1 - clamp((o - x.o0) / 0.25), 1 - clamp((x.o1 - o) / 0.2));
  if (f > 0) { g.fillStyle = 'rgba(15,31,16,' + f + ')'; g.fillRect(0, 0, W, H); }
  if (P.guide || (P.captions && x.kind === 'capture')) caption(x, o);
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
shots.forEach((s, i) => { if (!voice[i]) return; const n = ac.createBufferSource(); n.buffer = voice[i]; n.connect(dest); n.start(at + s.voAt); });
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
