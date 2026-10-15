// A page for reading the voice-over of docs/VIDEO.md into a microphone, one sentence at a time, so that
// compose-video.mjs --voice-dir cuts the demo with a person's voice instead of the Windows one. No new take is needed.
// Usage: node scripts/record-voice.mjs <outDir> [--port 8793] [--no-open]
// Writes <outDir>/sNN.wav (mono at the sound card's rate, silence trimmed, levelled) and <outDir>/lines.json (the text each clip says,
// so that a sentence edited in VIDEO.md afterwards shows up as to be read again, here and in compose-video.mjs).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { script, lines, clipName, wavSeconds } from './video-script.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (!args[0] || args[0].startsWith('--')) { console.error('usage: node scripts/record-voice.mjs <outDir> [--port 8793] [--no-open]'); process.exit(2); }
const OUT = resolve(args[0]);
const PORT = Number(opt('--port') ?? 8793);
const MAX = 20e6; // a WAV of 3 min; one sentence is a few seconds
mkdirSync(OUT, { recursive: true });
const MANIFEST = join(OUT, 'lines.json');
const said = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];

function state() {
  return lines.map((l, i) => {
    const file = join(OUT, clipName(i));
    const has = existsSync(file);
    return {
      id: l.id, text: l.text, clip: clipName(i),
      screen: script[l.id].screen.replace(/\*\*|`/g, ''),
      status: !has ? 'todo' : said[i]?.text === l.text ? 'ok' : 'stale',
      seconds: has ? wavSeconds(readFileSync(file)) : null,
    };
  });
}

const json = (res, body, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
const server = createServer((req, res) => {
  // Only this page may use the server: no other site through DNS rebinding (Host), no cross-site POST (Origin).
  const host = req.headers.host;
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return json(res, { error: 'bad host' }, 421);
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'POST') {
    if (req.headers.origin !== `http://${host}`) return json(res, { error: 'bad origin' }, 403);
    const i = Number(path.match(/^\/save\/(\d{1,3})$/)?.[1] ?? -1);
    if (!(i >= 0 && i < lines.length)) return json(res, { error: 'no such sentence' }, 404);
    const parts = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX) { json(res, { error: 'too large' }, 413); req.destroy(); } else parts.push(c); });
    req.on('end', () => {
      const wav = Buffer.concat(parts);
      let seconds;
      try { if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error(); seconds = wavSeconds(wav); } catch { return json(res, { error: 'not a WAV' }, 400); }
      writeFileSync(join(OUT, clipName(i)), wav);
      said[i] = { id: lines[i].id, text: lines[i].text, seconds: Math.round(seconds * 100) / 100 };
      writeFileSync(MANIFEST, `${JSON.stringify(Array.from({ length: Math.max(said.length, lines.length) }, (x, k) => said[k] ?? null), null, 1)}\n`);
      console.log(`${clipName(i)}  ${seconds.toFixed(1)} s  ${lines[i].text}`);
      json(res, state());
    });
    return;
  }
  if (path === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(page()); }
  if (path === '/state') return json(res, state());
  const clip = path.match(/^\/clip\/(s\d\d\.wav)$/)?.[1];
  if (clip && existsSync(join(OUT, clip))) { res.setHeader('content-type', 'audio/wav'); res.setHeader('cache-control', 'no-store'); return res.end(readFileSync(join(OUT, clip))); }
  json(res, { error: 'not found' }, 404);
});
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  const left = state().filter((l) => l.status !== 'ok').length;
  console.log(`${lines.length} sentences, ${left} to record, into ${OUT}\nopen ${url} (Ctrl+C here when done)`);
  if (process.platform === 'win32' && !args.includes('--no-open')) spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
});

function page() {
  const next = `node scripts/compose-video.mjs work/demo-sepolia3 --voice-dir ${args[0].replace(/\\/g, '/')} --plan`;
  return `<!doctype html><meta charset="utf-8"><title>LEASH voice-over</title>
<style>
:root{--bg:#0b0d10;--panel:#12161b;--line:#232b35;--text:#e7ecf2;--muted:#8a96a3;--accent:#f5a524;--ok:#3ecf8e;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px "Segoe UI",system-ui,sans-serif;display:grid;grid-template-columns:1fr minmax(300px,30%);height:100vh}
main{padding:28px 44px;display:flex;flex-direction:column;gap:20px;overflow:auto}
aside{border-left:1px solid var(--line);background:var(--panel);overflow:auto}
kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:1px 6px;font:13px ui-monospace,monospace;color:var(--text)}
.help{color:var(--muted);line-height:1.7}
#where{color:var(--muted);font-size:15px}
#text{font-size:clamp(26px,3.2vw,42px);line-height:1.35;font-weight:500;max-width:34ch}
#text.stale::after{content:"  VIDEO.md changed: read it again";font-size:15px;color:var(--accent)}
.rec #text{color:var(--accent)}
#dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--line);vertical-align:middle;margin-right:10px}
.rec #dot{background:var(--accent)}
.rec.go #dot{background:var(--ok)}
#meter{height:8px;background:var(--line);border-radius:4px;overflow:hidden;max-width:520px}
#meter i{display:block;height:100%;width:0;background:var(--ok)}
#meter.hot i{background:var(--bad)}
#msg{min-height:1.5em}
#msg.bad{color:var(--bad)} #msg.ok{color:var(--ok)}
#after{color:var(--muted);font-size:18px;max-width:60ch}
#done{display:none;border:1px solid var(--ok);border-radius:10px;padding:14px 18px;max-width:70ch}
#done code{font:14px ui-monospace,monospace;user-select:all}
ol{list-style:none;margin:0;padding:0}
li{display:grid;grid-template-columns:22px 1fr 46px;gap:8px;padding:9px 14px;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px;line-height:1.35}
li.cur{background:#1d2530}
li .k{color:var(--muted)} li.ok .k{color:var(--ok)} li.stale .k{color:var(--accent)}
li .s{color:var(--muted);text-align:right}
#sum{padding:12px 14px;color:var(--muted);font-size:13px;position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line)}
@media (max-width:800px){body{display:block;height:auto}main{padding:16px}aside{border-left:0;border-top:1px solid var(--line)}}
</style>
<main>
  <div class="help"><kbd>Space</kbd> record, <kbd>Space</kbd> again to stop · <kbd>P</kbd> play back · <kbd>←</kbd> <kbd>→</kbd> previous / next.
  Start speaking when the dot turns green, and stop a moment after the last word: the silence is trimmed. Record a sentence again to replace it.</div>
  <div id="where"></div>
  <div id="text"></div>
  <div><span id="dot"></span><span id="msg"></span></div>
  <div id="meter"><i></i></div>
  <div id="after"></div>
  <div id="done">Every sentence is recorded. Close this tab, stop the server (Ctrl+C), and check the timing with<br><code>${next}</code><br>then drop <code>--plan</code> to render the video.</div>
</main>
<aside><div id="sum"></div><ol id="list"></ol></aside>
<script type="module">
// The sound card's own rate: Firefox will not connect a microphone to a context at another rate.
let SR = 48000;
const $ = (id) => document.getElementById(id);
let st = await (await fetch('state')).json();
let cur = Math.max(0, st.findIndex((l) => l.status !== 'ok'));
let ac = null, takes = null, started = 0, level = 0, peak = 0, busy = false;

function say(text, kind = '') { $('msg').textContent = text; $('msg').className = kind; }
function show() {
  const l = st[cur];
  $('where').textContent = (cur + 1) + ' / ' + st.length + ' · ' + l.id + ' · on screen: ' + l.screen;
  $('text').textContent = l.text; $('text').className = l.status === 'stale' ? 'stale' : '';
  $('after').textContent = st[cur + 1] ? 'Next: ' + st[cur + 1].text : '';
  $('list').innerHTML = '';
  st.forEach((x, i) => {
    const li = document.createElement('li');
    li.className = x.status + (i === cur ? ' cur' : '');
    li.innerHTML = '<span class="k">' + ({ ok: '✓', stale: '↻', todo: '○' })[x.status] + '</span><span></span><span class="s">' + (x.seconds ? x.seconds.toFixed(1) + ' s' : '') + '</span>';
    li.children[1].textContent = x.text;
    li.onclick = () => { if (!takes && !busy) { cur = i; show(); } };
    $('list').append(li);
  });
  $('list').children[cur].scrollIntoView({ block: 'nearest' });
  const ok = st.filter((x) => x.status === 'ok');
  $('sum').textContent = ok.length + ' of ' + st.length + ' recorded · ' + ok.reduce((a, x) => a + x.seconds, 0).toFixed(0) + ' s of speech';
  $('done').style.display = ok.length === st.length ? 'block' : 'none';
}

async function mic() {
  if (ac) return;
  ac = new AudioContext();
  SR = ac.sampleRate;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, autoGainControl: false, noiseSuppression: true } });
  const tap = 'registerProcessor("tap", class extends AudioWorkletProcessor { process([i]) { if (i[0]) this.port.postMessage(i[0].slice(0)); return true; } });';
  await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([tap], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ac, 'tap');
  const mute = ac.createGain(); mute.gain.value = 0;
  ac.createMediaStreamSource(stream).connect(node); node.connect(mute); mute.connect(ac.destination);
  node.port.onmessage = (e) => {
    const x = e.data; let s = 0, p = 0;
    for (const v of x) { s += v * v; p = Math.max(p, Math.abs(v)); }
    level = Math.max(level * 0.92, Math.sqrt(s / x.length)); peak = Math.max(peak * 0.995, p);
    if (takes) takes.push(x);
  };
}

// Trim the silence around the words, level the loudness, fade the edges.
function shape(parts) {
  const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0; for (const p of parts) { all.set(p, k); k += p.length; }
  // The key presses that start and stop a take are on it: drop its first and last 0.3 s.
  const edge = Math.round(0.3 * SR);
  if (all.length < 3 * edge) return { err: 'too short: press Space, say the sentence, then press Space' };
  const x = all.subarray(edge, all.length - edge);
  const win = Math.round(SR / 100), rms = [];
  for (let i = 0; i + win <= x.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += x[j] * x[j]; rms.push(Math.sqrt(s / win)); }
  const top = rms.reduce((a, r) => Math.max(a, r), 0);
  if (top < 0.002) return { err: 'nothing heard: check that the browser uses the right microphone' };
  const floor = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.2)];
  const thr = Math.max(top * 0.1, floor * 3);
  const first = rms.findIndex((r) => r > thr), last = rms.findLastIndex((r) => r > thr);
  const y = x.slice(Math.max(0, (first - 12) * win), Math.min(x.length, (last + 21) * win));
  let p = 0; for (const v of y) p = Math.max(p, Math.abs(v));
  const voiced = rms.slice(first, last + 1).filter((r) => r > thr);
  const loud = Math.sqrt(voiced.reduce((a, r) => a + r * r, 0) / voiced.length);
  const gain = Math.min(0.1 / loud, 0.9 / p, 12);
  for (let i = 0; i < y.length; i++) y[i] *= gain;
  const f = Math.min(Math.round(0.01 * SR), y.length >> 1);
  for (let i = 0; i < f; i++) { y[i] *= i / f; y[y.length - 1 - i] *= i / f; }
  const warn = p > 0.98 ? 'saturated: move back from the microphone, then record it again'
    : gain === 12 ? 'very quiet: move closer to the microphone, then record it again' : null;
  return { y, warn };
}

function wav(y) {
  const d = new DataView(new ArrayBuffer(44 + y.length * 2));
  const tag = (o, s) => { for (let i = 0; i < 4; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); d.setUint32(4, 36 + y.length * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, SR, true); d.setUint32(28, SR * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  tag(36, 'data'); d.setUint32(40, y.length * 2, true);
  for (let i = 0; i < y.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, y[i])) * 32767), true);
  return new Blob([d.buffer], { type: 'audio/wav' });
}

async function toggle() {
  if (busy) return;
  if (!ac) say('opening the microphone…');
  busy = true;
  try { await mic(); await ac.resume(); } catch (e) { ac = null; return say('no microphone: ' + e.message, 'bad'); } finally { busy = false; }
  if (!takes) { takes = []; started = performance.now(); document.body.classList.add('rec'); say('recording…'); return; }
  const parts = takes; takes = null; document.body.classList.remove('rec', 'go');
  const r = shape(parts);
  if (r.err) return say(r.err, 'bad');
  busy = true;
  try {
    const res = await fetch('save/' + cur, { method: 'POST', body: wav(r.y) });
    if (!res.ok) throw new Error((await res.json()).error);
    st = await res.json();
  } catch (e) { busy = false; return say('not saved: ' + e.message, 'bad'); }
  busy = false;
  say(st[cur].clip + ' saved, ' + st[cur].seconds.toFixed(1) + ' s' + (r.warn ? ' · ' + r.warn : ''), r.warn ? 'bad' : 'ok');
  // On to the next sentence still to read, wrapping round to any skipped earlier.
  if (!r.warn) { const left = st.map((x, i) => i).filter((i) => st[i].status !== 'ok'); cur = left.find((i) => i > cur) ?? left[0] ?? cur; }
  show();
}

function play() { if (!takes && st[cur].seconds) new Audio('clip/' + st[cur].clip).play(); }

addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
  if (takes || busy) return;
  if (e.code === 'ArrowRight' || e.code === 'ArrowDown') { e.preventDefault(); cur = Math.min(cur + 1, st.length - 1); show(); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') { e.preventDefault(); cur = Math.max(cur - 1, 0); show(); }
  else if (e.code === 'KeyP') play();
});

(function meter() {
  $('meter').firstChild.style.width = Math.min(100, level * 500) + '%';
  $('meter').className = peak > 0.98 ? 'hot' : '';
  document.body.classList.toggle('go', !!takes && performance.now() - started > 350);
  requestAnimationFrame(meter);
})();
window.__voice = { toggle, state: () => st, cur: () => cur };
show();
say('Press Space to record the first sentence (the browser asks for the microphone once).');
</script>`;
}
