// The voice-over of docs/VIDEO.md, one sentence per line, in the order the video says them.
// Shared by compose-video.mjs (the cut) and record-voice.mjs (a person reading the lines), so both number them alike.
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// LEASH_SCRIPT=launch: the launch video of docs/VIDEO-LAUNCH.md instead, one clip per row (v01.wav … v13.wav, as compose-launch.mjs reads them).
export const LAUNCH = process.env.LEASH_SCRIPT === 'launch';
// One row of the VIDEO.md table per slot.
export const SLOTS = LAUNCH ? [] : ['title', 'top', 'routine', 'tier1', 'tier2', 'seal', 'editor', 'redteam', 'chat', 'kill', 'closing'];

const rows = LAUNCH
  ? readFileSync(join(ROOT, 'docs', 'VIDEO-LAUNCH.md'), 'utf8').split('\n')
    .map((l) => l.match(/^\| \d+ \| (\w+) \| (.*) \| "(.*)" \|\s*$/)).filter(Boolean)
    .map(([, id, screen, voice]) => (SLOTS.push(id), { screen, voice }))
  : readFileSync(join(ROOT, 'docs', 'VIDEO.md'), 'utf8').split('\n')
    .map((l) => l.match(/^\| \d:\d\d–\d:\d\d \| (.*) \| "(.*)" \|\s*$/)).filter(Boolean)
    .map(([, screen, voice]) => ({ screen, voice }));
if (rows.length !== SLOTS.length) throw new Error(`VIDEO.md has ${rows.length} voice-over rows, expected ${SLOTS.length}`);

export const script = Object.fromEntries(SLOTS.map((id, i) => [id, rows[i]]));
export const sentences = (text) => text.split(/(?<=[.!?])\s+/).filter(Boolean);
export const lines = SLOTS.flatMap((id) => (LAUNCH ? [script[id].voice] : sentences(script[id].voice)).map((text) => ({ id, text })));
export const clipName = (i) => (LAUNCH ? `v${String(i + 1).padStart(2, '0')}.wav` : `s${String(i).padStart(2, '0')}.wav`);

export function wavSeconds(buf) {
  let byteRate = 0;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(p + 16);
    if (id === 'data') return size / byteRate;
    p += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in WAV');
}
