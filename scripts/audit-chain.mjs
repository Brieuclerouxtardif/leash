// Re-derives every scene outcome of a campaign from the chain alone: receipt status, target address and,
// for a refusal, out-of-gas or the revert reason of the same call replayed at its block with its own gas
// limit. With --blockscout (Sepolia), each refusal is also checked against Blockscout's independent decoding.
// Needs no keys, only `forge build` for the ABI.
// Usage: node scripts/audit-chain.mjs [sepolia|local] [evidence/<net>-campaign-<run>.json] [--blockscout]
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, decodeErrorResult } from 'viem';
import { ABI, minedRevert } from '../app/src/chain.js';
import { network } from '../app/src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const net = args[0] ?? 'sepolia';
const file = args[1] ?? join(ROOT, 'evidence', readdirSync(join(ROOT, 'evidence'))
  .filter((f) => f.startsWith(`${net}-campaign-`) && f.endsWith('.json')).sort().at(-1));
const blockscout = process.argv.includes('--blockscout') && net === 'sepolia' ? 'https://eth-sepolia.blockscout.com' : null;
const c = JSON.parse(readFileSync(file, 'utf8'));
const { chain, rpc } = network(net);
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 6, retryDelay: 1500 }) }); // public RPCs drop requests

// Blockscout's own reading of a failed transaction: "Out of gas", or the error it decoded. A string
// revert ("slippage") may come back as Error(string) or as raw bytes; both are reduced to the string.
// While Blockscout is still indexing a transaction it answers "pending" or "awaiting_internal_transactions":
// that is no opinion, so it is retried and, failing that, reported as null rather than as a disagreement.
const INDEXING = new Set(['pending', 'awaiting_internal_transactions']);
async function blockscoutSays(hash) {
  let t;
  // Its backends disagree: the same hash can come back decoded, then "awaiting_internal_transactions".
  for (let i = 0; i < 12; i++) {
    t = await (await fetch(`${blockscout}/api/v2/transactions/${hash}`)).json();
    if (!INDEXING.has(t.result)) break;
    await new Promise((res) => setTimeout(res, 2500));
  }
  if (INDEXING.has(t.result)) return null;
  if (t.result !== 'Reverted') return t.result;
  const rr = t.revert_reason ?? {};
  if (rr.method_call) return rr.method_call.startsWith('Error(') ? rr.parameters?.[0]?.value : rr.method_call.split('(')[0];
  if (rr.raw) {
    try {
      const d = decodeErrorResult({ abi: ABI.vault, data: rr.raw });
      return d.errorName === 'Error' ? d.args[0] : d.errorName;
    } catch { return `raw ${rr.raw.slice(0, 10)}`; }
  }
  return 'no reason';
}

let confirmed = 0, offChain = 0, undecoded = 0;
const bad = [];
console.log(`Audit of ${basename(file)} against ${net} (vault ${c.vault}); the campaign file said ${c.passed}/${c.total}.\n`);
for (const r of c.results) {
  if (!r.hash) {
    // Only an expected refusal-before-signing may lack a hash; an error or a skipped send is a failure.
    if (r.expect.startsWith('refused') && r.outcome === r.expect) {
      offChain++;
      console.log(`${r.id.padEnd(4)} off-chain   refused before signing (${r.outcome}); nothing was sent, nothing to audit`);
    } else {
      bad.push(r.id);
      console.log(`${r.id.padEnd(4)} MISMATCH    no transaction: ${r.outcome}${r.error ? ` (${r.error})` : ''}, expected ${r.expect}`);
    }
    continue;
  }
  const [tx, rc] = await Promise.all([pub.getTransaction({ hash: r.hash }), pub.getTransactionReceipt({ hash: r.hash })]);
  let chainOutcome = rc.status;
  if (rc.status === 'reverted') chainOutcome = `reverted:${(await minedRevert(pub, r.hash, ABI.vault))?.name ?? 'unknown'}`;
  const toVault = tx.to?.toLowerCase() === c.vault.toLowerCase();
  let third = '';
  let thirdOk = true;
  if (blockscout && rc.status === 'reverted') {
    const says = await blockscoutSays(r.hash);
    if (says === null) undecoded++;
    else thirdOk = says === chainOutcome.split(':')[1];
    third = `  blockscout: ${says ?? 'still indexing, no opinion yet'}`;
  }
  const ok = chainOutcome === r.expect && toVault && thirdOk;
  if (ok) confirmed++; else bad.push(r.id);
  const diff = chainOutcome !== r.outcome ? ` (campaign file said ${r.outcome})` : '';
  console.log(`${r.id.padEnd(4)} ${ok ? 'confirmed ' : 'MISMATCH  '}  block ${rc.blockNumber}  gas ${rc.gasUsed}/${tx.gas}  ${chainOutcome}${toVault ? '' : ' NOT SENT TO THE VAULT'}${diff}${third}`);
}
console.log(`\n${confirmed} confirmed on-chain + ${offChain} refused before signing = ${confirmed + offChain}/${c.results.length} as expected${bad.length ? `; mismatches: ${bad.join(', ')}` : ''}.`);
if (undecoded) console.log(`Blockscout had not decoded ${undecoded} refusal(s) yet; those rest on the chain replay alone.`);
process.exit(bad.length ? 1 : 0);
