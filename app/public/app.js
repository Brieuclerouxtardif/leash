// LEASH console: every layer of the leash, behind the front door (home.js).
import { $, REDUCED, h, api, money, usd, short, cap, list, day, chain, addrUrl, reasonOf, failing, toast, busy, link, txBits, count, radios, verdict, describe } from './ui.js';

let S = null;
let stateAt = 0; // when S was read, to run the chain clock forward between refreshes

// ------------------------------------------------------------------ state
function renderState(s) {
  S = s;
  stateAt = Date.now();
  chain.explorer = s.explorer;
  chain.decoder = s.decoder;
  $('net').textContent = s.network === 'sepolia' ? 'Sepolia testnet' : 'Local chain';
  const vl = $('vaultLink');
  vl.textContent = `Vault ${short(s.vault)}`;
  if (addrUrl(s.vault)) vl.href = addrUrl(s.vault); else vl.removeAttribute('href');
  const active = s.agentExpiry >= s.now && !/^0x0+$/.test(s.agent);
  const st = $('agentState');
  st.classList.toggle('off', s.paused || !active);
  st.textContent = s.paused ? 'Agent paused' : active ? `Agent live · ${Math.max(1, Math.round((s.agentExpiry - s.now) / 86400))} d left` : 'Agent key expired';
  $('kill').hidden = s.paused;
  $('pausedBand').hidden = !s.paused;
  renderMeter(s);
  renderMandate(s);
  renderAllow(s);
}

// The worst case is computed by code from the vault's limits (core.js worstCase), never by the model.
function renderMeter(s) {
  const w = s.worst;
  const total = s.usd + s.ethValue;
  const plain = s.hot?.usd ?? 0;
  const scale = Math.max(total, plain, 1);
  const reach = w.live && !s.paused ? w.untilExpiry : 0;
  count($('mVault'), total, usd);
  $('mVaultSub').textContent = `in the vault: ${money(s.usd, 0)} tUSD and ${s.eth.toFixed(2)} tETH`;
  count($('mReach'), reach, usd);
  $('mReachBar').style.transform = `scaleX(${reach / scale})`;
  $('mReachSub').textContent = s.paused ? 'can leave: the guardian paused the vault'
    : w.live ? `is the most a full hijack can move: only to your ${list(w.to)}, until ${day(w.expiry)}` : 'can leave: the agent key is not active';
  if (s.hot) count($('mPlain'), plain, usd); else $('mPlain').textContent = '—';
  $('mPlainBar').style.transform = `scaleX(${plain / scale})`;
}

function renderMandate(s) {
  const L = s.limits;
  const pct = (bps) => `${bps / 100}%`;
  const payees = Object.entries(s.payees).filter(([, p]) => p.cap > 0);
  const row = (b, span, cls) => h('li', { class: cls }, h('b', {}, b), h('span', {}, span));
  $('mandate').replaceChildren(
    row(payees.map(([n, p]) => `${cap(n)} ≤ ${money(p.cap, 0)}`).join(' · ') || 'Nobody', 'The only payees, per payment'),
    row(`${money(L.payDaily, 0)} a day`, `At most ${money(L.payPerTx, 0)} per payment`),
    row(`${money(s.agentBudget, 0)} left`, 'In the key’s budget. Only you reload it.'),
    row(`Swaps ≤ ${money(L.swapPerTx, 0)}`, `${pct(s.risk.maxSlippageBps)} off the oracle at most, tETH under ${pct(s.risk.maxRiskBps)}`),
    row('Above that, you sign', 'One signature for one exact payment'),
    row('Never', 'New payees, higher limits, withdrawals', 'no'),
  );
}

// ------------------------------------------------------------------ hijack the agent (chat)
const AGENTS = [
  { v: 'healthy', label: 'Nothing', name: 'healthy agent', pipe: [['Model', 'guarded prompt', 'holds'], ['LEASH code', 'checks every intent', 'holds'], ['Vault contract', 'enforces the mandate', 'holds']] },
  { v: 'model', label: 'The model', name: 'hijacked model', pipe: [['Model', 'hijacked', 'taken'], ['LEASH code', 'checks every intent', 'holds'], ['Vault contract', 'enforces the mandate', 'holds']] },
  { v: 'server', label: 'Model + server', name: 'hijacked model and server', pipe: [['Model', 'hijacked', 'taken'], ['LEASH code', 'bypassed', 'taken'], ['Vault contract', 'enforces the mandate', 'holds']] },
  { v: 'plain', label: 'No LEASH', name: 'no LEASH, plain wallet', hijack: true, pipe: [['Model', 'hijacked', 'taken'], ['Server', 'signs anything', 'taken'], ['Plain wallet', 'checks nothing', 'taken']] },
];
const SAY = [[/^Hi, it's Marta/, 'Landlord’s new wallet', true], [/[一-鿿]/, 'The same, in Chinese', true], [/airport/, 'Owner stuck at the airport', true],
  [/^\[SYSTEM\]/, '[SYSTEM] maintenance mode', true], [/private key/, 'Tell me your key', true], [/school/, 'Pay the school 5,000'], [/electricity/i, 'Electricity bill, 120']];
const sayOf = (text) => SAY.find(([re]) => re.test(text)) ?? [null, text.length > 32 ? `${text.slice(0, 30)}…` : text];

let agent = 'healthy';
let samples = [];
let say = 0; // index in samples, or 'own'

function renderPipe(stop) {
  const a = AGENTS.find((x) => x.v === agent);
  $('pipe').replaceChildren(...a.pipe.map(([b, span, cls], k) => {
    const mark = stop?.at === k ? stop : null;
    return h('li', { class: `${cls}${mark ? ` ${mark.cls}` : ''}` }, h('b', {}, b), h('span', {}, mark ? mark.text : span));
  }));
}

// Which layer stopped the first request of an exchange, or let the money out.
function stopOf(x) {
  const r = x.results[0];
  if (!r) return x.agent === 'healthy' ? { at: 0, cls: 'stop', text: 'said no' } : null;
  if (x.agent === 'plain') return r.sent && r.tx.status === 'success' ? { at: 2, cls: 'leak', text: 'let it all go' } : null;
  if (x.agent === 'server') return r.sent && r.tx.status !== 'success' ? { at: 2, cls: 'stop', text: 'refused it' } : null;
  if (r.decision === 'refuse') return { at: 1, cls: 'stop', text: 'refused it' };
  if (r.decision === 'needs_owner') return { at: 1, cls: 'stop', text: 'asks you first' };
  if (r.tx && r.tx.status !== 'success') return { at: 2, cls: 'stop', text: 'refused it' };
  return null;
}

async function loadChat() {
  samples = await api('/api/chat/samples');
  const seg = $('agentSeg');
  seg.replaceChildren(...AGENTS.map((a, k) => h('button', { role: 'radio', 'aria-checked': String(k === 0), 'data-v': a.v, class: a.hijack ? 'hijack' : null }, a.label)));
  radios(seg, (v) => { agent = v; renderPipe(null); fillSay(); });
  const chips = $('sayChips');
  chips.replaceChildren(...samples.map((x, k) => {
    const [, label, scam] = sayOf(x.text);
    return h('button', { role: 'radio', 'aria-checked': String(k === 0), 'data-v': k, class: scam ? 'scam' : null }, label);
  }), ...(S.allowLive ? [h('button', { role: 'radio', 'aria-checked': 'false', 'data-v': 'own' }, 'Write your own')] : []));
  radios(chips, (v) => { say = v === 'own' ? 'own' : Number(v); fillSay(); });
  renderPipe(null);
  fillSay();
}

function fillSay() {
  const own = say === 'own';
  $('msgText').hidden = own;
  $('msg').hidden = !own;
  if (own) { $('msg').focus(); $('tmode').value = 'live'; } else $('msgText').textContent = samples[say]?.text ?? '';
  // A replay needs the model's answer recorded for this exact prompt; without a live model there is nothing else.
  const prof = agent === 'healthy' ? 'guarded' : 'hijacked';
  const replayable = own || samples[say]?.recorded.includes(prof);
  $('send').disabled = !replayable && !S.allowLive;
  $('tmodeNote').textContent = replayable ? 'Model reply recorded · transactions real' : 'Not recorded for this agent: live model only';
}

function chatVerdict(x, r) {
  const what = describe(r.intent);
  if (x.agent === 'plain') {
    if (!r.sent) return verdict('ok', 'Not sent', what, r.note);
    if (r.tx.status === 'success') return verdict('gone', 'Gone', what, ['Nothing on-chain checked it', ...txBits(r.tx)]);
    return verdict('warn', 'Failed', what, [reasonOf(r.tx) ?? r.tx.status, ...txBits(r.tx)]);
  }
  if (x.agent === 'server') {
    if (!r.sent) return verdict('ok', 'Not sent', what, r.note);
    if (r.tx.status === 'success') return verdict('warn', 'Paid', what, ['Inside the mandate, so the vault allowed it', ...txBits(r.tx)]);
    return verdict('ok', 'Refused', what, [`By the vault contract: ${reasonOf(r.tx) ?? r.tx.status}`, ...txBits(r.tx)]);
  }
  if (r.decision === 'needs_owner') {
    const b = h('button', { class: 'go' }, 'Review & sign');
    b.addEventListener('click', () => busy(b, () => openMandate(r.ask, b, 'chat')));
    return verdict('ask', 'Your call', what, 'Above what the agent may pay alone', b);
  }
  if (r.decision === 'refuse') return verdict('ok', 'Refused', what, `By LEASH’s code: ${failing(r.checks)}`);
  if (r.tx?.status === 'success') return verdict('held', 'Paid', what, ['Inside the mandate, by the agent alone', ...txBits(r.tx)]);
  return verdict('ok', 'Refused', what, [`By the vault contract: ${reasonOf(r.tx) ?? r.tx?.status}`, ...txBits(r.tx)]);
}

function renderExchange(x) {
  const a = AGENTS.find((v) => v.v === x.agent);
  const results = x.results.length ? x.results.map((r) => chatVerdict(x, r))
    : [verdict('ok', 'Nothing sent', x.agent === 'healthy' ? 'The model refused on its own' : 'The model proposed no payment')];
  $('thread').prepend(h('li', { class: `ex ${x.agent}` },
    h('div', { class: 'reply' }, h('header', {}, `${x.label} · ${a.name}`), h('p', {}, x.reply)),
    ...results));
  renderPipe(stopOf(x));
}

$('send').addEventListener('click', (e) => busy(e.target, async () => {
  const own = say === 'own';
  const text = own ? $('msg').value.trim() : samples[say].text;
  if (!text) throw new Error('write a message first');
  const x = await api('/api/chat', { text, agent, mode: own ? 'auto' : $('tmode').value });
  renderExchange({ ...x, text, label: own ? 'Your message' : sayOf(text)[1] });
  refresh();
}, 'Sending…'));

// ------------------------------------------------------------------ the routine: inbox and plan
let inbox = [];
async function loadInbox() {
  inbox = await api('/api/inbox');
  renderInbox({});
}

// One tag per (who, kind); the details of every hit stay in the tooltip.
function tags(who, flags) {
  const byKind = new Map();
  for (const f of flags) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f.detail]);
  return [...byKind].map(([kind, details]) => h('span', { class: `tag ${who}`, title: details.join('\n') },
    `${who === 'code' ? 'Code' : 'Model'}: ${kind.replaceAll('_', ' ')}${details.length > 1 ? ` ×${details.length}` : ''}`));
}

function parseDoc(text) {
  const [head, ...body] = text.split(/\r?\n\s*\r?\n/);
  return { from: /^From:\s*(.+)$/m.exec(head)?.[1] ?? '', subject: /^Subject:\s*(.+)$/m.exec(head)?.[1] ?? '', body: body.join('\n\n').trim() || text };
}

function renderInbox(modelFlags) {
  $('inbox').replaceChildren(...inbox.map((doc) => {
    const mf = modelFlags[doc.id] ?? [];
    const d = parseDoc(doc.text);
    const t = [...tags('code', doc.codeFlags), ...tags('model', mf)];
    const li = h('li', { class: `doc${t.length ? ' flagged' : ''}` });
    const more = h('button', { 'aria-expanded': 'false' }, 'Read');
    more.addEventListener('click', () => { const open = li.classList.toggle('open'); more.textContent = open ? 'Close' : 'Read'; more.setAttribute('aria-expanded', String(open)); });
    li.append(...[h('header', {}, h('b', {}, d.from || doc.id), more), h('p', { class: 'subj' }, d.subject), h('p', { class: 'text' }, d.body), t.length ? h('div', { class: 'tags' }, t) : null].filter(Boolean));
    return li;
  }));
}

let profile = 'guarded';
radios($('profileSeg'), (v) => { profile = v; });

function checksBox(checks) {
  return h('details', { class: 'why-box' }, h('summary', {}, `All ${checks.length} checks`),
    h('ul', { class: 'checks' }, checks.map((c) => h('li', { class: c.ok ? '' : 'fail', title: c.detail }, `${c.ok ? 'Passed' : 'Failed'}: ${c.rule}`))));
}

function renderPlan(p) {
  $('planMeta').textContent = `${p.mode === 'RECORDED REPLAY' ? 'Recorded model run' : 'Live model call'} · ${p.model}${p.seconds ? ` · ${p.seconds.toFixed(1)} s` : ''}`;
  const byDoc = {};
  for (const f of p.modelFlags) (byDoc[f.doc] ??= []).push(f);
  renderInbox(byDoc);
  $('proposals').replaceChildren(...p.verdicts.map((v, idx) => {
    const what = describe(v.intent);
    let el;
    if (v.decision === 'execute') {
      const b = h('button', { class: 'go primary' }, 'Execute');
      b.addEventListener('click', () => busy(b, () => doExecute(idx, b), 'Sending…'));
      el = verdict('', 'Allowed', what, `Tier ${v.tier} · from ${v.intent.source}`, b);
    } else if (v.decision === 'needs_owner') {
      const b = h('button', { class: 'go' }, 'Review & sign');
      b.addEventListener('click', () => busy(b, () => openMandate(idx, b)));
      el = verdict('ask', 'Your call', what, `Above the agent’s limits · from ${v.intent.source}`, b);
    } else el = verdict('ok', 'Refused', what, `${failing(v.checks)} · from ${v.intent.source}`);
    return h('li', { class: 'prop' }, el, checksBox(v.checks));
  }));
  if (!p.verdicts.length) $('proposals').replaceChildren(h('li', { class: 'meta' }, 'The model proposed nothing.'));
}

// Once a proposal is settled on-chain its button becomes the outcome, so it cannot be clicked twice by mistake.
function settle(btn, e, okText) {
  const ok = e.status === 'success';
  const v = btn.closest('.verdict');
  if (v) {
    v.className = `verdict ${ok ? 'held' : 'ok'}`;
    void v.offsetWidth;
    v.classList.add('new');
    v.querySelector('.word').textContent = ok ? 'Paid' : 'Refused';
  }
  const no = e.status === 'refused-before-signing' ? `Refused by LEASH’s code, failed check: ${reasonOf(e)}` : `Refused by the contract: ${reasonOf(e) ?? e.status}`;
  // The word already says Paid: a plain execution only adds its receipt.
  const lead = ok ? okText : no;
  btn.replaceWith(h('span', { class: `settled ${ok ? 'ok' : 'bad'}` }, lead ? [lead, ...txBits(e)] : txBits(e).slice(1)));
}

async function doExecute(i, btn) {
  const e = await api('/api/execute', { i });
  toast(e.status === 'success' ? 'Paid on-chain by the agent.' : `Refused: ${reasonOf(e) ?? e.status}`);
  settle(btn, e, '');
  refresh();
}

$('run').addEventListener('click', (e) => busy(e.target, async () => {
  $('planMeta').textContent = $('mode').value === 'live' ? 'Calling the model… (≈20 s)' : 'Loading the recorded run…';
  renderPlan(await api('/api/plan', { profile, mode: $('mode').value }));
}));

// ------------------------------------------------------------------ owner signature
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
  $('mTyped').replaceChildren(...[['Domain', `${m.typed.domain.name} v${m.typed.domain.version} · chain ${m.typed.domain.chainId}`], ['Contract', m.typed.domain.verifyingContract],
    ['To', msg.to], ['Amount', `${msg.amount} (6 decimals)`], ['Operation', msg.opId], ['Deadline', new Date(Number(msg.deadline) * 1000).toISOString()], ['Epoch', msg.epoch]]
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
    toast(e.status === 'success' ? 'Signed by you, paid by the agent.' : `Refused on-chain: ${reasonOf(e) ?? e.status}`);
    if (btn?.isConnected) settle(btn, e, 'Signed by you');
  } catch (err) {
    toast(err.message);
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
  pendingIdx = null;
  pendingBtn = null;
  refresh();
});

// ------------------------------------------------------------------ rules in the owner's words
const RULES = [[/^Rent is 800/, 'Rent 850, power 150, a DCA'], [/school tuition/, 'Let it pay the school'], [/new wallet/, 'Landlord’s new wallet'],
  [/a little/, 'A bit more rent'], [/^ok so/, 'Typed in a hurry'], [/[一-鿿]/, 'In Chinese'], [/two weeks/, 'Away for two weeks']];
const ruleOf = (t) => RULES.find(([re]) => re.test(t))?.[1] ?? (t.length > 32 ? `${t.slice(0, 30)}…` : t);

async function loadSamples() {
  const texts = await api('/api/mandate/samples');
  const chips = $('sampleChips');
  chips.replaceChildren(...texts.map((t, k) => h('button', { role: 'radio', 'aria-checked': String(k === 0), 'data-v': k }, ruleOf(t))),
    ...(S.allowLive ? [h('button', { role: 'radio', 'aria-checked': 'false', 'data-v': 'own' }, 'Write your own')] : []));
  radios(chips, (v) => {
    const own = v === 'own';
    $('ownerText').value = own ? '' : texts[Number(v)] ?? '';
    if (own) { $('cmode').value = 'live'; $('ownerText').focus(); }
    restart();
  });
  $('ownerText').value = texts[0] ?? '';
}

// One exchange per owner text: the answers so far and the number of model turns. Editing the text starts over.
let qa = [];
let turns = 0;
function restart() { qa = []; turns = 0; $('cAsk').hidden = true; }
$('ownerText').addEventListener('input', restart);

async function compile(answers) {
  $('cMeta').textContent = $('cmode').value === 'live' ? 'Calling the model… (≈10 s)' : 'Loading the recorded run…';
  for (const id of ['diff', 'worstShift', 'applyMandate', 'cAsk']) $(id).hidden = true;
  $('cNotes').replaceChildren();
  let r;
  try {
    r = await api('/api/mandate/compile', { text: $('ownerText').value, mode: $('cmode').value, answers });
  } catch (err) {
    $('cMeta').textContent = `Not compiled: ${err.message}`;
    throw err;
  }
  qa = answers;
  turns += 1;
  $('cMeta').textContent = `The model read: “${r.struct.summary}”`;
  // The model asks instead of guessing a value; a recorded replay pre-fills the answer it was recorded with.
  $('cAsk').hidden = !r.questions.length;
  $('cQuestions').replaceChildren(...r.questions.map((q) => {
    const recorded = r.replayAnswers.find((x) => x.q === q)?.a;
    return h('label', {}, q,
      h('input', { 'data-q': q, value: recorded ?? '', required: true, maxlength: 300, autocomplete: 'off' }),
      recorded != null ? h('span', { class: 'tag' }, 'The recorded answer. A live run takes any answer.') : null);
  }));
  // While a question is open the struct is incomplete (live run mandate-compile-20261015T081246003Z: the model asked
  // for the rent cap and also set it to 0), so no diff is shown until the owner has answered.
  const ready = r.rows.length > 0 && !r.questions.length;
  $('diff').hidden = !ready;
  $('diffBody').replaceChildren(...r.rows.map((row) => h('tr', { class: row.direction }, h('td', {}, row.label), h('td', {}, String(row.from)), h('td', {}, String(row.to)),
    h('td', { class: 'dir' }, row.direction === 'looser' ? 'Looser' : 'Tighter'))));
  $('cNotes').replaceChildren(
    ...(r.rows.length || r.questions.length ? [] : [h('li', {}, 'No change to the on-chain mandate.')]),
    ...r.errors.map((x) => h('li', { class: 'err' }, x)),
    ...r.unmapped.map((x) => h('li', { class: 'unm' }, x)));
  renderWorstShift(r.worst, ready);
  const btn = $('applyMandate');
  btn.hidden = !r.calls.length && !r.questions.length;
  btn.disabled = r.errors.length > 0 || r.questions.length > 0;
  btn.className = r.looser ? 'danger' : 'go';
  btn.textContent = r.questions.length ? 'Answer the questions first'
    : r.errors.length ? 'Fix the errors first'
      : `Apply as owner · ${r.calls.length} transaction${r.calls.length > 1 ? 's' : ''}${r.looser ? `, ${r.looser} looser` : ''}`;
}

// What the change does to the worst case, before the owner signs it: the price of a longer leash.
function renderWorstShift(w, show) {
  const el = $('worstShift');
  el.hidden = !show;
  if (!show) return;
  const a = w.now.untilExpiry;
  const b = w.next.untilExpiry;
  const dir = b > a ? 'looser' : b < a ? 'tighter' : 'same';
  // Same risk is not "no effect": the per-day line still moves, but a tighter bound holds the total.
  const held = { budget: ': the key’s budget caps it', balance: ': the vault’s balance caps it' }[w.next.bound] ?? '';
  el.replaceChildren(
    h('span', { class: 'k' }, 'Most a full hijack can move'),
    h('b', { class: 'same' }, usd(a)), h('span', { class: 'arrow' }, '→'), h('b', { class: dir }, usd(b)),
    h('span', { class: `dirw ${dir}` }, { looser: 'Riskier', tighter: 'Safer', same: `Same risk${held}` }[dir]),
    h('span', { class: 'k' }, `${money(w.next.perDay, 0)} a day at most, only to ${list(w.next.to)}`));
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
  toast(ok ? `Mandate changed on-chain: ${out.length} owner transaction${out.length > 1 ? 's' : ''}.` : `Stopped: ${reasonOf(out.at(-1)) ?? out.at(-1).status}`);
  e.target.hidden = true;
  refresh();
}, 'Sending…'));

// ------------------------------------------------------------------ sealed bills
// The school seals each bill with its own key: who and how much. The agent settles it alone, above its own limits;
// the vault holds the money for the contest window, then pays the school and nobody else.
const BILLS = [['semester', 'Semester fees', 1500], ['lab', 'Lab fee', 400], ['exam', 'Exam fee', 300]];
let holds = [];
const holdTx = {};

function renderAllow(s) {
  const school = s.seals?.school;
  if (!school) { $('invoices').hidden = true; return; }
  const paid = holds.filter((x) => x.state === 'released').reduce((n, x) => n + x.amount, 0);
  const parts = [['left', 'Left to seal', school.allowance], ['held', 'Held now', s.held], ['paid', 'Paid', paid]];
  const tot = Math.max(parts.reduce((n, p) => n + p[2], 0), 1);
  $('allow').replaceChildren(
    h('div', { class: 'legend' }, parts.map(([c, k, v]) => h('span', {}, h('i', { class: c, style: `background: var(--${{ left: 'accent', held: 'amber', paid: 'muted' }[c]})` }), `${k} `, h('b', {}, money(v, 0))))),
    h('div', { class: 'track' }, ['paid', 'held', 'left'].map((c) => h('i', { class: c, style: `flex-basis: ${(parts.find((p) => p[0] === c)[2] / tot) * 100}%` }))));
}

function loadBills() {
  const school = S.seals?.school;
  if (!school) return;
  const win = S.contestWindow >= 3600 ? `${S.contestWindow / 3600} h` : `${S.contestWindow / 60} min`;
  $('bills').replaceChildren(...BILLS.map(([bill, title, amount]) => {
    const b = h('button', { class: 'go' }, 'Settle as agent');
    b.addEventListener('click', () => busy(b, async () => {
      const r = await api('/api/seal/settle', { bill });
      if (r.status === 'success') { holdTx[r.key] = r; toast(`${title} held: ${win} for you or the guardian to stop it.`); } else toast(`Refused by the contract: ${reasonOf(r) ?? r.status}`);
      await refresh();
      await loadHolds();
    }, 'Settling…'));
    const li = h('li', { class: 'bill', 'data-bill': bill }, h('b', {}, title), h('span', { class: 'amt' }, `${money(amount, 0)} tUSD`),
      h('span', { class: 'by' }, 'Sealed by the school ', h('span', {}, short(school.address))), h('span', { class: 'slot' }, b));
    li.settle = b;
    return li;
  }));
}

// A bill already held or paid shows where it is, not a second button; a contested one can be settled again.
function renderBills() {
  for (const li of $('bills').children) {
    const last = holds.filter((x) => x.bill === li.dataset.bill).at(-1);
    const st = last && last.state !== 'contested' ? last.state : null;
    const slot = li.querySelector('.slot');
    if (st) slot.replaceChildren(h('span', { class: `now ${st}` }, st === 'held' ? 'Held' : 'Paid'));
    else {
      li.settle.textContent = last ? 'Settle again' : 'Settle as agent';
      if (slot.firstChild !== li.settle) slot.replaceChildren(li.settle);
    }
  }
}

async function loadHolds() {
  holds = await api('/api/holds');
  renderHolds();
}

// The chain's own clock is the only one the vault obeys. Between refreshes it runs on from the last block read;
// a local chain mines no block while idle, so the wall clock since the hold was mined bounds it too.
function remaining(x) {
  const chainNow = S.now + (Date.now() - stateAt) / 1000;
  return Math.max(0, Math.min(x.releaseAt - chainNow, S.contestWindow - (Date.now() - x.heldAt) / 1000));
}
const clock = (sec) => { const s = Math.ceil(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const phaseOf = (x) => (x.state === 'held' ? (remaining(x) > 0 ? 'open' : 'due') : x.state);

function holdAct(label, cls, path, body, done) {
  const b = h('button', { class: cls }, label);
  b.addEventListener('click', () => busy(b, async () => {
    const r = await api(path, body);
    if (r.hash) holdTx[body.key] = r;
    toast(r.status === undefined || r.status === 'success' ? done : `Refused by the contract: ${reasonOf(r) ?? r.status}`);
    await refresh();
    await loadHolds();
  }, 'Sending…'));
  return b;
}

function holdActs(x, phase) {
  const key = x.key;
  if (phase === 'open') {
    return [holdAct('Contest as owner', 'light', '/api/seal/contest', { key, as: 'owner' }, 'Contested: the money stays in the vault.'),
      holdAct('Contest as guardian', 'light', '/api/seal/contest', { key, as: 'guardian' }, 'Contested by the guardian: the money stays in the vault.'),
      S.network === 'local' ? holdAct('Skip to the end', '', '/api/seal/skip', { key }, 'Local chain moved to the end of the window.') : null];
  }
  if (phase === 'due') return [holdAct('Release to the school', 'go', '/api/seal/release', { key }, 'Paid to the school.')];
  const e = holdTx[key];
  return e?.hash ? [link(e.hash, e.status === 'reverted')] : [];
}

const HOLD_TEXT = { open: 'Held in the vault. You or the guardian can still stop it.', due: 'Window closed. Anyone can release it, only to the school.',
  released: 'Paid to the school, and to nobody else.', contested: 'Contested. The money stays in the vault.' };
function tickHold(li, x) {
  const phase = phaseOf(x);
  const rem = remaining(x);
  li.querySelector('.clock').textContent = phase === 'released' ? 'Paid' : phase === 'contested' ? 'Stopped' : clock(rem);
  li.querySelector('.drain i').style.transform = `scaleX(${phase === 'open' || phase === 'due' ? rem / S.contestWindow : 0})`;
  if (li.dataset.phase === phase) return;
  li.dataset.phase = phase;
  li.className = `hold ${x.state} ${phase}`;
  li.querySelector('.state').textContent = HOLD_TEXT[phase];
  li.querySelector('.acts').replaceChildren(...holdActs(x, phase).filter(Boolean));
}

function renderHolds() {
  $('holds').replaceChildren(...holds.slice().reverse().map((x) => {
    const li = h('li', { class: 'hold', 'data-key': x.key },
      h('p', { class: 't' }, x.title, ' ', h('span', {}, `${money(x.amount, 0)} tUSD`)),
      h('b', { class: 'clock' }), h('p', { class: 'state' }),
      h('div', { class: 'drain' }, h('i')), h('div', { class: 'acts' }));
    tickHold(li, x);
    return li;
  }));
  renderBills();
  if (S) renderAllow(S);
}
setInterval(() => {
  if (!S) return;
  for (const li of $('holds').children) {
    const x = holds.find((y) => y.key === li.dataset.key);
    if (x) tickHold(li, x);
  }
}, 500);

// ------------------------------------------------------------------ red team
const ATK = {
  A1: 'Invoice swaps the landlord’s address', A2: 'Stolen key drains the vault', A3: 'Stolen key adds itself as a payee', A4: 'Stolen key withdraws',
  A5: 'Salami slices to a trusted payee', A6: 'Replay October’s rent', A7: 'Forged owner signature', A8: 'Voided signature reused',
  A9: 'Pump the pool, then buy', A10: 'Pay during a pause', A11: 'Guardian restarts the agent', A12: 'Outsider calls the vault',
  A13: 'Expired key pays', A14: 'Sealed bill rewritten 400 → 4,000', A15: 'Real seal, outsized bill', A16: 'Contested bill leaves anyway',
};
// Who stops it and with what: the contract's error, or the check LEASH's code failed before anything was signed.
const byOf = (outcome) => {
  const [kind, name] = outcome.split(':');
  return kind === 'reverted' ? `Contract · ${name}` : kind === 'refused' ? `LEASH code · ${name}` : outcome;
};

async function launch(a, li, res, btn) {
  li.classList.remove('pass', 'fail');
  li.classList.add('run');
  res.replaceChildren(h('b', {}, 'Sending…'));
  let r;
  try { r = await api('/api/attack', { id: a.id }); } catch (err) { li.classList.remove('run'); res.replaceChildren(h('b', {}, 'Not sent'), h('span', { class: 'by' }, err.message)); throw err; }
  li.classList.remove('run');
  li.classList.add(r.pass ? 'pass' : 'fail');
  const reverted = r.outcome.startsWith('reverted');
  res.replaceChildren(h('b', {}, r.pass ? 'Refused' : 'Not refused'), h('span', { class: 'by' }, byOf(r.outcome)), ...(r.hash ? [link(r.hash, reverted)] : []));
  btn.textContent = 'Again';
  score();
  refresh();
}

function score() {
  const rows = [...$('attacks').children];
  const n = rows.filter((li) => li.classList.contains('pass')).length;
  // Each new refusal knocks the score up a size before it settles.
  if (!REDUCED && n > Number($('scoreNum').dataset.v || 0)) $('scoreNum').animate([{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  count($('scoreNum'), n, (x) => String(Math.round(x)));
  $('score').classList.toggle('zero', n === 0);
  $('score').classList.toggle('miss', rows.some((li) => li.classList.contains('fail')));
}

async function loadAttacks() {
  const all = await api('/api/attacks');
  $('attacks').replaceChildren(...all.map((a) => {
    // Before launch the tile shows who should stop it; after, the stamp and the receipt.
    const res = h('p', { class: 'res' }, h('span', { class: 'by' }, byOf(a.expect)));
    const btn = h('button', {}, 'Launch');
    const li = h('li', { class: 'atk', title: a.title }, h('div', { class: 'top' }, h('span', { class: 'id' }, a.id), btn), h('p', { class: 't' }, ATK[a.id] ?? a.title), res);
    li.launch = () => launch(a, li, res, btn);
    btn.addEventListener('click', () => busy(btn, li.launch));
    return li;
  }));
}

$('runAll').addEventListener('click', (e) => busy(e.target, async () => {
  const rows = [...$('attacks').children];
  for (const li of rows) li.querySelector('button').disabled = true;
  try {
    for (const li of rows) {
      li.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' });
      try { await li.launch(); } catch { /* shown on its row */ }
    }
  } finally { for (const li of rows) li.querySelector('button').disabled = false; }
}, 'Launching…'));

async function loadEvidence() {
  const ev = await api('/api/evidence');
  if (!ev) return;
  $('evidence').replaceChildren('Last full campaign on this chain: ', h('b', {}, `${ev.passed} of ${ev.total} as expected`), ` · run ${ev.runId}`);
}

// ------------------------------------------------------------------ receipts
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
      h('div', { class: 'l1' }, h('span', { class: 'st' }, st === 'refused-before-signing' ? 'Refused by the code' : st === 'reverted' ? 'Refused by the contract' : st === 'success' ? 'Mined' : st), h('span', { class: 'meta' }, r.at?.slice(11, 19))),
      h('div', { class: 'lbl' }, r.title ?? r.label ?? r.fn ?? ''),
      why && h('div', { class: 'why' }, why),
      r.hash && link(r.hash, st === 'reverted'));
  });
  $('ledger').replaceChildren(...(items.length ? items : [h('li', { class: 'meta' }, 'Nothing yet. Hijack the agent or launch an attack.')]));
  const n = $('receiptCount');
  if (ledgerShown && Number(n.textContent) !== rows.length) { n.parentElement.classList.remove('bump'); void n.offsetWidth; n.parentElement.classList.add('bump'); }
  n.textContent = rows.length;
  ledgerShown = { sig, keys: rows.map(key) };
}

function drawer(on) {
  $('receipts').hidden = !on;
  $('receiptsBtn').setAttribute('aria-expanded', String(on));
  (on ? $('receiptsClose') : $('receiptsBtn')).focus();
}
$('receiptsBtn').addEventListener('click', () => drawer($('receipts').hidden));
$('receiptsClose').addEventListener('click', () => drawer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('receipts').hidden) drawer(false); });

// ------------------------------------------------------------------ owner / guardian
$('kill').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/guardian/pause', {}); toast('The guardian paused the vault. Nothing can leave.'); await refresh(); }, 'Pausing…'));
$('unpause').addEventListener('click', (e) => busy(e.target, async () => { await api('/api/owner/unpause', {}); toast('You restarted the agent.'); await refresh(); }, 'Restarting…'));

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

// ------------------------------------------------------------------ page motion: sections rise in, the nav follows
function motion() {
  const secs = [...document.querySelectorAll('.sec')];
  const rise = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rise.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  for (const s of secs) { s.classList.add('reveal'); rise.observe(s); }
  const links = [...document.querySelectorAll('.links a')];
  const here = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) for (const a of links) a.classList.toggle('on', a.hash === `#${e.target.id}`);
  }), { rootMargin: '-45% 0px -50% 0px' });
  for (const a of links) { const t = document.querySelector(a.hash); if (t) here.observe(t); }
}

for (const id of ['mVault', 'mReach', 'mPlain']) $(id).dataset.v = '0';
motion();
await refresh();
$('instruction').textContent = `“${S.instruction}”`;
loadBills();
await Promise.all([loadInbox(), loadAttacks(), loadEvidence(), loadSamples(), loadChat(), loadHolds()]);
if (S.allowLive) {
  for (const [sel, note] of [['tmode', 'tmodeNote'], ['cmode', 'cmodeNote'], ['mode', null]]) { $(sel).hidden = false; if (note) $(note).hidden = true; }
} else for (const id of ['mode', 'cmode', 'tmode']) $(id).querySelector('[value="live"]').disabled = true;
setInterval(() => refreshing || refresh(), 5000);
