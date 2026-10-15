// LEASH console. Every string from the chain, the model or the inbox is rendered with textContent.
const TOKEN = document.querySelector('meta[name="leash-token"]').content;
const $ = (id) => document.getElementById(id);
let S = null;

function h(tag, attrs = {}, ...kids) {
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

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-leash-token': TOKEN }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

const money = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const txUrl = (hash) => (S?.explorer && hash ? `${S.explorer}/tx/${hash}` : null);
const addrUrl = (a) => (S?.explorer ? `${S.explorer}/address/${a}` : null);
// A mined refusal shows the reason replayed at its block; the pre-send simulation is only a fallback.
const reasonOf = (e) => e?.minedError?.name ?? e?.expectedError?.name;
const nameOf = (a) => Object.entries(S?.roles ?? {}).find(([, v]) => v.toLowerCase() === String(a).toLowerCase())?.[0];

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 3500);
}

// `wait` replaces the label while a transaction waits for its block (~12 s on Sepolia).
async function busy(btn, fn, wait) {
  const label = btn.textContent;
  btn.disabled = true;
  if (wait) btn.textContent = wait;
  try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; if (wait) btn.textContent = label; }
}

// ------------------------------------------------------------------ state
function renderState(s) {
  S = s;
  $('net').textContent = s.network === 'sepolia' ? 'Ethereum Sepolia' : 'Local chain (anvil)';
  const vl = $('vaultLink');
  vl.textContent = `vault ${short(s.vault)}`;
  if (addrUrl(s.vault)) vl.href = addrUrl(s.vault); else vl.removeAttribute('href');
  const active = s.agentExpiry >= s.now && !/^0x0+$/.test(s.agent);
  const ap = $('agentPill');
  ap.className = `pill ${s.paused || !active ? 'bad' : 'ok'}`;
  ap.textContent = s.paused ? 'agent paused' : active ? `agent active · ${Math.round((s.agentExpiry - s.now) / 86400)} d left` : 'agent expired';
  $('kill').hidden = s.paused;
  $('unpause').hidden = !s.paused;

  $('total').textContent = `$${money(s.usd + s.ethValue)}`;
  $('usd').textContent = money(s.usd);
  $('eth').textContent = s.eth.toFixed(4);
  $('riskPct').textContent = `${(s.riskBps / 100).toFixed(1)}%`;
  $('allocEth').style.width = `${Math.min(100, s.riskBps / 100)}%`;
  $('allocLimit').style.left = `${s.risk.maxRiskBps / 100}%`;
  $('oracleLbl').textContent = s.network === 'sepolia' ? 'Chainlink ETH/USD' : 'Oracle ETH/USD (local mock)';
  $('price').textContent = `$${money(s.price)} · ${Math.round(s.priceAge / 60)} min old`;
  const dev = ((s.poolPrice - s.price) / s.price) * 10000;
  $('poolPrice').textContent = `$${money(s.poolPrice)} (${dev >= 0 ? '+' : ''}${dev.toFixed(0)} bps)`;
  $('poolPrice').style.color = Math.abs(dev) > s.risk.maxSlippageBps ? 'var(--bad)' : '';

  const L = s.limits;
  const payees = Object.entries(s.payees).filter(([, p]) => p.cap > 0).map(([n, p]) => `${n} ≤ ${money(p.cap, 0)}`).join(', ');
  $('mandate').replaceChildren(
    h('li', {}, `Pays only registered payees: ${payees}`),
    h('li', {}, `≤ ${money(L.payPerTx, 0)} tUSD per payment, ≤ ${money(L.payDaily, 0)} per day, and ${money(s.agentBudget, 0)} left in the key's budget: all its payments, every day, until the owner reloads it`),
    h('li', {}, `Swaps ≤ ${money(L.swapPerTx, 0)} each, ≤ ${money(L.swapDaily, 0)} per day, never below ${(100 - s.risk.maxSlippageBps / 100).toFixed(0)}% of the oracle price`),
    h('li', {}, `tETH share ≤ ${s.risk.maxRiskBps / 100}% after any buy`),
    h('li', {}, `Above that: owner's EIP-712 signature for that exact payment`),
    h('li', { class: 'no' }, 'Change limits, add payees, withdraw, call anything else: impossible for the agent'),
  );
  const g = (bar, txt, used, max) => {
    const pct = Math.min(100, (used / max) * 100);
    $(bar).style.width = `${pct}%`;
    $(bar).classList.toggle('full', pct >= 99.9);
    $(txt).textContent = `${money(used, 0)} / ${money(max, 0)}`;
  };
  g('payBar', 'payTxt', s.paidToday, L.payDaily);
  g('swapBar', 'swapTxt', s.swappedToday, L.swapDaily);
  $('agentAddr').textContent = short(s.agent);
  $('epoch').textContent = s.epoch;
  renderWorst(s.worst, s);
}

// The worst case is computed by code from the vault's limits (core.js worstCase), never by the model.
const tile = (n, label, cls) => h('div', { class: `wtile ${cls}` }, h('b', {}, n), h('span', {}, label));
function renderWorst(w, s) {
  const until = new Date(w.expiry * 1000).toISOString().slice(0, 10);
  const off = s.paused ? 'the vault is paused' : 'the agent key is not active';
  $('worst').replaceChildren(
    h('p', { class: 'wlead' }, 'If the model, LEASH\'s code and the agent key were all hijacked right now, the most that could leave the vault:'),
    h('div', { class: 'wgrid' },
      tile('0', 'tUSD to any address you did not register', 'ok'),
      tile(w.live ? `≤ ${money(w.today, 0)}` : '0', w.live ? `tUSD more today, only to ${w.to.join(' and ') || 'nobody'}` : `tUSD today: ${off}`, w.live && w.today > 0 ? 'warn' : 'ok'),
      tile(w.live ? `≤ ${money(w.untilExpiry, 0)}` : '0', w.live
        ? `tUSD until the key expires on ${until}, ${{ budget: 'all that is left of its budget: only the owner can reload it', balance: 'all the tUSD in the vault', days: `${w.days} paying day${w.days > 1 ? 's' : ''} at the daily limit` }[w.bound]}`
        : 'tUSD until the owner acts', w.live && w.untilExpiry > 0 ? 'warn' : 'ok'),
      tile(w.live ? `≤ ${money(w.swapLossPerDay, 0)}` : '0', 'tUSD a day lost on swaps against the oracle price', w.live ? 'warn' : 'ok')),
    h('p', { class: 'wfoot' }, 'Adding a payee, raising a limit, withdrawing: impossible for the agent. Nothing written below can raise these numbers; only an owner transaction can.'),
    // The counterfactual wallet (agent "no LEASH" below): the same hijack, the usual setup.
    s.hot && h('p', { class: 'wplain' }, 'Without LEASH, the usual setup: a plain wallet whose key the agent\'s server holds (', h('span', { class: 'mono' }, short(s.hot.address)),
      ', funded like the vault). The same hijack takes ', h('b', {}, 'all of it'), ', to any address, in one transaction. It holds ', h('b', {}, `${money(s.hot.usd, 0)} tUSD`), ' now.'));
}

// ------------------------------------------------------------------ inbox and plan
let inbox = [];
async function loadInbox() {
  inbox = await api('/api/inbox');
  renderInbox({});
}

// One chip per (who, kind); the details of every hit stay in the tooltip.
function chips(who, flags) {
  const byKind = new Map();
  for (const f of flags) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.detail]);
  return [...byKind].map(([kind, details]) => h('span', { class: `chip ${who}`, title: details.join('\n') },
    `${who}: ${kind.replace('_', ' ')}${details.length > 1 ? ` ×${details.length}` : ''}`));
}

function renderInbox(modelFlags) {
  $('inbox').replaceChildren(...inbox.map((doc) => {
    const mf = modelFlags[doc.id] ?? [];
    const flagged = doc.codeFlags.length || mf.length;
    return h('li', { class: `doc${flagged ? ' flagged' : ''}` },
      h('header', {}, h('span', { class: 'mono' }, doc.id), h('span', {}, flagged ? 'suspicious' : 'clean')),
      h('pre', {}, doc.text),
      h('div', { class: 'chips' }, chips('code', doc.codeFlags), chips('model', mf)));
  }));
}

function describe(i) {
  if (i.type === 'swap') return `${i.side === 'buy' ? 'Buy tETH with' : 'Sell'} ${i.amount} ${i.side === 'buy' ? 'tUSD' : 'tETH'}`;
  if (i.type === 'add_payee') return `Add ${i.to ? short(i.to) : i.payee} as a payee, cap ${money(i.amount, 0)} tUSD`;
  if (i.type === 'raise_daily_limit') return `Raise the daily payment limit to ${money(i.amount, 0)} tUSD`;
  if (i.type === 'withdraw') return `Withdraw ${money(i.amount)} tUSD to ${short(i.to)}`;
  // An address beats a name: it is where the money would go, whatever name the message gave it.
  return `Pay ${money(i.amount)} tUSD to ${i.to ? `${short(i.to)}${i.payee ? ` (called "${i.payee}")` : ''}` : i.payee}`;
}

function renderPlan(p) {
  $('planMeta').textContent = `${p.mode} · ${p.model} · prompt: ${p.profile}${p.seconds ? ` · ${p.seconds.toFixed(1)} s` : ''}${p.at ? ` · recorded ${p.at.slice(0, 16).replace('T', ' ')} UTC` : ''}`;
  $('summary').hidden = false;
  $('summary').textContent = `“${p.summary}”`;
  const byDoc = {};
  for (const f of p.modelFlags) (byDoc[f.doc] ??= []).push(f);
  renderInbox(byDoc);
  $('proposals').replaceChildren(...p.verdicts.map((v, idx) => {
    const action = v.decision === 'execute' ? h('button', { class: 'primary', onclick: (e) => busy(e.target, () => doExecute(idx, e.target), 'Sending…') }, 'Execute')
      : v.decision === 'needs_owner' ? h('button', { onclick: (e) => busy(e.target, () => openMandate(idx, e.target)) }, 'Review & sign')
        : null;
    return h('li', { class: 'prop' },
      h('div', { class: 'row' }, h('span', { class: 'what' }, describe(v.intent)), h('span', { class: `badge ${v.decision}` }, v.decision === 'needs_owner' ? 'needs your signature' : v.decision)),
      h('div', { class: 'meta' }, `${v.intent.reason} · source: ${v.intent.source} · tier ${v.tier}`),
      h('ul', { class: 'checks' }, v.checks.map((c) => h('li', { class: c.ok ? '' : 'fail', title: c.detail }, `${c.rule}${c.ok ? '' : ` — ${c.detail}`}`))),
      action && h('div', { class: 'row' }, h('span'), action));
  }));
  if (!p.verdicts.length) $('proposals').replaceChildren(h('li', { class: 'meta' }, 'The model proposed nothing.'));
}

// Once a proposal is settled on-chain its button becomes the outcome, so it cannot be clicked twice by mistake.
function settle(btn, e, okText) {
  const ok = e.status === 'success';
  btn.replaceWith(h('span', { class: `settled ${ok ? 'ok' : 'bad'}` }, ok ? okText : `refused: ${reasonOf(e) ?? e.status}`, e.hash ? ' · ' : '', e.hash ? link(e.hash, e.status === 'reverted') : ''));
}

async function doExecute(i, btn) {
  const e = await api('/api/execute', { i });
  toast(e.status === 'success' ? 'Executed on-chain.' : `Refused: ${reasonOf(e) ?? e.status}`);
  settle(btn, e, 'executed');
  refresh();
}

let pendingIdx = null;
let pendingBtn = null;
let pendingFrom = 'plan';
async function openMandate(i, btn, from = 'plan') {
  const m = await api('/api/mandate/preview', { i, from });
  pendingIdx = i;
  pendingBtn = btn;
  pendingFrom = from;
  $('mText').textContent = m.text;
  const msg = m.typed.message;
  $('mTyped').replaceChildren(...[['domain', `${m.typed.domain.name} v${m.typed.domain.version} · chain ${m.typed.domain.chainId}`], ['contract', m.typed.domain.verifyingContract],
    ['to', msg.to], ['amount', `${msg.amount} (6 decimals)`], ['opId', msg.opId], ['deadline', new Date(Number(msg.deadline) * 1000).toISOString()], ['epoch', msg.epoch]]
    .map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, String(v)))));
  $('mandateDlg').showModal();
}

// Signing hangs off the button, not the dialog's `close` event: Chromium fires that event with the next
// rendered frame, so in a hidden tab or pane the signature waited until the page was shown again.
$('mSign').addEventListener('click', async (ev) => {
  ev.preventDefault();
  $('mandateDlg').close('sign');
  if (pendingIdx === null) return;
  // On Sepolia the payment waits ~12 s for a block: say so, and keep the button from opening a second mandate.
  const btn = pendingBtn;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Signed · waiting for the block…'; }
  try {
    const e = await api('/api/mandate/sign', { i: pendingIdx, from: pendingFrom });
    toast(e.status === 'success' ? 'Signed and executed: tier 2 payment done.' : `Refused on-chain: ${reasonOf(e) ?? e.status}`);
    if (btn?.isConnected) settle(btn, e, 'signed by the owner, executed');
  } catch (err) {
    toast(err.message);
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
  pendingIdx = null;
  pendingBtn = null;
  refresh();
});

$('run').addEventListener('click', (e) => busy(e.target, async () => {
  $('planMeta').textContent = $('mode').value === 'live' ? 'Calling the model… (≈20 s)' : 'Loading the recorded run…';
  renderPlan(await api('/api/plan', { profile: $('profile').value, mode: $('mode').value }));
}));

// ------------------------------------------------------------------ mandate editor
async function loadSamples() {
  const samples = await api('/api/mandate/samples');
  $('sample').replaceChildren(...samples.map((t, i) => h('option', { value: i }, t.length > 70 ? `${t.slice(0, 70)}…` : t)), h('option', { value: 'own' }, 'Write your own (live call)'));
  const pick = () => {
    const own = $('sample').value === 'own';
    $('ownerText').value = own ? '' : samples[Number($('sample').value)] ?? '';
    if (own && S.allowLive) $('cmode').value = 'live';
    restart();
  };
  $('sample').addEventListener('change', pick);
  pick();
}

// One exchange per owner text: the answers so far and the number of model turns. Editing the text starts over.
let qa = [];
let turns = 0;
function restart() { qa = []; turns = 0; $('cAsk').hidden = true; }
$('ownerText').addEventListener('input', restart);

async function compile(answers) {
  $('cMeta').textContent = $('cmode').value === 'live' ? 'Calling the model… (≈10 s)' : 'Loading the recorded run…';
  $('diff').hidden = true;
  $('worstDiff').hidden = true;
  $('cNotes').replaceChildren();
  $('applyMandate').hidden = true;
  $('cAsk').hidden = true;
  let r;
  try {
    r = await api('/api/mandate/compile', { text: $('ownerText').value, mode: $('cmode').value, answers });
  } catch (err) {
    $('cMeta').textContent = `Not compiled: ${err.message}`;
    throw err;
  }
  qa = answers;
  turns += 1;
  $('cMeta').textContent = `${r.meta.mode} · ${r.meta.model}${r.meta.seconds ? ` · ${r.meta.seconds.toFixed(1)} s` : ''} · turn ${turns} · model: “${r.struct.summary}”`;
  // The model asks instead of guessing a value; a recorded replay pre-fills the answer it was recorded with.
  $('cAsk').hidden = !r.questions.length;
  $('cQuestions').replaceChildren(...r.questions.map((q) => {
    const recorded = r.replayAnswers.find((x) => x.q === q)?.a;
    return h('label', {}, q,
      h('input', { 'data-q': q, value: recorded ?? '', required: true, maxlength: 300, autocomplete: 'off' }),
      recorded != null ? h('span', { class: 'tag' }, 'the owner\'s recorded answer: a replay only knows this one (a live run takes any answer)') : null);
  }));
  // While a question is open the struct is incomplete (live run mandate-compile-20261015T081246003Z: the model asked
  // for the rent cap and also set it to 0), so no diff is shown until the owner has answered.
  $('diff').hidden = !r.rows.length || r.questions.length > 0;
  $('diffBody').replaceChildren(...r.rows.map((row) => h('tr', { class: row.direction }, h('td', {}, row.label), h('td', {}, String(row.from)), h('td', {}, String(row.to)),
    h('td', { class: 'dir' }, row.direction === 'looser' ? 'loosens' : 'tightens'))));
  $('cNotes').replaceChildren(
    ...(r.rows.length || r.questions.length ? [] : [h('li', {}, 'No change to the on-chain mandate.')]),
    ...r.errors.map((x) => h('li', { class: 'err' }, x)),
    ...r.unmapped.map((x) => h('li', { class: 'unm' }, x)));
  renderWorstDiff(r.worst, r.rows.length > 0 && !r.questions.length);
  const btn = $('applyMandate');
  btn.hidden = !r.calls.length && !r.questions.length;
  btn.disabled = r.errors.length > 0 || r.questions.length > 0;
  btn.className = r.looser ? 'danger' : 'primary';
  btn.textContent = r.questions.length ? 'Answer the questions before applying'
    : r.errors.length ? 'Fix the errors before applying'
      : `Apply ${r.calls.length} owner transaction${r.calls.length > 1 ? 's' : ''}${r.looser ? ` (${r.looser} loosen the leash)` : ''}`;
}

// What the change does to the worst case, before the owner signs it: the price of a longer leash.
const BOUND = { budget: ' (budget)', balance: ' (whole balance)', days: '' };
function renderWorstDiff(w, show) {
  $('worstDiff').hidden = !show;
  if (!show) return;
  const n = (a, b) => (b > a ? 'looser' : b < a ? 'tighter' : '');
  const names = (x) => x.to.join(', ') || 'nobody';
  const rows = [
    ['tUSD that can leave per day', money(w.now.perDay, 0), money(w.next.perDay, 0), n(w.now.perDay, w.next.perDay)],
    ['…only to', names(w.now), names(w.next), n(w.now.to.length, w.next.to.length)],
    ['UTC days the agent key can still pay', w.now.days, w.next.days, n(w.now.days, w.next.days)],
    ['tUSD left in the agent key\'s budget', money(w.now.budget, 0), money(w.next.budget, 0), n(w.now.budget, w.next.budget)],
    ['tUSD until the agent key expires', money(w.now.untilExpiry, 0) + BOUND[w.now.bound],
      money(w.next.untilExpiry, 0) + BOUND[w.next.bound], n(w.now.untilExpiry, w.next.untilExpiry)],
    ['tUSD lost on swaps per day', money(w.now.swapLossPerDay, 0), money(w.next.swapLossPerDay, 0), n(w.now.swapLossPerDay, w.next.swapLossPerDay)],
  ];
  $('worstBody').replaceChildren(...rows.map(([label, a, b, dir]) => h('tr', { class: dir }, h('td', {}, label), h('td', {}, a), h('td', {}, b),
    h('td', { class: 'dir' }, dir === 'looser' ? 'riskier' : dir === 'tighter' ? 'safer' : ''))));
}

$('compile').addEventListener('click', (e) => { restart(); busy(e.target, () => compile([])); });
$('cAsk').addEventListener('submit', (e) => {
  e.preventDefault();
  const more = [...$('cQuestions').querySelectorAll('input')].map((el) => ({ q: el.dataset.q, a: el.value.trim() }));
  busy($('answer'), () => compile([...qa, ...more]));
});

$('applyMandate').addEventListener('click', (e) => busy(e.target, async () => {
  const out = await api('/api/mandate/apply', {});
  const ok = out.every((x) => x.status === 'success');
  toast(ok ? `Mandate updated on-chain (${out.length} tx).` : `Stopped: ${reasonOf(out.at(-1)) ?? out.at(-1).status}`);
  e.target.hidden = true;
  refresh();
}, 'Sending…'));

// ------------------------------------------------------------------ chat
const AGENT = {
  healthy: ['healthy agent', 'Guarded prompt, then LEASH\'s code checks every intent, then the vault. The agent acts alone only inside tier 1; above it, it asks you to sign.'],
  model: ['hijacked model', 'A prompt written to obey every message stands in for a hijacked model. LEASH\'s code and the vault still check what it proposes.'],
  server: ['hijacked model + server', 'The same obeying prompt, and the agent\'s server sends whatever it proposes with the agent key, unchecked. Only the vault is left.'],
  plain: ['no LEASH: plain wallet', 'The counterfactual: the usual way to give an agent money. The same hijacked server holds the key of a plain wallet funded like the vault, and signs a token transfer for whatever the model proposes. No vault, so nothing is left to refuse.'],
};
let samples = [];

async function loadChat() {
  samples = await api('/api/chat/samples');
  const fill = () => {
    const prof = $('agent').value === 'healthy' ? 'guarded' : 'hijacked';
    const cur = $('say').value;
    $('say').replaceChildren(...samples.map((x, i) => h('option', { value: i }, `${x.recorded.includes(prof) ? '' : '[live only] '}${x.text.length > 90 ? `${x.text.slice(0, 90)}…` : x.text}`)),
      h('option', { value: 'own' }, 'Write your own (live call)'));
    if (cur) $('say').value = cur;
    $('agentNote').textContent = AGENT[$('agent').value][1];
  };
  const pick = () => {
    const own = $('say').value === 'own';
    $('msg').value = own ? '' : samples[Number($('say').value)]?.text ?? '';
    if (own && S.allowLive) $('tmode').value = 'live';
  };
  $('agent').addEventListener('change', fill);
  $('say').addEventListener('change', pick);
  fill();
  pick();
}

function chatResult(x, r) {
  const head = (badge, cls) => h('div', { class: 'row' }, h('span', { class: 'what' }, describe(r.intent)), h('span', { class: `badge ${cls}` }, badge));
  const tx = (e, okText) => h('div', { class: `settled ${e.status === 'success' ? (x.agent === 'healthy' ? 'ok' : 'warn') : 'bad'}` },
    e.status === 'success' ? okText : `refused by the ${e.status === 'reverted' ? 'contract' : 'node before sending'}: ${reasonOf(e) ?? e.status}`, e.hash ? ' · ' : '', e.hash ? link(e.hash, e.status === 'reverted') : '');
  if (x.agent === 'server') {
    return h('li', { class: 'prop' }, head(r.sent ? 'sent unchecked' : 'not sent', 'refuse'),
      h('div', { class: 'meta' }, r.sent ? `the hijacked server called ${r.call}() with the agent key` : r.note),
      r.sent && tx(r.tx, 'went through: it was inside the mandate'));
  }
  if (x.agent === 'plain') {
    return h('li', { class: 'prop' }, head(r.sent ? 'sent unchecked' : 'not sent', 'refuse'),
      h('div', { class: 'meta' }, r.sent ? 'the hijacked server signed a tUSD transfer from the plain wallet' : r.note),
      r.sent && h('div', { class: `settled ${r.tx.status === 'success' ? 'bad' : 'warn'}` },
        r.tx.status === 'success' ? 'GONE: nothing on-chain checked it' : `failed: ${reasonOf(r.tx) ?? r.tx.status}`, r.tx.hash ? ' · ' : '', r.tx.hash ? link(r.tx.hash, false) : ''));
  }
  const action = r.decision === 'needs_owner' ? h('button', { onclick: (ev) => busy(ev.target, () => openMandate(r.ask, ev.target, 'chat')) }, 'Review & sign') : null;
  return h('li', { class: 'prop' }, head(r.decision === 'needs_owner' ? 'needs your signature' : r.decision, r.decision),
    h('ul', { class: 'checks' }, r.checks.map((c) => h('li', { class: c.ok ? '' : 'fail', title: c.detail }, `${c.rule}${c.ok ? '' : ` — ${c.detail}`}`))),
    r.tx && tx(r.tx, 'done by the agent alone (tier 1)'),
    action && h('div', { class: 'row' }, h('span'), action));
}

function renderExchange(x) {
  const m = x.meta;
  $('thread').prepend(h('li', { class: `ex ${x.agent}` },
    h('div', { class: 'bubble msg' },
      h('header', {}, h('span', {}, `${x.id} · unsigned message`), h('span', { class: 'chips' }, chips('code', x.codeFlags))),
      h('p', {}, x.text)),
    h('div', { class: 'bubble reply' },
      h('header', {}, h('span', {}, `${AGENT[x.agent][0]} · ${m.mode} · ${m.model}${m.seconds ? ` · ${m.seconds.toFixed(1)} s` : ''}`), h('span', { class: 'chips' }, chips('model', x.modelFlags))),
      h('p', {}, x.reply)),
    x.results.length ? h('ol', { class: 'proposals' }, x.results.map((r) => chatResult(x, r))) : h('p', { class: 'meta' }, 'No action proposed.')));
}

$('send').addEventListener('click', (e) => busy(e.target, async () => {
  const text = $('msg').value.trim();
  if (!text) throw new Error('write a message first');
  const x = await api('/api/chat', { text, agent: $('agent').value, mode: $('tmode').value });
  renderExchange({ ...x, text });
  refresh();
}, $('tmode').value === 'live' ? 'Asking the model…' : 'Sending…'));

// ------------------------------------------------------------------ red team
async function loadAttacks() {
  const list = await api('/api/attacks');
  $('attacks').replaceChildren(...list.map((a) => {
    const res = h('div', { class: 'res' }, `expect ${a.expect}`);
    const card = h('div', { class: 'atk' }, h('div', { class: 'row' }, h('b', { class: 'mono' }, a.id)), h('p', {}, a.title), res);
    const btn = h('button', { onclick: () => busy(btn, async () => {
      res.textContent = 'sending…';
      let r;
      try { r = await api('/api/attack', { id: a.id }); } catch (err) { res.textContent = `not sent: ${err.message}`; throw err; }
      card.classList.toggle('pass', r.pass);
      card.classList.toggle('fail', !r.pass);
      res.replaceChildren(`${r.pass ? '✓' : '✗'} ${r.outcome}`, r.hash ? h('br') : '', r.hash ? link(r.hash, r.outcome.startsWith('reverted')) : '', r.note ? h('div', {}, r.note) : '', r.error ? h('div', {}, r.error) : '');
      refresh();
    }) }, 'Launch');
    card.querySelector('.row').append(btn);
    return card;
  }));
}

// A refusal also links to a decoding explorer: Etherscan only says "execution reverted".
function link(hash, reverted = false) {
  const u = txUrl(hash);
  if (!u) return h('span', { class: 'mono' }, short(hash));
  const a = h('a', { href: u, target: '_blank', rel: 'noopener', class: 'mono' }, short(hash));
  return reverted && S?.decoder
    ? h('span', {}, a, ' · ', h('a', { href: `${S.decoder}/tx/${hash}`, target: '_blank', rel: 'noopener' }, 'decoded')) : a;
}

// ------------------------------------------------------------------ ledger
// The 5 s refresh redraws the list; only rows not shown before fade in, or the whole ledger blinks every 5 s.
let ledgerShown = null;
function renderLedger(rows) {
  rows = rows.filter((r) => r.kind !== 'plan');
  const key = (r) => `${r.at}|${r.hash ?? r.label ?? r.fn ?? ''}|${r.status ?? ''}`;
  const sig = rows.map(key).join('\n');
  if (sig === ledgerShown?.sig) return;
  const seen = new Set(ledgerShown?.keys ?? []);
  const items = rows.slice().reverse().map((r) => {
    const st = r.status ?? 'info';
    const why = st === 'reverted' || st === 'refused-before-signing' ? reasonOf(r) : null;
    return h('li', { class: seen.has(key(r)) ? st : `${st} new` },
      h('div', { class: 'l1' }, h('span', { class: 'st' }, st === 'refused-before-signing' ? 'refused (software)' : st === 'reverted' ? 'refused (contract)' : st), h('span', { class: 'meta' }, r.at?.slice(11, 19))),
      h('div', { class: 'lbl' }, r.title ?? r.label ?? r.fn ?? ''),
      why && h('div', { class: 'why' }, why),
      r.hash && link(r.hash, st === 'reverted'));
  });
  $('ledger').replaceChildren(...(items.length ? items : [h('li', { class: 'meta' }, 'Nothing yet. Run the routine or launch an attack.')]));
  ledgerShown = { sig, keys: rows.map(key) };
}

async function loadEvidence() {
  const ev = await api('/api/evidence');
  if (!ev) return;
  $('evidence').replaceChildren(
    h('div', {}, `${ev.passed}/${ev.total} scenes as expected · run ${ev.runId}`),
    h('ol', { class: 'ledger' }, ev.results.map((r) => h('li', { class: r.outcome.startsWith('reverted') ? 'reverted' : r.outcome.startsWith('refused') ? 'refused-before-signing' : 'success' },
      h('div', { class: 'l1' }, h('span', { class: 'st' }, `${r.pass ? '✓' : '✗'} ${r.id}`), h('span', { class: 'meta' }, r.outcome)),
      h('div', { class: 'lbl' }, r.title), r.hash && link(r.hash, r.outcome.startsWith('reverted'))))));
}

// ------------------------------------------------------------------ owner / guardian
$('kill').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/guardian/pause', {}); toast('Guardian paused the vault. The agent can do nothing.'); await refresh(); }, 'Pausing…'));
$('unpause').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/owner/unpause', {}); toast('Owner restarted the agent.'); await refresh(); }, 'Restarting…'));

// On Sepolia /api/state makes several RPC calls; a slow one must not stack refreshes behind the owner's clicks.
// One refresh at a time. A refresh asked for during one runs again after it, because the one in flight may
// have read the chain before the action that asked for it was mined.
let refreshing = null;
let again = false;
function refresh() {
  if (refreshing) { again = true; return refreshing; }
  refreshing = (async () => {
    try {
      do {
        again = false;
        renderState(await api('/api/state'));
        renderLedger(await api('/api/ledger'));
      } while (again);
    } catch (e) { toast(e.message); } finally { refreshing = null; }
  })();
  return refreshing;
}

await refresh();
$('instruction').textContent = `Owner: “${S.instruction}”`;
await Promise.all([loadInbox(), loadAttacks(), loadEvidence(), loadSamples(), loadChat()]);
if (!S.allowLive) for (const id of ['mode', 'cmode', 'tmode']) $(id).querySelector('[value="live"]').disabled = true;
setInterval(() => refreshing || refresh(), 5000);
