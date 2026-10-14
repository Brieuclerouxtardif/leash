// Waits until the owner is funded, then runs the whole Sepolia path: deploy, campaign, Sourcify, audit, evidence doc.
// Usage: node scripts/sepolia-run.mjs [--poll=60]   Safe to re-run: it never redeploys over an existing deployment.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createPublicClient, http, parseEther } from 'viem';
import { sepolia } from 'viem/chains';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const poll = Number((process.argv.find((a) => a.startsWith('--poll=')) ?? '--poll=60').slice(7)) * 1000;
const owner = JSON.parse(readFileSync(join(ROOT, 'secrets', 'testnet-keys.json'), 'utf8')).owner.address;
const pub = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const log = (m) => console.log(`${new Date().toISOString().slice(0, 19)}Z ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (args) => {
  log(`$ node ${args.join(' ')}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
};

// Same bound as deploy.js: deploy + owner share at twice today's gas price, plus three role keys.
async function need() {
  const gp = await pub.getGasPrice();
  const perRole = [parseEther('0.002'), gp * 2n * 2_000_000n].reduce((a, b) => (a > b ? a : b));
  return gp * 2n * 10_000_000n + perRole * 3n;
}

const deployed = existsSync(join(ROOT, 'deployments', 'sepolia.json'));
if (!deployed) {
  for (;;) {
    try {
      const [have, want] = [await pub.getBalance({ address: owner }), await need()];
      if (have >= want) { log(`owner funded: ${Number(have) / 1e18} ETH`); break; }
      log(`waiting for funds on ${owner}: ${Number(have) / 1e18} / ~${Number(want) / 1e18} ETH`);
    } catch (e) {
      log(`rpc error, retrying: ${e.shortMessage ?? e.message}`);
    }
    await sleep(poll);
  }
}

// One campaign = one UTC day: never start within 15 minutes of midnight UTC.
for (;;) {
  const now = new Date();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (mins >= 15 && mins <= 1425) break;
  log('too close to 00:00 UTC, waiting');
  await sleep(60_000);
}

if (!deployed && run(['app/src/deploy.js', 'sepolia'])) process.exit(1);
// A campaign needs a fresh vault, so it runs once per deployment. Whether it passed is the audit's call,
// not the campaign file's: run 2's file said 18/18 over an out-of-gas A9 (SECURITY.md, R15).
const vault = JSON.parse(readFileSync(join(ROOT, 'deployments', 'sepolia.json'), 'utf8')).vault.toLowerCase();
const ran = readdirSync(join(ROOT, 'evidence')).filter((f) => /^sepolia-campaign-.*\.json$/.test(f))
  .some((f) => JSON.parse(readFileSync(join(ROOT, 'evidence', f), 'utf8')).vault.toLowerCase() === vault);
if (ran) log(`a campaign already ran against vault ${vault}; not re-running it (redeploy with --fresh for a new run)`);
else run(['app/src/scenes.js', 'sepolia']);
run(['scripts/verify.mjs', 'sepolia']);
const audit = run(['scripts/audit-chain.mjs', 'sepolia', '--blockscout']);
run(['scripts/evidence-doc.mjs']);
process.exit(audit);
