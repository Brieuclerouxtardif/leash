// The most a fully hijacked agent can take from a LEASH vault, computed by anyone from public chain data alone:
// no key, no login, no LEASH server, nothing from us but the vault's address. The payee list is rebuilt from the
// vault's own PayeeSet events and each cap is read back. This is what a classic backend cannot offer: there, the
// limits live in the operator's database and you take their word for them.
// Usage: node scripts/worst-case.mjs [sepolia|local] [vault address]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, http, erc20Abi } from 'viem';
import { network } from '../app/src/config.js';
import { ABI, ROOT } from '../app/src/chain.js';
import { worstCase, fmtUsd } from '../app/src/core.js';

const net = process.argv[2] ?? 'sepolia';
const dir = join(ROOT, 'deployments');
const deployments = readdirSync(dir).filter((f) => f.startsWith(net) && f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const vault = process.argv[3] ?? JSON.parse(readFileSync(join(dir, `${net}.json`), 'utf8')).vault;
const { chain, rpc } = network(net);
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 6, retryDelay: 1500 }) });

// Logs from the vault's creation block: our deployment file names the creation tx, else the whole chain (local only).
const created = deployments.find((x) => x.vault?.toLowerCase() === vault.toLowerCase())?.txs?.['deploy:vault'];
const fromBlock = created ? (await pub.getTransactionReceipt({ hash: created })).blockNumber : net === 'local' ? 0n : null;
if (fromBlock === null) throw new Error('unknown vault: no deployment file names its creation transaction');
const latest = await pub.getBlockNumber();

const v = (functionName, args = []) => pub.readContract({ address: vault, abi: ABI.vault, functionName, args });
const seen = new Set();
const sealers = new Set();
for (let from = fromBlock; from <= latest; from += 9000n) {
  const to = from + 8999n < latest ? from + 8999n : latest; // public RPCs cap the block range of eth_getLogs
  for (const log of await pub.getContractEvents({ address: vault, abi: ABI.vault, eventName: 'PayeeSet', fromBlock: from, toBlock: to })) seen.add(log.args.payee);
  for (const log of await pub.getContractEvents({ address: vault, abi: ABI.vault, eventName: 'SealAllowanceSet', fromBlock: from, toBlock: to })) sealers.add(log.args.creditor);
}
const [block, agent, agentExpiry, paused, limits, risk, today, stable] = await Promise.all([
  pub.getBlock({ blockNumber: latest }), v('agent'), v('agentExpiry'), v('paused'), v('limits'), v('risk'), v('today'), v('stable'),
]);
// Vaults deployed before 2026-10-16 have no budget: only the daily limit and the key's expiry bound them.
const agentBudget = await v('agentBudget').catch(() => null);
const payees = {};
for (const a of seen) payees[a] = { address: a, cap: await v('payeeCap', [a]) }; // the current cap, not the event's
const usd = await pub.readContract({ address: stable, abi: erc20Abi, functionName: 'balanceOf', args: [vault] });
// Vaults deployed before sealed invoices (Sepolia run 6, 2026-10-16) have neither allowances nor holds.
const seals = {};
for (const a of sealers) seals[a] = { address: a, allowance: await v('sealAllowance', [a]) };
const [held, contestWindow] = await Promise.all([v('held').catch(() => 0n), v('contestWindow').catch(() => 0)]);

const s = {
  now: block.timestamp, agent, agentExpiry, agentBudget: agentBudget ?? usd, paused, payees, seals, contestWindow: Number(contestWindow), usd, paidToday: today[1],
  limits: { payPerTx: limits[0], payDaily: limits[1], swapPerTx: limits[2], swapDaily: limits[3] },
  risk: { maxSlippageBps: risk[0], maxRiskBps: risk[1], maxOracleAge: risk[2] },
};
const w = worstCase(s);
if (agentBudget === null && w.bound === 'budget') w.bound = 'balance'; // the stand-in budget was the balance itself
const until = new Date(Number(agentExpiry) * 1000).toISOString().slice(0, 16);

console.log(`${net} vault ${vault}, block ${latest}, read from ${rpc} with no key`);
console.log(`  tUSD in the vault: ${fmtUsd(usd).toLocaleString('en-US')}`);
console.log(`  agent ${agent}, key valid until ${until} UTC${paused ? ', vault PAUSED' : ''}`);
console.log(`  payees the agent may pay alone (from ${seen.size} PayeeSet address${seen.size === 1 ? '' : 'es'}, caps read back):`);
for (const p of Object.values(payees).filter((x) => x.cap > 0n)) console.log(`    ${p.address}  ≤ ${fmtUsd(p.cap).toLocaleString('en-US')} per payment`);
console.log(`  limits: ≤ ${fmtUsd(s.limits.payDaily).toLocaleString('en-US')} a day, paid today ${fmtUsd(s.paidToday).toLocaleString('en-US')}, ${agentBudget === null ? 'NO key budget (a vault from before 2026-10-16)' : `key budget left ${fmtUsd(agentBudget).toLocaleString('en-US')}`}`);
console.log('\nIf the model, LEASH\'s code, its server and the agent key were all in an attacker\'s hands now:');
console.log('  to an address the owner did not register:  0 tUSD');
console.log(`  more today, only to the payees above:       ≤ ${w.today.toLocaleString('en-US')} tUSD`);
console.log(`  in total, until the key expires:             ≤ ${w.untilExpiry.toLocaleString('en-US')} tUSD (bound: ${{ budget: 'the key\'s budget', balance: 'the vault\'s balance', days: `${w.days} paying days at the daily limit` }[w.bound]})`);
console.log(`  lost to swap prices, per day:                ≤ ${w.swapLossPerDay.toLocaleString('en-US')} tUSD against the oracle`);
console.log('  through sealed invoices:                     0 tUSD (the agent key cannot make a creditor\'s seal)');
if (sealers.size) {
  console.log(`\nSealed invoices (from ${sealers.size} SealAllowanceSet address${sealers.size === 1 ? '' : 'es'}, allowances read back), ${fmtUsd(held).toLocaleString('en-US')} tUSD held now:`);
  for (const c of Object.values(seals).filter((x) => x.allowance > 0n)) console.log(`    ${c.address}  ≤ ${fmtUsd(c.allowance).toLocaleString('en-US')} left`);
  console.log(`  if a creditor's own key were stolen too:     ≤ ${w.sealedIfCreditorStolen.toLocaleString('en-US')} tUSD, each payment held ${w.contestWindow} s for the owner or guardian to contest`);
}
console.log(`The same hijack on a plain wallet holding the same tUSD: ${fmtUsd(usd).toLocaleString('en-US')} tUSD, to any address.`);
console.log('Owner-signed (tier 2) payments are not in these numbers: they need the owner\'s key, which no agent component holds.');
