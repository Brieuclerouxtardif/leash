// Verifies the Sepolia deployment on Sourcify (no API key needed). Run after app/src/deploy.js sepolia.
// Sends each contract's build metadata and source files (contracts/out/, from `forge build`) to Sourcify's API,
// with its creation transaction; Sourcify recompiles and compares. Needs no forge at this point: on 2026-10-16
// Windows application control blocked forge.exe, and `forge verify-contract` with it.
// Usage: node scripts/verify.mjs [sepolia] [--dry-run]
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = join(ROOT, 'contracts');
const API = 'https://sourcify.dev/server';
const net = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'sepolia';
const dry = process.argv.includes('--dry-run');
const d = JSON.parse(readFileSync(join(ROOT, 'deployments', `${net}.json`), 'utf8'));

const targets = [['usd', 'Mocks.sol/TestToken.json'], ['eth', 'Mocks.sol/TestToken.json'], ['pool', 'LeashPool.sol/LeashPool.json'], ['vault', 'LeashVault.sol/LeashVault.json']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, body) {
  const res = await fetch(`${API}${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

for (const [key, artifact] of targets) {
  const address = d[key];
  const metadata = JSON.parse(JSON.parse(readFileSync(join(CONTRACTS, 'out', artifact), 'utf8')).rawMetadata);
  // Source paths are as the compiler saw them, relative to contracts/ (OpenZeppelin is ../node_modules/...).
  const sources = Object.fromEntries(Object.keys(metadata.sources).map((p) => [p, readFileSync(resolve(CONTRACTS, p), 'utf8')]));
  console.log(`${key.padEnd(6)} ${address}  ${Object.keys(metadata.settings.compilationTarget)[0]}, ${Object.keys(sources).length} sources`);
  if (dry) continue;
  const known = await api(`/v2/contract/${d.chainId}/${address}`);
  if (known.status === 200 && known.json.match) { console.log(`  already verified: ${known.json.match}`); continue; }
  const sent = await api(`/v2/verify/metadata/${d.chainId}/${address}`, { sources, metadata, creationTransactionHash: d.txs?.[`deploy:${key}`] });
  if (sent.status !== 202) { console.log(`  refused (${sent.status}): ${sent.json.message ?? JSON.stringify(sent.json)}`); continue; }
  let job;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    job = (await api(`/v2/verify/${sent.json.verificationId}`)).json;
    if (job.isJobCompleted) break;
  }
  if (job?.error) console.log(`  failed: ${job.error.message ?? job.error.customCode}`);
  else if (job?.contract?.match) console.log(`  ${job.contract.match} (creation ${job.contract.creationMatch}, runtime ${job.contract.runtimeMatch})`);
  else console.log(`  no answer after 2 min: verification ${sent.json.verificationId}`);
}
console.log(`\nCheck: https://repo.sourcify.dev/${d.chainId}/${d.vault}`);
