// Checks a deployment before a video take, so that a take is not lost to a spent bill or a stale price.
// Usage: node scripts/preflight.mjs <local|sepolia>   Exit code 1 if any check fails. Sends nothing.
import { formatEther, parseEther } from 'viem';
import { connect, loadDeployment, ABI } from '../app/src/chain.js';
import { readState, opId, usedOpIds, fmtUsd } from '../app/src/core.js';
import { loadInbox, buildPrompt, propose } from '../app/src/planner.js';
import { INSTRUCTION, WEEK } from '../app/src/routine.js';

const net = process.argv[2] ?? 'local';
const ctx = await connect(net);
const d = loadDeployment(net);
const s = await readState(ctx, d);
const checks = [];
const check = (ok, what, detail) => checks.push({ ok, what, detail });

check(!s.paused, 'vault not paused', s.paused ? 'the owner must restart the agent first' : '');
const daysLeft = Number(s.agentExpiry - s.now) / 86400;
check(daysLeft > 1, 'agent key valid', `${daysLeft.toFixed(1)} days left`);

// The routine replays a recorded plan: its bills must not be paid yet on this vault (one opId per bill).
const p = propose({ scenario: WEEK, profile: 'guarded', prompt: buildPrompt('guarded', s, loadInbox(WEEK), INSTRUCTION), mode: 'replay' });
const pays = (p.response.intents ?? []).filter((i) => i.type === 'pay');
const keys = pays.map((i) => opId(`${WEEK}:${i.source}:${i.payee || i.to}:${i.amount}`));
const used = await usedOpIds(ctx, d, keys);
check(used.size === 0, "this week's bills unpaid", used.size ? `${used.size} of ${keys.length} already paid on this vault: deploy a fresh one (deploy.js ${net} --fresh)` : `${keys.length} bills`);

// Rent and electricity (tier 1) must fit in what is left of today's limit.
const tier1 = pays.filter((i) => i.payee && Number(i.amount) <= fmtUsd(s.limits.payPerTx)).reduce((a, i) => a + Number(i.amount), 0);
const room = fmtUsd(s.limits.payDaily) - fmtUsd(s.paidToday);
check(tier1 <= room, "today's payment limit has room", `${tier1} tUSD of tier-1 bills, ${room} left today`);
// ...and in what is left of the agent key's whole-life budget.
check(tier1 <= fmtUsd(s.agentBudget), "agent budget has room", `${tier1} tUSD of tier-1 bills, ${fmtUsd(s.agentBudget)} left`);

// A9 and the DCA assume the pool sits at the oracle price; the oracle must stay fresh through the take.
const gapBps = Math.round(((Number(s.pool.price) - Number(s.price)) / Number(s.price)) * 10000);
check(Math.abs(gapBps) <= 50, 'pool at the oracle price', `${gapBps} bps off${Math.abs(gapBps) > 50 ? `: run node app/src/repeg.js ${net}` : ''}`);
const age = Number(s.now - s.priceUpdatedAt);
const maxAge = Number(s.risk.maxOracleAge);
check(age + 1800 < maxAge, 'oracle fresh for the next 30 min', `${Math.round(age / 60)} min old, limit ${maxAge / 60} min`);

const roles = ['owner', 'agent', 'guardian', 'attacker', ...(ctx.addr.hot ? ['hot'] : [])];
for (const role of roles) {
  const bal = await ctx.pub.getBalance({ address: ctx.addr[role] });
  check(bal >= parseEther('0.001'), `${role} has gas`, `${Number(formatEther(bal)).toFixed(4)} ETH`);
}
// The chat scene's "no LEASH" agent pays the fake owner's 9,000 tUSD from the plain wallet.
if (ctx.addr.hot) {
  const hot = fmtUsd(await ctx.pub.readContract({ address: d.usd, abi: ABI.token, functionName: 'balanceOf', args: [ctx.addr.hot] }));
  check(hot >= 9000, 'plain wallet funded', `${hot} tUSD${hot >= 9000 ? '' : `: deploy a fresh one (deploy.js ${net} --fresh)`}`);
}

if (ctx.net.decoder) {
  let ok = false;
  try { ok = (await fetch(`${ctx.net.decoder}/api/v2/stats`)).ok; } catch {}
  check(ok, 'Blockscout reachable', ctx.net.decoder);
}

console.log(`Preflight on ${net}, vault ${d.vault}\n`);
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.what}${c.detail ? ` — ${c.detail}` : ''}`);
const bad = checks.filter((c) => !c.ok).length;
console.log(bad ? `\n${bad} check(s) failed: fix them before recording.` : '\nReady to record.');
process.exit(bad ? 1 : 0);
