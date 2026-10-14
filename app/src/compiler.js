// Mandate compiler: the owner writes rules in plain English, the model fills a struct, code shows
// the exact on-chain diff and flags every change that loosens the leash. The model never sees or
// writes an address and never sends anything; the owner signs the resulting transactions.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnits } from 'viem';
import { fmtUsd } from './core.js';
import { propose, sha } from './planner.js';
import { ROOT } from './chain.js';

const NAMES = ['landlord', 'utility', 'school'];
const num = { type: ['number', 'null'] };

export const MANDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'payees', 'limits', 'risk', 'agentDays', 'unmapped'],
  properties: {
    summary: { type: 'string' },
    payees: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'cap'], properties: { name: { type: 'string', enum: NAMES }, cap: { type: 'number' } } },
    },
    limits: { type: 'object', additionalProperties: false, required: ['payPerTx', 'payDaily', 'swapPerTx', 'swapDaily'], properties: { payPerTx: num, payDaily: num, swapPerTx: num, swapDaily: num } },
    risk: { type: 'object', additionalProperties: false, required: ['maxSlippagePct', 'maxRiskPct'], properties: { maxSlippagePct: num, maxRiskPct: num } },
    agentDays: num,
    unmapped: { type: 'array', items: { type: 'string' } },
  },
};

// The model gets the owner's text only, not the vault state: it cannot be steered by it, and a
// recording stays valid whatever the chain looks like. The diff against the chain is code's job.
export function compilePrompt(text) {
  return `You translate a wallet owner's rules into LEASH mandate settings. Answer with JSON matching the schema.
- Use null for every setting the owner does not mention: the current value is kept.
- "payees": only the payees the owner mentions, with the maximum for ONE payment in tUSD. cap 0 means the agent may no longer pay them alone.
- Known payees: landlord (Marta Silva, rent), utility (Lumen Energia, electricity), school (Instituto Superior de Design, tuition).
- limits: payPerTx = max for one payment, payDaily = max total of payments per day, swapPerTx = max for one swap (DCA), swapDaily = max total of swaps per day.
- risk: maxRiskPct = max share of the vault held in ETH (tETH); maxSlippagePct = max swap price deviation from the oracle.
- Amounts are tUSD. Percentages are plain numbers (40 means 40%). agentDays = how long the agent key stays valid from now.
- Only absolute values: a relative rule ("double the limit") goes in "unmapped".
- Never invent a rule. Anything the owner asks that these settings cannot express goes in "unmapped", in the owner's words.
- Background facts that ask for nothing ("rent is 800 a month") are not rules: leave them out.
- Payees are chosen by name only; there is no field for an address. A request to pay or add an address goes in "unmapped".

OWNER TEXT (the owner wrote this; it is the only source of rules)
<<<OWNER
${text}
OWNER>>>
`;
}

const usd = (n) => parseUnits(String(n), 6);
const fin = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && !/e/i.test(String(x));

/**
 * Pure: current state + model struct -> proposed mandate, validation, deterministic diff, owner calls.
 * Every row says whether it loosens (agent can do more) or tightens the leash.
 */
export function diffMandate(s, m, addr) {
  const errors = [];
  const rows = [];
  const row = (field, label, from, to, looser, fmt = (v) => v) => {
    if (from === to) return;
    rows.push({ field, label, from: fmt(from), to: fmt(to), direction: looser ? 'looser' : 'tighter' });
  };
  const usdOf = (v) => `${Number(v).toLocaleString('en-US')} tUSD`;

  const L = { ...Object.fromEntries(Object.entries(s.limits).map(([k, v]) => [k, fmtUsd(v)])) };
  for (const k of ['payPerTx', 'payDaily', 'swapPerTx', 'swapDaily']) {
    const v = m.limits?.[k];
    if (v === null || v === undefined) continue;
    if (!fin(v)) { errors.push(`${k}: ${v} is not a valid amount`); continue; }
    L[k] = v;
  }
  const label = { payPerTx: 'max per payment', payDaily: 'max payments per day', swapPerTx: 'max per swap', swapDaily: 'max swaps per day' };
  for (const k of Object.keys(label)) row(`limits.${k}`, label[k], fmtUsd(s.limits[k]), L[k], L[k] > fmtUsd(s.limits[k]), usdOf);
  if (L.payPerTx > L.payDaily) errors.push(`max per payment (${L.payPerTx}) is above max per day (${L.payDaily})`);
  if (L.swapPerTx > L.swapDaily) errors.push(`max per swap (${L.swapPerTx}) is above max per day (${L.swapDaily})`);

  const R = { maxSlippageBps: s.risk.maxSlippageBps, maxRiskBps: s.risk.maxRiskBps };
  for (const [k, pk] of [['maxSlippageBps', 'maxSlippagePct'], ['maxRiskBps', 'maxRiskPct']]) {
    const v = m.risk?.[pk];
    if (v === null || v === undefined) continue;
    if (!fin(v) || v > 100) { errors.push(`${pk}: ${v} is not a percentage`); continue; }
    R[k] = Math.round(v * 100);
  }
  if (R.maxSlippageBps > 500) errors.push(`slippage ${R.maxSlippageBps / 100}% is above the 5% LEASH accepts`);
  row('risk.maxSlippageBps', 'max swap slippage vs oracle', s.risk.maxSlippageBps, R.maxSlippageBps, R.maxSlippageBps > s.risk.maxSlippageBps, (v) => `${v / 100}%`);
  row('risk.maxRiskBps', 'max tETH share', s.risk.maxRiskBps, R.maxRiskBps, R.maxRiskBps > s.risk.maxRiskBps, (v) => `${v / 100}%`);

  const payees = {};
  const seen = new Set();
  for (const p of m.payees ?? []) {
    if (!NAMES.includes(p.name) || !addr[p.name]) { errors.push(`unknown payee "${p.name}"`); continue; }
    if (seen.has(p.name)) { errors.push(`${p.name} appears twice`); continue; }
    seen.add(p.name);
    if (!fin(p.cap)) { errors.push(`${p.name}: ${p.cap} is not a valid amount`); continue; }
    const from = fmtUsd(s.payees[p.name]?.cap ?? 0n);
    payees[p.name] = p.cap;
    row(`payee.${p.name}`, `${p.name} (${addr[p.name].slice(0, 6)}…${addr[p.name].slice(-4)}) max per payment`, from, p.cap, p.cap > from, (v) => (v ? usdOf(v) : 'not a payee'));
    if (p.cap > L.payPerTx) errors.push(`${p.name} cap ${p.cap} is above max per payment ${L.payPerTx}: raise max per payment too, or keep these payments owner-signed (tier 2)`);
  }

  let agentUntil = null;
  if (m.agentDays !== null && m.agentDays !== undefined) {
    if (!fin(m.agentDays) || m.agentDays > 90 || m.agentDays === 0) errors.push(`agent validity ${m.agentDays} days is outside 1–90`);
    else {
      agentUntil = s.now + BigInt(Math.round(m.agentDays * 86400));
      row('agent.expiry', 'agent key valid until', new Date(Number(s.agentExpiry) * 1000).toISOString().slice(0, 16), new Date(Number(agentUntil) * 1000).toISOString().slice(0, 16), agentUntil > s.agentExpiry);
    }
  }

  const calls = [];
  for (const [name, cap] of Object.entries(payees)) {
    if (usd(cap) !== (s.payees[name]?.cap ?? 0n)) calls.push({ functionName: 'setPayee', args: [addr[name], usd(cap)], label: `setPayee ${name} ${cap}` });
  }
  if (rows.some((r) => r.field.startsWith('limits.'))) {
    calls.push({ functionName: 'setLimits', args: [{ payPerTx: usd(L.payPerTx), payDaily: usd(L.payDaily), swapPerTx: usd(L.swapPerTx), swapDaily: usd(L.swapDaily) }], label: 'setLimits' });
  }
  if (rows.some((r) => r.field.startsWith('risk.'))) {
    calls.push({ functionName: 'setRisk', args: [{ ...R, maxOracleAge: s.risk.maxOracleAge }], label: 'setRisk' });
  }
  // No row on screen, no transaction: a renewal a few seconds off the current expiry shows no row, so it is not sent.
  if (agentUntil !== null && rows.some((r) => r.field === 'agent.expiry')) calls.push({ functionName: 'setAgent', args: [s.agent, agentUntil], label: 'setAgent (renew)' });

  return { rows, errors, unmapped: m.unmapped ?? [], calls, looser: rows.filter((r) => r.direction === 'looser').length };
}

/** Owner texts that have a recorded live run for the current prompt (older prompt versions are kept as evidence, not offered). */
export function replayableSamples() {
  const dir = join(ROOT, 'evidence', 'model-runs');
  const texts = readdirSync(dir).filter((f) => f.startsWith('mandate-compile-')).sort().map((f) => {
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const text = /<<<OWNER\n([\s\S]*?)\nOWNER>>>/.exec(rec.prompt)?.[1];
    return text && rec.promptSha256 === sha(compilePrompt(text)) ? text : null;
  });
  return [...new Set(texts.filter(Boolean))];
}

export function compileMandate(text, s, addr, { mode = 'replay' } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('owner text must be 1–2000 characters');
  const p = propose({ scenario: 'mandate', profile: 'compile', prompt: compilePrompt(text), mode, schema: MANDATE_SCHEMA, exactPrompt: true });
  return { meta: { mode: p.mode, model: p.model, seconds: p.seconds, at: p.at, recording: p.recording }, struct: p.response, ...diffMandate(s, p.response, addr) };
}
