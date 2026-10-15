// LEASH console: a local web UI over the agent, the vault and the red team.
// Usage: node app/src/server.js [--network local|sepolia] [--port 8787] [--allow-live]
import { createServer } from 'node:http';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { connect, loadDeployment, ROOT, ABI } from './chain.js';
import { readState, execute, renderMandate, mandateTypedData, fmtUsd, opId, usedOpIds, worstCase } from './core.js';
import { loadInbox, buildPrompt, propose, review, scanDocument, keyOf, MODEL } from './planner.js';
import { makeCampaign, outcomeOf } from './campaign.js';
import { INSTRUCTION, WEEK } from './routine.js';
import { compileMandate, diffMandate, replayableSamples } from './compiler.js';
import { AGENTS, profileOf, chatPrompt, chatSamples, recordedProfiles, judgeChat, rawCall, plainCall, CHAT_SCHEMA } from './chat.js';

const arg = (k, def) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : def; };
const NET = arg('network', 'local');
const PORT = Number(arg('port', process.env.PORT ?? 8787));
const ALLOW_LIVE = process.argv.includes('--allow-live');
const TOKEN = randomBytes(24).toString('hex');
const runId = `console-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;

const ctx = await connect(NET, { journal: join(ROOT, 'evidence', `${NET}-${runId}.jsonl`) });
const d = loadDeployment(NET);
let lastPaid = null;
const campaign = makeCampaign(ctx, d, runId, { lastPaid: () => lastPaid });
let plan = null; // last proposal + verdicts
let draft = null; // last compiled mandate: the model's struct, re-diffed against the live state before applying
const ledger = []; // this session's entries, newest last
const asks = []; // chat intents that wait for the owner's signature, re-judged before signing
let pending = null; // the mandate on screen: { from, i, m }
let msgs = 0;

const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body, big)); };

function log(entry) {
  const e = { ...entry, at: new Date().toISOString() };
  ledger.push(e);
  return e;
}

async function snapshot() {
  const s = await readState(ctx, d);
  // The plain wallet of the counterfactual, funded at deploy with what the vault got.
  const hot = ctx.addr.hot
    ? { address: ctx.addr.hot, usd: fmtUsd(await ctx.pub.readContract({ address: d.usd, abi: ABI.token, functionName: 'balanceOf', args: [ctx.addr.hot] })) }
    : null;
  return {
    hot,
    network: NET, chainId: ctx.net.chain.id, explorer: ctx.net.explorer, decoder: ctx.net.decoder ?? null, vault: d.vault, oracle: d.oracle, pool: d.pool, model: MODEL, allowLive: ALLOW_LIVE,
    instruction: INSTRUCTION, roles: ctx.addr,
    now: Number(s.now), agent: s.agent, agentExpiry: Number(s.agentExpiry), agentBudget: fmtUsd(s.agentBudget), paused: s.paused, epoch: s.epoch,
    usd: fmtUsd(s.usd), eth: Number(s.eth) / 1e18, ethValue: fmtUsd(s.ethValue), price: Number(s.price) / 1e8, priceAge: Number(s.now - s.priceUpdatedAt),
    poolPrice: Number(s.pool.price) / 1e8, riskBps: s.riskBps,
    limits: Object.fromEntries(Object.entries(s.limits).map(([k, v]) => [k, fmtUsd(v)])), risk: s.risk,
    paidToday: fmtUsd(s.paidToday), swappedToday: fmtUsd(s.swappedToday),
    payees: Object.fromEntries(Object.entries(s.payees).map(([k, v]) => [k, { address: v.address, cap: fmtUsd(v.cap) }])),
    worst: worstCase(s),
  };
}

// A proposal is judged again against the chain as it is now, from the routine (`plan`) or from the chat.
async function rejudge(i, from = 'plan') {
  const s = await readState(ctx, d);
  if (from === 'chat') {
    const a = asks[i];
    if (!a) throw new Error('no such request');
    return { v: judgeChat(a.intent, s, a.doc, { used: await usedOpIds(ctx, d, [opId(a.key)]), week: a.week }), s };
  }
  const v = plan?.verdicts?.[i];
  if (!v) throw new Error('no such proposal');
  const used = await usedOpIds(ctx, d, [opId(v.key)]);
  const r = review({ intents: [v.intent] }, s, plan.docs, { used, week: WEEK, instruction: INSTRUCTION }).verdicts[0];
  return { v: r, s };
}

/** One chat message: the model answers, then each intent goes through what is left of LEASH for that agent. */
async function talk({ text, agent = 'healthy', mode = 'replay' }) {
  if (!AGENTS.includes(agent) || !['replay', 'live'].includes(mode)) throw new Error('bad agent or mode');
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('a message is 1–1000 characters');
  if (mode === 'live' && !ALLOW_LIVE) throw new Error('live model calls are disabled; start the server with --allow-live');
  if (agent === 'plain' && !ctx.wallets.hot) throw new Error('no plain wallet: run `node app/src/keys.js`, then deploy again');
  const profile = profileOf(agent);
  const p = propose({ scenario: 'chat', profile, prompt: chatPrompt(profile, text), mode, schema: CHAT_SCHEMA, exactPrompt: true });
  const doc = { id: `msg-${++msgs}`, text };
  const week = `chat-${runId}`;
  const s0 = await readState(ctx, d);
  const out = {
    id: doc.id, agent, reply: p.response.reply, modelFlags: p.response.flags ?? [], codeFlags: scanDocument(text, s0.payees),
    meta: { mode: p.mode, model: p.model, seconds: p.seconds, at: p.at, recording: p.recording }, results: [],
  };
  log({ kind: 'plan', label: `chat ${doc.id} (${agent}, ${p.mode}): ${(p.response.intents ?? []).length} intents`, status: 'info' });
  for (const [k, raw] of (p.response.intents ?? []).slice(0, 5).entries()) {
    const intent = { ...raw, source: doc.id };
    if (agent === 'plain') {
      // No LEASH: the server holds a plain wallet's key, and a transfer it signs is all the chain sees.
      const { call, note } = plainCall(intent, s0);
      if (!call) { out.results.push({ intent, sent: false, note }); continue; }
      const e = await ctx.send('hot', { address: d.usd, abi: ABI.token, ...call, scene: 'chat', label: `plain wallet, hijacked server: transfer (${doc.id})`, force: true });
      out.results.push({ intent, sent: true, call: 'transfer', tx: log({ kind: 'chat', ...strip(e) }) });
      continue;
    }
    if (agent === 'server') {
      // Model, code and key all in the attacker's hands: the call goes out as asked, and only the vault decides.
      const call = rawCall(intent, s0, d, `${week}:${doc.id}:${k}`);
      if (!call) { out.results.push({ intent, sent: false, note: 'nothing the contract could take (no valid address or amount)' }); continue; }
      const e = await ctx.send('agent', { address: d.vault, abi: ABI.vault, ...call, scene: 'chat', label: `hijacked server: ${call.functionName} (${doc.id})`, force: true });
      out.results.push({ intent, sent: true, call: call.functionName, tx: log({ kind: 'chat', ...strip(e) }) });
      continue;
    }
    const key = keyOf(week, intent);
    const s = await readState(ctx, d);
    const v = judgeChat(intent, s, doc, { used: await usedOpIds(ctx, d, [opId(key)]), week });
    const r = { intent, decision: v.decision, tier: v.tier, checks: v.checks };
    // The agent acts alone inside tier 1, as in the routine; above it, the owner is asked; the rest is refused.
    if (v.decision === 'execute') {
      const e = await execute(ctx, d, v, { scene: 'chat', label: `${intent.reason} (${doc.id})` });
      remember(e, v);
      r.tx = log({ kind: 'chat', ...strip(e) });
    } else if (v.decision === 'needs_owner') {
      r.ask = asks.push({ intent, key, doc, week }) - 1;
    }
    out.results.push(r);
  }
  return out;
}

function remember(entry, verdict) {
  if (entry.status === 'success' && verdict?.call?.functionName === 'pay') lastPaid = { to: verdict.call.args[0], amount: verdict.call.args[1], opId: verdict.call.args[2] };
}

const routes = {
  'GET /api/state': async () => snapshot(),
  'GET /api/inbox': async () => {
    const s = await readState(ctx, d);
    return loadInbox(WEEK).map((doc) => ({ ...doc, codeFlags: scanDocument(doc.text, s.payees) }));
  },
  'GET /api/ledger': async () => ledger,
  'GET /api/evidence': async () => {
    const dir = join(ROOT, 'evidence');
    const f = readdirSync(dir).filter((x) => x.startsWith(`${NET}-campaign-`) && x.endsWith('.json')).sort().at(-1);
    return f ? { file: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) } : null;
  },
  'GET /api/attacks': async () => campaign.attacks.map(({ id, title, expect }) => ({ id, title, expect })),
  'POST /api/plan': async ({ profile = 'guarded', mode = 'replay' }) => {
    if (!['guarded', 'naive'].includes(profile) || !['replay', 'live'].includes(mode)) throw new Error('bad profile or mode');
    if (mode === 'live' && !ALLOW_LIVE) throw new Error('live model calls are disabled; start the server with --allow-live');
    const s = await readState(ctx, d);
    const docs = loadInbox(WEEK);
    const p = propose({ scenario: WEEK, profile, prompt: buildPrompt(profile, s, docs, INSTRUCTION), mode });
    const keys = (p.response.intents ?? []).map((i) => opId(keyOf(WEEK, i)));
    const r = review(p.response, s, docs, { used: await usedOpIds(ctx, d, keys), week: WEEK, instruction: INSTRUCTION });
    plan = { profile, docs, ...r, meta: { mode: p.mode, model: p.model, seconds: p.seconds, recording: p.recording, at: p.at, promptMatches: p.promptMatches } };
    log({ kind: 'plan', label: `${p.mode} · ${profile} · ${r.verdicts.length} intents`, status: 'info' });
    return { ...plan.meta, profile, summary: p.response.summary, modelFlags: r.modelFlags, codeFlags: r.codeFlags, verdicts: r.verdicts.map(({ intent, decision, tier, checks }) => ({ intent, decision, tier, checks })) };
  },
  'POST /api/execute': async ({ i }) => {
    const { v } = await rejudge(i);
    if (v.decision !== 'execute') return log({ kind: 'agent', label: `${v.intent.reason}`, status: 'refused-before-signing', expectedError: { name: v.checks.filter((c) => !c.ok).map((c) => c.rule).join(' + ') } });
    const e = await execute(ctx, d, v, { scene: 'console', label: v.intent.reason });
    remember(e, v);
    return log({ kind: 'agent', ...strip(e) });
  },
  'POST /api/mandate/preview': async ({ i, from = 'plan' }) => {
    const { v, s } = await rejudge(i, from);
    if (v.decision !== 'needs_owner') throw new Error(`this proposal is "${v.decision}" now, not awaiting your signature`);
    const m = { to: v.to, amount: v.amount, opId: v.opId, deadline: s.now + 3600n, epoch: s.epoch };
    pending = { from, i, m };
    return { text: renderMandate(m, s.payees), typed: mandateTypedData(ctx, d, m), checks: v.checks };
  },
  'POST /api/mandate/sign': async ({ i, from = 'plan' }) => {
    const pend = pending;
    if (!pend || pend.i !== i || pend.from !== from) throw new Error('preview the mandate first');
    const s = await readState(ctx, d);
    if (pend.m.epoch !== s.epoch) throw new Error('the vault epoch changed; preview again');
    const sig = await ctx.wallets.owner.signTypedData(mandateTypedData(ctx, d, pend.m));
    const { to, amount, opId: id, deadline } = pend.m;
    const e = await ctx.send('agent', { address: d.vault, abi: ABI.vault, functionName: 'payWithMandate', args: [to, amount, id, deadline, sig], scene: 'console', label: renderMandate(pend.m, s.payees), force: true });
    pending = null;
    return log({ kind: 'mandate', ...strip(e) });
  },
  'GET /api/chat/samples': async () => chatSamples(ctx.addr.attacker).map((text) => ({ text, recorded: recordedProfiles(text) })),
  'POST /api/chat': talk,
  'GET /api/mandate/samples': async () => replayableSamples(),
  'POST /api/mandate/compile': async ({ text, mode = 'replay', answers = [] }) => {
    if (!['replay', 'live'].includes(mode)) throw new Error('bad mode');
    if (mode === 'live' && !ALLOW_LIVE) throw new Error('live model calls are disabled; start the server with --allow-live');
    const s = await readState(ctx, d);
    const r = compileMandate(text, s, ctx.addr, { mode, answers });
    draft = { struct: r.struct, now: s.now, shown: JSON.stringify([r.rows, r.calls], big), questions: r.questions };
    log({ kind: 'plan', label: `mandate compiled (${r.meta.mode}): ${r.rows.length} changes, ${r.looser} looser${r.questions.length ? `, ${r.questions.length} question${r.questions.length > 1 ? 's' : ''} to the owner` : ''}`, status: 'info' });
    const { next, ...rest } = r;
    return { ...rest, calls: r.calls.map((c) => c.label), worst: { now: worstCase(s), next: worstCase({ ...s, ...next }) } };
  },
  'POST /api/mandate/apply': async () => {
    if (!draft) throw new Error('compile a mandate first');
    // A setting the model asked about is still null in the struct: applying now would silently drop that rule.
    if (draft.questions.length) throw new Error('answer the questions first, or take that rule out of the text');
    // Re-diff against the chain as it is now; the clock stays at compile time so "valid for N days" keeps the expiry shown.
    const r = diffMandate({ ...(await readState(ctx, d)), now: draft.now }, draft.struct, ctx.addr);
    if (r.errors.length) throw new Error(`not applied: ${r.errors.join('; ')}`);
    if (!r.calls.length) throw new Error('nothing to change');
    // The owner approves the diff on screen, never one computed later against a different chain state:
    // the same call can turn from tighter to looser if the chain moved in between.
    if (JSON.stringify([r.rows, r.calls], big) !== draft.shown) { draft = null; throw new Error('the on-chain mandate changed since this diff was shown; compile again'); }
    const out = [];
    for (const c of r.calls) {
      const e = await ctx.send('owner', { address: d.vault, abi: ABI.vault, functionName: c.functionName, args: c.args, scene: 'console', label: `owner: ${c.label}` });
      out.push(log({ kind: 'owner', ...strip(e) }));
      if (e.status !== 'success') break;
    }
    draft = null;
    return out;
  },
  'POST /api/attack': async ({ id }) => {
    const a = campaign.attacks.find((x) => x.id === id);
    if (!a) throw new Error('unknown attack');
    const got = await a.run(id);
    const outcome = outcomeOf(got);
    return log({ kind: 'attack', id, title: a.title, expect: a.expect, outcome, pass: outcome === a.expect, ...strip(got) });
  },
  'POST /api/guardian/pause': async () => log({ kind: 'guardian', ...strip(await campaign.send('guardian', { functionName: 'pause' }, { scene: 'console', label: 'kill switch (guardian)' })) }),
  'POST /api/owner/unpause': async () => log({ kind: 'owner', ...strip(await campaign.send('owner', { functionName: 'unpause' }, { scene: 'console', label: 'owner restarts the agent' })) }),
  'POST /api/task': async ({ id }) => {
    const t = campaign.tasks.find((x) => x.id === id);
    if (!t) throw new Error('unknown task');
    const got = await t.run(id);
    return log({ kind: 'task', id, title: t.title, outcome: outcomeOf(got), ...strip(got) });
  },
};

// Actions that send transactions run one at a time, in click order. Two at once from the same key read the
// same pending nonce, and the node rejects the second (Sepolia, A2 and A7 clicked together: "invalid parameters").
const SENDS = new Set(['POST /api/execute', 'POST /api/mandate/sign', 'POST /api/mandate/apply', 'POST /api/attack', 'POST /api/guardian/pause', 'POST /api/owner/unpause', 'POST /api/task', 'POST /api/chat']);
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

function strip(e) {
  const { receipt, verdict, ...rest } = e ?? {};
  return rest;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const PUBLIC = join(ROOT, 'app', 'public');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const host = req.headers.host ?? '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return json(res, 403, { error: 'local only' }); // DNS-rebinding guard
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    // One line per state-changing call, and per slow read, so a stuck or failed action is visible in the terminal.
    const t0 = Date.now();
    const clock = () => new Date().toISOString().slice(11, 19);
    if (req.method === 'POST') console.log(`${clock()} → ${key}`);
    res.on('finish', () => { if (req.method === 'POST' || Date.now() - t0 > 2000) console.log(`${clock()} ← ${key} ${res.statusCode} ${Date.now() - t0} ms`); });
    res.on('close', () => { if (!res.writableFinished) console.log(`${clock()} ✕ ${key} closed by the client after ${Date.now() - t0} ms`); });
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (req.headers['x-leash-token'] !== TOKEN || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) return json(res, 403, { error: 'bad token or origin' });
    }
    try {
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return json(res, 413, { error: 'body too large' }); }
        body = raw ? JSON.parse(raw) : {};
      }
      return json(res, 200, await (SENDS.has(key) ? serial(() => routes[key](body)) : routes[key](body)));
    } catch (e) {
      return json(res, 400, { error: e.shortMessage ?? e.message });
    }
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const path = join(PUBLIC, file);
  if (!path.startsWith(PUBLIC) || !existsSync(path) || !TYPES[extname(path)]) { res.writeHead(404); return res.end('not found'); }
  let body = readFileSync(path);
  if (file === 'index.html') body = body.toString('utf8').replace('__LEASH_TOKEN__', TOKEN);
  res.writeHead(200, { 'content-type': TYPES[extname(path)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  res.end(body);
});
server.listen(PORT, '127.0.0.1', () => console.log(`LEASH console on http://127.0.0.1:${PORT} · network ${NET} · vault ${d.vault}${ALLOW_LIVE ? ' · LIVE model calls enabled' : ''}`));
