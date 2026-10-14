// A headless Edge or Chrome driven over the DevTools protocol, with no dependency beyond Node.
// Used by screens.mjs (screenshots) and record-demo.mjs / compose-video.mjs (the fallback demo video).
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const BROWSER = process.env.BROWSER ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1600, height = 1000, scale = 2, dark = true, port = 9333, args = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'leash-cdp-'));
  let closed = null;
  const proc = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', ...args, 'about:blank'], { stdio: 'ignore' });
  proc.on('exit', (code) => { if (!closed) console.error(`browser exited (code ${code})`); });

  let info;
  for (let i = 0; i < 50 && !info; i++) {
    try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!info) throw new Error('browser did not start');

  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  // CDP_LOG=<file> keeps a trace of every call, reply and event (names and sizes, no payloads) for post-mortems.
  const trace = process.env.CDP_LOG ? (line) => appendFileSync(process.env.CDP_LOG, `${new Date().toISOString().slice(11, 23)} ${line}\n`) : () => {};
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  let heard = Date.now();
  ws.addEventListener('message', (ev) => {
    heard = Date.now();
    const m = JSON.parse(ev.data);
    trace(m.id ? `← ${m.id}${m.error ? ` error ${m.error.message}` : ''}` : `◇ ${m.method} ${ev.data.length}`);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message}`)); else resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners.get(m.method) ?? []) fn(m.params, m.sessionId);
    }
  });
  // A closed connection fails every call in flight and every later one, instead of leaving them waiting forever.
  ws.addEventListener('error', (ev) => {
    trace(`error ${ev.message ?? ev.error?.message}`);
    if (!closed) console.error(`DevTools connection error: ${ev.message ?? ev.error?.message ?? ev.type}`);
  });
  ws.addEventListener('close', (ev) => {
    if (closed) return;
    // Both failed takes on 2026-10-14 were the laptop going to sleep (lid, power button): say so when it looks like it.
    const silent = Math.round((Date.now() - heard) / 1000);
    closed = new Error(`DevTools connection closed (code ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})${silent > 10 ? `, after ${silent} s without a message: did the computer sleep?` : ''}`);
    trace(closed.message);
    for (const { reject } of pending.values()) reject(closed);
    pending.clear();
  });
  const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed) return reject(closed);
    const id = ++seq;
    pending.set(id, { resolve, reject });
    trace(`→ ${id} ${method}${method === 'Runtime.evaluate' ? ` ${params.expression.slice(14, 90).replace(/\s+/g, ' ')}` : ''}`);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const S = (method, params) => cdp(method, params, sessionId);
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]);
  await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  if (dark) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await S('Page.enable');

  async function js(expr) {
    const r = await S('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  // Sepolia waits for blocks: an action takes 9–18 s there, A9 about 50 s.
  async function until(cond, what, ms = 60000) {
    for (let t = 0; t < ms; t += 250) {
      if (await js(`return !!(${cond})`)) return;
      await sleep(250);
    }
    throw new Error(`timeout: ${what}`);
  }
  function close() {
    closed ??= new Error('closed by the script');
    ws.close();
    proc.kill();
  }
  return { S, on, js, until, close };
}
