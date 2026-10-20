// Readies the voice-over for compose-launch.mjs, in a headless browser (no ffmpeg): each vNN.mp3 of <dir> becomes vNN.wav
// (48 kHz mono, the silence at both ends trimmed, every line at one loudness) and vNN.json (the pauses inside the line,
// where the captions change).
// Usage: node scripts/voice-prep.mjs <dir with v01.mp3 …>
import { createServer } from 'node:http';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, sleep } from './cdp.mjs';

const DIR = resolve(process.argv[2] ?? '.');
const clips = readdirSync(DIR).filter((f) => /^v\d\d\.mp3$/.test(f)).sort();
if (!clips.length) { console.error('usage: node scripts/voice-prep.mjs <dir with v01.mp3 …>'); process.exit(2); }

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
window.onerror = (m) => { window.__error = String(m); };
window.onunhandledrejection = (e) => { window.__error = String(e.reason?.stack ?? e.reason); };
const RATE = 48000, WIN = 480;
const report = [];
for (const name of ${JSON.stringify(clips)}) {
  const ab = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await (await fetch(name)).arrayBuffer());
  const n = ab.length, x = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / ab.numberOfChannels; }
  // The level of each 10 ms; speech is anything within 30 dB of the loudest.
  const m = Math.floor(n / WIN), lv = new Float32Array(m);
  for (let w = 0; w < m; w++) { let s = 0; for (let i = w * WIN; i < (w + 1) * WIN; i++) s += x[i] * x[i]; lv[w] = Math.sqrt(s / WIN); }
  let top = 0; for (const v of lv) top = Math.max(top, v);
  const loud = Array.from(lv, (v) => v > top * 0.03);
  const first = loud.indexOf(true), last = loud.lastIndexOf(true);
  const a = Math.max(0, first - 4) * WIN, b = Math.min(n, (last + 15) * WIN);
  // Pauses of 150 ms or more between the first and the last word.
  const pauses = [];
  let run = -1;
  for (let w = first; w <= last; w++) {
    if (!loud[w]) { if (run < 0) run = w; continue; }
    if (run >= 0 && w - run >= 15) pauses.push([+((run * WIN - a) / RATE).toFixed(3), +((w * WIN - a) / RATE).toFixed(3)]);
    run = -1;
  }
  // One loudness for every line: speech at -18 dBFS RMS, peaks kept under -1 dBFS.
  let s = 0, k = 0, peak = 0;
  for (let w = first; w <= last; w++) if (loud[w]) { s += lv[w] * lv[w]; k++; }
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gain = Math.min(0.126 / Math.sqrt(s / k), 0.89 / peak);
  const len = b - a, buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, x[a + i] * gain)) * 32767), true);
  const base = name.replace('.mp3', '');
  await fetch(base + '.wav', { method: 'POST', body: buf });
  await fetch(base + '.json', { method: 'POST', body: JSON.stringify({ seconds: +(len / RATE).toFixed(3), pauses }) });
  report.push(base + ' ' + (len / RATE).toFixed(2) + ' s, gain ' + gain.toFixed(2) + ', pauses ' + pauses.map((p) => p[0].toFixed(2) + '-' + p[1].toFixed(2)).join(' '));
}
window.__report = report.join('\\n');
window.__done = true;
</script>`;

const server = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
  if (req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => { if (/^v\d\d\.(wav|json)$/.test(name)) writeFileSync(join(DIR, name), Buffer.concat(parts)); res.end('ok'); });
    return;
  }
  if (clips.includes(name)) { res.setHeader('content-type', 'audio/mpeg'); return res.end(readFileSync(join(DIR, name))); }
  res.setHeader('content-type', 'text/html');
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await launch({ width: 800, height: 600, scale: 1, port: 9339 });
await browser.S('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
while (!(await browser.js('return !!window.__done || !!window.__error'))) await sleep(500);
const err = await browser.js('return window.__error ?? null');
console.log(err ?? (await browser.js('return window.__report')));
browser.close();
server.close();
if (err) process.exit(1);
