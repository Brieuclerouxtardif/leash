// Records one live mandate compilation per owner text with the current prompt, so the console and the tests can
// replay them without a model login. The texts are the ones already recorded (any prompt version) plus BUDGET_TEXT.
// A text whose first turn asks questions gets a second turn with the answers recorded for it before, in order.
// Skips a text already recorded with the current prompt. Sends nothing on-chain.
// Usage: node scripts/record-mandate.mjs [--again]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../app/src/chain.js';
import { propose } from '../app/src/planner.js';
import { compilePrompt, replayableSamples, MANDATE_SCHEMA } from '../app/src/compiler.js';

const BUDGET_TEXT = 'Going away for two weeks. The agent can spend 1,000 tUSD in total on rent and electricity until I am back, no more, and keep its key valid for 14 days.';

const again = process.argv.includes('--again');
const dir = join(ROOT, 'evidence', 'model-runs');
const old = readdirSync(dir).filter((f) => f.startsWith('mandate-compile-')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).prompt);
const ownerText = (p) => /<<<OWNER\n([\s\S]*?)\nOWNER>>>/.exec(p)?.[1];
const oldAnswers = (text) => {
  const p = old.filter((x) => ownerText(x) === text && x.includes('<<<ANSWERS')).at(-1);
  return p ? [.../^Q: (.*)\nA: (.*)$/gm[Symbol.matchAll](/<<<ANSWERS\n([\s\S]*?)\nANSWERS>>>/.exec(p)[1])].map((m) => m[2]) : [];
};
const texts = [...new Set([...old.map(ownerText).filter(Boolean), BUDGET_TEXT])];
const done = replayableSamples();

const show = (p) => {
  const r = p.response;
  console.log(`  ${p.seconds.toFixed(1)} s, ${p.recording}`);
  console.log(`  payees ${JSON.stringify(r.payees)} limits ${JSON.stringify(r.limits)} risk ${JSON.stringify(r.risk)} days ${r.agentDays} budget ${r.agentBudget}`);
  for (const q of r.questions) console.log(`  question: ${q}`);
  for (const u of r.unmapped) console.log(`  unmapped: ${u}`);
};
for (const text of texts) {
  if (!again && done.includes(text)) continue;
  console.log(`\n${text.slice(0, 90)}…`);
  const p = propose({ scenario: 'mandate', profile: 'compile', prompt: compilePrompt(text), mode: 'live', schema: MANDATE_SCHEMA, exactPrompt: true });
  show(p);
  const qs = p.response.questions;
  const as = oldAnswers(text);
  if (!qs.length) continue;
  if (qs.length !== as.length) { console.log(`  ${qs.length} question(s), ${as.length} recorded answer(s): no second turn`); continue; }
  const answers = qs.map((q, n) => ({ q: q.replace(/\s+/g, ' ').trim().slice(0, 300), a: as[n] }));
  console.log(`  second turn with ${answers.map((x) => x.a).join(', ')}`);
  show(propose({ scenario: 'mandate', profile: 'compile', prompt: compilePrompt(text, answers), mode: 'live', schema: MANDATE_SCHEMA, exactPrompt: true }));
}
