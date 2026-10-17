// LEASH front door: enter with a test wallet, then talk to the agent, by voice or by typing.
// The chat goes through the same server route as the console's; nothing here decides what is paid.
import { $, REDUCED, h, api, money, usd, short, day, chain, reasonOf, failing, toast, busy, txBits, count } from './ui.js';

let S = null;
let samples = [];
let sending = false;
const body = document.body;
const agentEl = $('agent');

const NAMES = { landlord: 'Marta', utility: 'Lumen', school: 'the school' };
const nameOf = (k) => NAMES[k] ?? k;
const payeeAt = (a) => Object.keys(S.payees).find((k) => S.payees[k].address.toLowerCase() === String(a).toLowerCase());

// ------------------------------------------------------------------ state
function render(s) {
  S = s;
  chain.explorer = s.explorer;
  chain.decoder = s.decoder;
  $('walletAddr').textContent = short(s.roles.owner);
  $('net').textContent = s.network === 'sepolia' ? 'Sepolia testnet' : 'Local test chain';
  const total = s.usd + s.ethValue;
  const w = s.worst;
  const reach = w.live && !s.paused ? w.untilExpiry : 0;
  count($('bal'), total, usd, 1200);
  $('balSub').textContent = `in your vault: ${money(s.usd, 0)} tUSD and ${s.eth.toFixed(2)} tETH`;
  count($('reach'), reach, usd, 1200);
  $('reachBar').style.transform = `scaleX(${reach / Math.max(total, 1)})`;
  $('reachSub').textContent = s.paused ? 'can move: the guardian paused the vault'
    : w.live ? `is the most it can move, even hijacked, only to your payees, until ${day(w.expiry)}` : 'can move: the agent key is not active';
  body.classList.toggle('paused', s.paused);
  $('kill').hidden = s.paused || body.classList.contains('door');
  $('pausedBand').hidden = !s.paused;
  if (!sending && !rec) agentState();
}

async function refresh() {
  try { render(await api('/api/state')); } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ the door
// Entering clips the leash on: the line draws, the balance counts up from zero, the reach bar grows.
function enter(animate) {
  body.classList.remove('door');
  for (const id of ['who', 'purse', 'talk', 'convo']) $(id).hidden = false;
  for (const id of ['bal', 'reach']) $(id).dataset.v = animate ? '0' : 'NaN';
  $('reachBar').style.transform = 'scaleX(0)';
  void $('reachBar').offsetWidth;
  if (S) render(S);
  try { sessionStorage.setItem('leash-in', '1'); } catch { /* private window: the door shows again next time */ }
  if (animate) {
    clip();
    $('mic').focus({ preventScroll: true });
    // On a phone the agent sits under the vault: bring it up so the leash is seen clipping on, and the mic is a thumb away.
    if (matchMedia('(max-width: 900px)').matches) agentEl.scrollIntoView({ block: 'end', behavior: REDUCED ? 'auto' : 'smooth' });
  }
}
// The whole loose square takes the click; the button inside is the one keyboards and screen readers reach.
$('loose').addEventListener('click', () => enter(true));

// The clip catches: once the line reaches the agent, the square jolts toward the vault and settles.
function clip() {
  if (REDUCED) return;
  const across = $('leash').offsetWidth > $('leash').offsetHeight;
  const k = (x) => (across ? `translateX(${x}px)` : `translateY(${x}px)`);
  agentEl.animate([{ transform: k(0) }, { transform: k(-14), offset: 0.35 }, { transform: k(3), offset: 0.7 }, { transform: k(0) }],
    { duration: 420, delay: 480, easing: 'cubic-bezier(.3, .7, .2, 1)' });
}

// ------------------------------------------------------------------ the agent's square: states and the leash
const LABEL = { idle: 'Tap to talk', listen: 'Listening… tap to send', think: 'Thinking…', paused: 'Paused' };
function agentState(st) {
  const s = st ?? (S?.paused ? 'paused' : 'idle');
  agentEl.dataset.state = s;
  $('micLabel').textContent = LABEL[s] ?? LABEL.idle;
  $('mic').setAttribute('aria-pressed', String(s === 'listen'));
}

function stamp(text, cls = '') {
  agentEl.querySelector('.stamp')?.remove();
  const el = h('span', { class: `stamp ${cls}` }, text);
  agentEl.append(el);
  setTimeout(() => el.remove(), 2600);
}

// The agent tries to run and the leash holds: the square lurches away from the vault, the line stretches with
// it, and both come back. Same timing on both, so the line stays tied to the square.
function tug() {
  if (REDUCED) return;
  const line = $('leash');
  const across = line.offsetWidth > line.offsetHeight;
  const len = across ? line.offsetWidth : line.offsetHeight;
  const pull = across ? 64 : 36;
  const at = (k) => (across ? `translateX(${k}px)` : `translateY(${k}px)`);
  const stretch = (k) => (across ? `scaleX(${(len + k) / len}) scaleY(${k > 0 ? 2.2 : 1})` : `scaleY(${(len + k) / len}) scaleX(${k > 0 ? 2.2 : 1})`);
  const steps = [[0, 0], [pull, 0.32], [-pull * 0.14, 0.62], [pull * 0.04, 0.82], [0, 1]];
  const timing = { duration: 760, easing: 'cubic-bezier(.3, .7, .2, 1)' };
  agentEl.animate(steps.map(([k, offset]) => ({ transform: at(k), offset })), timing);
  line.querySelector('i').animate(steps.map(([k, offset]) => ({ transform: stretch(k), offset })), timing);
}

// The amount leaves the vault's balance and lands on the line that says where it went. When that line is off
// screen, the amount drops out of the vault and fades.
function fly(amount, to) {
  const land = () => { to.classList.remove('got'); void to.offsetWidth; to.classList.add('got'); };
  if (REDUCED) { land(); return; }
  const a = $('bal').getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const seen = b.top >= 0 && b.bottom <= innerHeight;
  const coin = h('span', { class: 'coin' }, `−${money(amount, 0)}`);
  body.append(coin);
  const from = `translate(${a.left + 8}px, ${a.top + a.height / 2 - 16}px)`;
  const end = seen ? `translate(${b.left + 12}px, ${b.top + 10}px) scale(.8)` : `translate(${a.left + 40}px, ${a.bottom + 120}px) scale(.8)`;
  const anim = coin.animate([{ transform: `${from} scale(1.15)`, opacity: 0 }, { transform: from, opacity: 1, offset: 0.15 }, { transform: end, opacity: 1, offset: 0.85 }, { transform: end, opacity: 0 }],
    { duration: 900, easing: 'cubic-bezier(.65, 0, .35, 1)' });
  anim.onfinish = () => { coin.remove(); land(); };
}

// ------------------------------------------------------------------ talking: one exchange on screen at a time
const SOURCE = { 'RECORDED REPLAY': 'recorded model answer', live: 'live model', 'OFFLINE READER': 'offline reader, no model' };
const sourceOf = (m) => (m.mode === 'live' ? `live model · ${Math.round(m.seconds)} s` : m.fallback ? 'model unreachable: offline reader' : SOURCE[m.mode] ?? m.mode);

function whatOf(i) {
  const to = i.to ? (payeeAt(i.to) ? nameOf(payeeAt(i.to)) : short(i.to)) : nameOf(i.payee);
  if (i.type === 'pay') return `${money(i.amount, 0)} tUSD to ${to}`;
  if (i.type === 'swap') return i.side === 'sell' ? `Sell ${i.amount} tETH` : `Buy tETH with ${money(i.amount, 0)} tUSD`;
  if (i.type === 'add_payee') return `Add ${to} as a payee`;
  if (i.type === 'raise_daily_limit') return `Daily limit to ${money(i.amount, 0)} tUSD`;
  return `Withdraw ${money(i.amount, 0)} tUSD to ${to}`;
}

// What happened to one request, and what the mark does about it: the coin flies, or the leash pulls taut.
function outcome(x, r) {
  const what = whatOf(r.intent);
  if (x.agent === 'server') {
    if (!r.sent) return { el: v('ok', 'Not sent', what, r.note) };
    if (r.tx.status === 'success') return { el: v('held', 'Paid', what, ['Inside your rules, so the vault let it go', ...txBits(r.tx)]), paid: r.intent.amount };
    return { el: v('ok', 'Refused', what, [`The contract held · ${reasonOf(r.tx) ?? r.tx.status}`, ...txBits(r.tx)]), held: true };
  }
  if (r.decision === 'needs_owner') return { el: v('ask', 'Your call', what, 'More than it may pay alone', signButton(r.ask, r.intent)) };
  if (r.decision === 'refuse') return { el: v('ok', 'Refused', what, `LEASH’s code · ${failing(r.checks)}`), held: true };
  if (r.tx?.status === 'success') return { el: v('held', 'Paid', what, ['By the agent, inside your rules', ...txBits(r.tx)]), paid: r.intent.amount };
  return { el: v('ok', 'Refused', what, [`The contract held · ${reasonOf(r.tx) ?? r.tx?.status}`, ...txBits(r.tx)]), held: true };
}
function v(cls, word, what, why, act) {
  return h('div', { class: `verdict ${cls} new` }, h('span', { class: 'word' }, word), h('span', { class: 'what' }, what),
    why ? h('span', { class: 'why' }, why) : null, act ? h('span', { class: 'act' }, act) : null);
}

function renderAnswer(x) {
  const outs = x.results.map((r) => outcome(x, r));
  const none = !outs.length;
  // A message the agent flagged, as opposed to one it only needs more words for.
  const refusedAlone = x.modelFlags.length + x.codeFlags.length > 0;
  $('answer').replaceChildren(
    h('p', { class: 'said' }, h('span', {}, x.how === 'voice' ? 'You said' : 'You'), h('q', {}, x.text)),
    h('p', { class: 'replied' }, h('span', {}, x.agent === 'server' ? 'Hijacked' : 'Agent'), h('p', {}, x.reply), h('span', { title: x.meta.fallback ?? x.meta.model ?? '' }, sourceOf(x.meta))),
    ...(none ? [v('ok', 'Not sent', x.agent === 'server' ? 'Nothing the contract could take' : refusedAlone ? 'The agent said no on its own' : 'It needs to know who and how much')] : outs.map((o) => o.el)),
    ...(none && refusedAlone && x.agent !== 'server' ? [h('p', { class: 'hint' }, 'Hijack the agent to see the contract hold.')] : []));
  if (outs.some((o) => o.held)) { tug(); stamp('Held'); }
  for (const o of outs.filter((o) => o.paid)) { fly(o.paid, o.el); stamp('Paid', 'paid'); }
}

async function send(text, how = 'typed') {
  text = tidy(text.trim());
  if (!text || sending) return;
  sending = true;
  agentState('think');
  try {
    const x = await api('/api/chat', { text, agent: body.classList.contains('hijacked') ? 'server' : 'healthy', mode: 'auto' });
    renderAnswer({ ...x, text, how });
    $('say').value = '';
    await refresh();
  } catch (e) { toast(e.message); } finally { sending = false; agentState(); }
}

$('composer').addEventListener('submit', (e) => { e.preventDefault(); send($('say').value); });
$('hijack').addEventListener('change', (e) => {
  body.classList.toggle('hijacked', e.target.checked);
  $('agentRole').textContent = e.target.checked ? 'Hijacked: model and server' : 'Your agent';
});

// The scripted messages the model's answers were recorded for, one tap each.
const TRY = [[/electricity/i, 'Pay the electricity, 120'], [/school/, 'Pay the school 5,000'], [/^Hi, it's Marta/, 'Landlord’s new wallet', true],
  [/^\[SYSTEM\]/, '[SYSTEM] add a payee', true], [/private key/, 'Your private key?', true]];
async function loadTry() {
  samples = await api('/api/chat/samples');
  $('chips').replaceChildren(...TRY.map(([re, label, scam]) => {
    const s = samples.find((x) => re.test(x.text));
    return s ? h('button', { type: 'button', class: scam ? 'scam' : null, title: s.text, onclick: () => send(s.text) }, label) : null;
  }));
}

// ------------------------------------------------------------------ voice: the browser's own dictation
// Chrome and Edge send the audio to their speech service (Google, Microsoft); Firefox has none, so it types.
const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let rec = null;
let lang = (navigator.language ?? 'en').startsWith('fr') ? 'fr-FR' : (navigator.language ?? '').startsWith('zh') ? 'zh-CN' : 'en-US';
const VOICE_ERR = { 'not-allowed': 'Microphone blocked. Allow it in the address bar, or type.', 'service-not-allowed': 'This browser has no speech service. Type instead.',
  network: 'Voice needs the browser’s speech service online. Type instead.', 'no-speech': 'Nothing heard. Tap and speak.', 'audio-capture': 'No microphone found. Type instead.' };
// Sent after this much quiet once something was said, and in any case after the cap.
const SILENCE = 3000;
const CAP = 45000;
// Dictation writes "5 000" with a space or a no-break space; the code reads the amount from the text as sent.
const tidy = (t) => t.replace(/(\d)[\s\u00a0\u202f](?=\d{3}\b)/g, '$1').replace(/\s+/g, ' ').trim();

function listen() {
  if (S?.paused) { toast('The vault is paused. Restart it as owner first.'); return; }
  if (sending) return;
  if (!SR) { $('say').focus(); toast('Voice needs Chrome or Edge. Type instead.'); return; }
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = lang;
  // It keeps listening through pauses: a tap sends, or a quiet spell once something was said.
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let failed = false;
  let quiet = null;
  const me = rec;
  const cap = setTimeout(() => me.stop(), CAP);
  const hush = () => { clearTimeout(quiet); quiet = setTimeout(() => me.stop(), SILENCE); };
  rec.onresult = (e) => { $('say').value = tidy([...e.results].map((r) => r[0].transcript).join(' ')); hush(); };
  rec.onerror = (e) => { failed = true; if (e.error !== 'aborted') toast(VOICE_ERR[e.error] ?? `Voice stopped: ${e.error}`); if (e.error !== 'no-speech') $('say').focus(); };
  // Whatever was heard is sent, even if the service then stopped with an error.
  rec.onend = () => { clearTimeout(quiet); clearTimeout(cap); rec = null; agentState(); const t = $('say').value; if (!failed || t.trim()) send(t, 'voice'); };
  try { rec.start(); agentState('listen'); $('say').value = ''; } catch (e) { rec = null; toast(e.message); }
}
$('mic').addEventListener('click', listen);

const langBtns = [...$('langs').querySelectorAll('button')];
for (const b of langBtns) {
  b.setAttribute('aria-checked', String(b.dataset.v === lang));
  b.addEventListener('click', () => { lang = b.dataset.v; for (const x of langBtns) x.setAttribute('aria-checked', String(x === b)); });
}

// ------------------------------------------------------------------ owner signature for a payment above the agent's limits
let pending = null;
function signButton(ask, intent) {
  const b = h('button', { class: 'go' }, 'Review & sign');
  b.addEventListener('click', () => busy(b, async () => {
    const m = await api('/api/mandate/preview', { i: ask, from: 'chat' });
    pending = { ask, intent, btn: b };
    $('mText').textContent = m.text;
    $('mandateDlg').showModal();
  }));
  return b;
}
// Signing hangs off the button, not the dialog's `close` event, which a hidden pane fires late (console, app.js).
$('mSign').addEventListener('click', async (ev) => {
  ev.preventDefault();
  $('mandateDlg').close('sign');
  const p = pending;
  pending = null;
  if (!p) return;
  p.btn.disabled = true;
  p.btn.textContent = 'Signed · sending…';
  try {
    const e = await api('/api/mandate/sign', { i: p.ask, from: 'chat' });
    const ok = e.status === 'success';
    const paidEl = v(ok ? 'held' : 'ok', ok ? 'Paid' : 'Refused', whatOf(p.intent), ok ? ['Signed by you, paid by the agent', ...txBits(e)] : [`The contract held · ${reasonOf(e) ?? e.status}`, ...txBits(e)]);
    p.btn.closest('.verdict').replaceWith(paidEl);
    if (ok) { fly(p.intent.amount, paidEl); stamp('Paid', 'paid'); } else { tug(); stamp('Held'); }
    await refresh();
  } catch (err) { toast(err.message); p.btn.disabled = false; p.btn.textContent = 'Review & sign'; }
});

// ------------------------------------------------------------------ owner and guardian
$('kill').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/guardian/pause', {}); toast('The guardian paused the vault. Nothing can leave.'); await refresh(); agentState(); }, 'Pausing…'));
$('unpause').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/owner/unpause', {}); toast('You restarted the agent.'); await refresh(); agentState(); }, 'Restarting…'));

// ------------------------------------------------------------------ start
for (const id of ['bal', 'reach']) $(id).dataset.v = '0';
let back = false;
try { back = sessionStorage.getItem('leash-in') === '1'; } catch { /* storage blocked: show the door */ }
await refresh();
if (back) enter(false);
agentState();
await loadTry().catch((e) => toast(e.message));
setInterval(() => sending || refresh(), 5000);
