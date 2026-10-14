// Re-derives every scene outcome of a campaign from the chain alone: receipt status, target address and,
// for a refusal, the revert reason replayed at its block. Needs no keys, only `forge build` for the ABI.
// Usage: node scripts/audit-chain.mjs [sepolia|local] [evidence/<net>-campaign-<run>.json]
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { ABI, replayRevert } from '../app/src/chain.js';
import { network } from '../app/src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const net = process.argv[2] ?? 'sepolia';
const file = process.argv[3] ?? join(ROOT, 'evidence', readdirSync(join(ROOT, 'evidence'))
  .filter((f) => f.startsWith(`${net}-campaign-`) && f.endsWith('.json')).sort().at(-1));
const c = JSON.parse(readFileSync(file, 'utf8'));
const { chain, rpc } = network(net);
const pub = createPublicClient({ chain, transport: http(rpc) });

let confirmed = 0, offChain = 0;
const bad = [];
console.log(`Audit of ${basename(file)} against ${net} (vault ${c.vault}); the campaign file said ${c.passed}/${c.total}.\n`);
for (const r of c.results) {
  if (!r.hash) {
    offChain++;
    console.log(`${r.id.padEnd(4)} off-chain   refused before signing (${r.outcome}); nothing was sent, nothing to audit`);
    continue;
  }
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash: r.hash }), pub.getTransactionReceipt({ hash: r.hash })]);
  let chainOutcome = rc.status;
  if (rc.status === 'reverted') {
    const why = await replayRevert(pub, { account: tx.from, to: tx.to, data: tx.input }, rc.blockNumber, ABI.vault);
    chainOutcome = `reverted:${why?.name ?? 'unknown'}`;
  }
  const toVault = tx.to?.toLowerCase() === c.vault.toLowerCase();
  const ok = chainOutcome === r.expect && toVault;
  if (ok) confirmed++; else bad.push(r.id);
  const diff = chainOutcome !== r.outcome ? ` (campaign file said ${r.outcome})` : '';
  console.log(`${r.id.padEnd(4)} ${ok ? 'confirmed ' : 'MISMATCH  '}  block ${rc.blockNumber}  ${chainOutcome}${toVault ? '' : ' NOT SENT TO THE VAULT'}${diff}`);
}
console.log(`\n${confirmed} confirmed on-chain + ${offChain} refused before signing = ${confirmed + offChain}/${c.results.length} as expected${bad.length ? `; mismatches: ${bad.join(', ')}` : ''}.`);
process.exit(bad.length ? 1 : 0);
