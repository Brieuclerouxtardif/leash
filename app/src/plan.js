// Weekly routine: the model reads the inbox and proposes; code re-judges against the live vault.
// Usage: node app/src/plan.js <local|sepolia> <guarded|naive> <live|replay> [week42]
import { connect, loadDeployment } from './chain.js';
import { readState, usedOpIds, opId } from './core.js';
import { loadInbox, buildPrompt, propose, review } from './planner.js';

import { INSTRUCTION, WEEK } from './routine.js';

const [net = 'local', profile = 'guarded', mode = 'replay', week = WEEK] = process.argv.slice(2);

const ctx = await connect(net);
const d = loadDeployment(net);
const s = await readState(ctx, d);
const docs = loadInbox(week);
const prompt = buildPrompt(profile, s, docs, INSTRUCTION);
const p = propose({ scenario: week, profile, prompt, mode });
const used = await usedOpIds(ctx, d, (p.response.intents ?? []).map((i) => opId(`${week}:${i.source}:${i.payee || i.to}:${i.amount}`)));
const r = review(p.response, s, docs, { used, week, instruction: INSTRUCTION });

console.log(`[${p.mode}] model=${p.model} ${p.seconds ? `${p.seconds}s` : ''} recording=${p.recording} promptMatches=${p.promptMatches}`);
console.log(`summary: ${p.response.summary}`);
for (const f of p.response.flags ?? []) console.log(`model flag  ${f.doc}: ${f.kind} — ${f.detail}`);
for (const [doc, fl] of Object.entries(r.codeFlags)) for (const f of fl) console.log(`code flag   ${doc}: ${f.kind} — ${f.detail}`);
for (const v of r.verdicts) {
  const i = v.intent;
  const failed = v.checks.filter((c) => !c.ok).map((c) => `${c.rule} (${c.detail})`).join('; ');
  console.log(`${v.decision.padEnd(12)} ${i.type} ${i.side || ''} ${i.amount} ${i.payee || i.to} <- ${i.source}${failed ? ` | ${failed}` : ''}`);
}
