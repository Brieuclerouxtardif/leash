// Shared by the front door (home.js) and the console (app.js). Every string from the chain, the model or the
// inbox is rendered with textContent.
export const TOKEN = document.querySelector('meta[name="leash-token"]').content;
export const $ = (id) => document.getElementById(id);
export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-leash-token': TOKEN }, body: JSON.stringify(body) });
  // A server that answers in plain text (a 404 from an older build) still gives a readable error.
  const j = await r.json().catch(() => ({ error: `${r.status} ${r.statusText} on ${path}` }));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

export const money = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const usd = (n) => `$${money(n, 0)}`;
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const list = (xs) => (xs.length ? xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] : 'nobody');
export const day = (ts) => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// The explorers of the chain the server runs on, set from /api/state.
export const chain = { explorer: null, decoder: null };
export const txUrl = (hash) => (chain.explorer && hash ? `${chain.explorer}/tx/${hash}` : null);
export const addrUrl = (a) => (chain.explorer ? `${chain.explorer}/address/${a}` : null);
// A mined refusal shows the reason replayed at its block; the pre-send simulation is only a fallback.
export const reasonOf = (e) => e?.minedError?.name ?? e?.expectedError?.name;
// The first failed check, in its own words: the rule's name says what was checked, the detail says what was wrong.
export const failing = (checks) => (checks.find((c) => !c.ok)?.detail ?? '').replace(/0x[0-9a-fA-F]{40}/g, (a) => short(a));

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 3800);
}

// `wait` replaces the label while a transaction waits for its block (~12 s on Sepolia).
export async function busy(btn, fn, wait) {
  const label = btn.textContent;
  btn.disabled = true;
  if (wait) btn.textContent = wait;
  try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; if (wait && btn.textContent === wait) btn.textContent = label; }
}

// A refusal also links to a decoding explorer: Etherscan only says "execution reverted".
export function link(hash, reverted = false) {
  const u = txUrl(hash);
  if (!u) return h('span', { class: 'tx' }, `tx ${short(hash)}`);
  const a = h('a', { href: u, target: '_blank', rel: 'noopener' }, `tx ${short(hash)}`);
  return h('span', { class: 'tx' }, a, reverted && chain.decoder ? [' · ', h('a', { href: `${chain.decoder}/tx/${hash}`, target: '_blank', rel: 'noopener' }, 'decoded')] : null);
}
export const txBits = (e) => (e?.hash ? [' · ', link(e.hash, e.status === 'reverted')] : []);

// Numbers that change count to their new value instead of jumping.
export function count(el, to, fmt, ms = 900) {
  const from = Number(el.dataset.v);
  el.dataset.v = to;
  cancelAnimationFrame(el.raf);
  if (REDUCED || !Number.isFinite(from) || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) el.raf = requestAnimationFrame(step);
  };
  el.raf = requestAnimationFrame(step);
  // A hidden tab runs no animation frame; the number must still be right when someone looks.
  setTimeout(() => { if (Number(el.dataset.v) === to) { cancelAnimationFrame(el.raf); el.textContent = fmt(to); } }, ms + 100);
}

// A radio group of buttons: click, or arrow keys once one has focus.
export function radios(group, onPick) {
  const btns = [...group.querySelectorAll('[role="radio"]')];
  const pick = (b, focus) => {
    for (const x of btns) { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; }
    if (focus) b.focus();
    onPick(b.dataset.v, b);
  };
  btns.forEach((b, k) => {
    b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
    b.addEventListener('click', () => pick(b));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (d) { e.preventDefault(); pick(btns[(k + d + btns.length) % btns.length], true); }
    });
  });
  return pick;
}

// An outcome: one word that reads from across the room, what was asked, then why and the receipt.
export function verdict(cls, word, what, why, act) {
  return h('div', { class: `verdict ${cls} new` }, h('span', { class: 'word' }, word), h('span', { class: 'what' }, what),
    why ? h('span', { class: 'why' }, why) : null, act ? h('span', { class: 'act' }, act) : null);
}

export function describe(i) {
  if (i.type === 'swap') return `${i.side === 'buy' ? 'Buy tETH with' : 'Sell'} ${i.amount} ${i.side === 'buy' ? 'tUSD' : 'tETH'}`;
  if (i.type === 'add_payee') return `Add ${i.to ? short(i.to) : i.payee} as a payee, up to ${money(i.amount, 0)}`;
  if (i.type === 'raise_daily_limit') return `Raise the daily limit to ${money(i.amount, 0)} tUSD`;
  if (i.type === 'withdraw') return `Withdraw ${money(i.amount, 0)} tUSD to ${short(i.to)}`;
  // An address beats a name: it is where the money would go, whatever name the message gave it.
  return `Pay ${money(i.amount, 0)} tUSD to ${i.to ? `${short(i.to)}${i.payee ? ` (“${i.payee}”)` : ''}` : i.payee}`;
}
