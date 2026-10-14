// Verifies the Sepolia deployment on Sourcify (no API key needed). Run after app/src/deploy.js sepolia.
// Usage: node scripts/verify.mjs [--dry-run]   (FOUNDRY= path to the folder holding forge)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { encodeAbiParameters } from 'viem';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const net = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]) ?? 'sepolia';
const dry = process.argv.includes('--dry-run');
const d = JSON.parse(readFileSync(join(ROOT, 'deployments', `${net}.json`), 'utf8'));
const forge = join(process.env.FOUNDRY ?? join(process.env.USERPROFILE ?? process.env.HOME, 'tools', 'foundry-v1.8.5'), process.platform === 'win32' ? 'forge.exe' : 'forge');
// Older deployment files lack the owner: fall back to the keys file's public address (never the key).
const ownerAddr = d.owner ?? JSON.parse(readFileSync(join(ROOT, 'secrets', 'testnet-keys.json'), 'utf8')).owner.address;

const enc = (types, values) => encodeAbiParameters(types.map((type) => ({ type })), values).slice(2);
const targets = [
  ['usd', 'src/Mocks.sol:TestToken', enc(['string', 'string', 'uint8'], ['Test Dollar', 'tUSD', 6])],
  ['eth', 'src/Mocks.sol:TestToken', enc(['string', 'string', 'uint8'], ['Test Ether', 'tETH', 18])],
  ['pool', 'src/LeashPool.sol:LeashPool', enc(['address', 'address'], [d.usd, d.eth])],
  ['vault', 'src/LeashVault.sol:LeashVault', enc(['address', 'address', 'address', 'address'], [ownerAddr, d.usd, d.eth, d.oracle])],
];

for (const [key, contract, args] of targets) {
  const argv = ['verify-contract', d[key], contract, '--chain', String(d.chainId), '--verifier', 'sourcify', '--constructor-args', `0x${args}`, '--root', join(ROOT, 'contracts'), '--watch'];
  console.log(`${key.padEnd(6)} ${d[key]}`);
  if (dry) { console.log(`  forge ${argv.slice(0, 7).join(' ')} --constructor-args 0x${args.slice(0, 16)}… --watch`); continue; }
  try {
    console.log(execFileSync(forge, argv, { encoding: 'utf8' }).trim().split('\n').slice(-2).join('\n'));
  } catch (e) {
    console.log(`  failed: ${(e.stdout || e.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}
console.log(`\nCheck: https://repo.sourcify.dev/${d.chainId}/${d.vault}`);
