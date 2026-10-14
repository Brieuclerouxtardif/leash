// The LEASH campaign: real tasks, then attacks. Every attack that LEASH's software refuses is then
// replayed as if that software were compromised, so the vault's own refusal is mined on-chain.
// Usage: node app/src/scenes.js <local|sepolia> [--only=T1,A2]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, loadDeployment, ABI, ROOT } from './chain.js';
import { fmtUsd } from './core.js';
import { makeCampaign, outcomeOf } from './campaign.js';
import { repeg } from './repeg.js';

const net = process.argv[2] ?? 'local';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const runId = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const ctx = await connect(net, { journal: join(ROOT, 'evidence', `${net}-campaign-${runId}.jsonl`) });
const d = loadDeployment(net);
const c = makeCampaign(ctx, d, runId);
const results = [];

if (net === 'local') {
  const b = await ctx.pub.getBlock();
  await ctx.send('owner', { address: d.oracle, abi: ABI.feed, functionName: 'set', args: [2500n * 10n ** 8n, b.timestamp], scene: 'setup', label: 'refresh mock oracle' });
}
const peg = await repeg(ctx, d);
if (peg.txs.length) console.log(`setup: pool was ${peg.gapBps} bps off the oracle, re-pegged`);

for (const sc of [...c.tasks, ...c.attacks]) {
  if (only.length && !only.includes(sc.id)) continue;
  let got;
  try {
    got = await sc.run(sc.id);
  } catch (e) {
    got = { status: 'error', error: e.shortMessage ?? e.message };
  }
  const outcome = outcomeOf(got);
  const pass = outcome === sc.expect;
  results.push({ id: sc.id, title: sc.title, expect: sc.expect, outcome, pass, hash: got.hash, url: got.url, note: got.note, error: got.error });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${sc.id.padEnd(4)} ${outcome.padEnd(36)} ${got.hash ?? ''} ${got.error ?? ''}`);
}

const s = await c.state();
const summary = {
  network: net, runId, vault: d.vault, passed: results.filter((r) => r.pass).length, total: results.length,
  final: { usd: fmtUsd(s.usd), eth: Number(s.eth) / 1e18, riskBps: s.riskBps, paidToday: fmtUsd(s.paidToday) }, results,
};
writeFileSync(join(ROOT, 'evidence', `${net}-campaign-${runId}.json`), JSON.stringify(summary, null, 2));
console.log(`\n${summary.passed}/${summary.total} scenes as expected — vault now ${summary.final.usd} tUSD + ${summary.final.eth.toFixed(4)} tETH`);
process.exit(summary.passed === summary.total ? 0 : 1);
