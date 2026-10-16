// Checks the vault as deployed, not as written. Reads its runtime code from the chain and:
// 1. lists the selectors its dispatcher compares calldata with, and checks they are exactly the ABI's;
// 2. checks every ABI function that can change state is one of the reviewed lists below, by role;
// 3. checks it has no CALLCODE, DELEGATECALL or SELFDESTRUCT;
// 4. checks the code is our build's (`forge build`), immutables masked. Sourcify proves this too; this is a second way.
// Needs no keys. Usage: node scripts/bytecode-check.mjs [sepolia|local] [vault address]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, toFunctionSelector } from 'viem';
import { network } from '../app/src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const net = process.argv[2] ?? 'sepolia';
const address = process.argv[3] ?? JSON.parse(readFileSync(join(ROOT, 'deployments', `${net}.json`), 'utf8')).vault;
const art = JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'LeashVault.sol', 'LeashVault.json'), 'utf8'));

// Reviewed by hand against contracts/src/LeashVault.sol and SECURITY.md §1. A new state-changing function fails here.
const ROLES = {
  agent: ['pay', 'swap', 'payWithMandate', 'settleInvoice'],
  'owner or guardian': ['pause', 'contest'],
  // Pays a held invoice to its sealed creditor once the contest window is over, and to nobody else.
  'anyone, to the creditor only': ['release'],
  owner: ['setPayee', 'setLimits', 'setRisk', 'setPool', 'setAgent', 'setAgentBudget', 'setSealAllowance', 'setContestWindow', 'revokeAgent', 'bumpEpoch', 'setGuardian', 'unpause', 'withdraw'],
};

const { chain, rpc } = network(net);
const pub = createPublicClient({ chain, transport: http(rpc, { retryCount: 6, retryDelay: 1500 }) });
const code = Buffer.from((await pub.getCode({ address })).slice(2), 'hex');
if (!code.length) throw new Error(`no code at ${address} on ${net}`);

// The CBOR metadata at the end is data, not code; its length is in the last two bytes.
const codeEnd = (b) => b.length - (b.readUInt16BE(b.length - 2) + 2);
const ops = [];
for (let pc = 0; pc < codeEnd(code); ) {
  const op = code[pc], n = op >= 0x60 && op <= 0x7f ? op - 0x5f : 0;
  ops.push({ op, arg: code.subarray(pc + 1, pc + 1 + n).toString('hex') });
  pc += 1 + n;
}
// Dispatch is PUSHn selector, EQ, PUSH target, JUMPI. solc drops leading zero bytes: riskBps() = 0x00991335 is a PUSH3.
const isPush = (op) => op >= 0x60 && op <= 0x7f;
const dispatched = new Set();
for (let i = 0; i + 3 < ops.length; i++)
  if (ops[i].op >= 0x60 && ops[i].op <= 0x63 && ops[i + 1].op === 0x14 && isPush(ops[i + 2].op) && ops[i + 3].op === 0x57)
    dispatched.add(`0x${ops[i].arg.padStart(8, '0')}`);

const fns = art.abi.filter((x) => x.type === 'function').map((f) => ({ ...f, sel: toFunctionSelector(f) }));
const bad = [];
const notInAbi = [...dispatched].filter((s) => !fns.some((f) => f.sel === s));
const notDispatched = fns.filter((f) => !dispatched.has(f.sel)).map((f) => f.name);
if (notInAbi.length) bad.push(`dispatched but not in the ABI: ${notInAbi.join(', ')}`);
if (notDispatched.length) bad.push(`in the ABI but not dispatched: ${notDispatched.join(', ')}`);

const writes = fns.filter((f) => !['view', 'pure'].includes(f.stateMutability));
const role = (name) => Object.keys(ROLES).find((r) => ROLES[r].includes(name));
for (const f of writes) if (!role(f.name)) bad.push(`${f.name} changes state and is in no reviewed role`);
for (const name of Object.values(ROLES).flat()) if (!writes.some((f) => f.name === name)) bad.push(`${name} is listed but is not a state-changing function`);

// Code that could run someone else's code in the vault's name, or destroy it, would bypass every role above.
const DANGEROUS = { 0xf2: 'CALLCODE', 0xf4: 'DELEGATECALL', 0xff: 'SELFDESTRUCT' };
const found = [...new Set(ops.filter((o) => DANGEROUS[o.op]).map((o) => DANGEROUS[o.op]))];
if (found.length) bad.push(`the code contains ${found.join(', ')}`);

const mask = (buf) => {
  const b = Buffer.from(buf);
  for (const refs of Object.values(art.deployedBytecode.immutableReferences ?? {})) for (const { start, length } of refs) b.fill(0, start, start + length);
  return b;
};
const built = Buffer.from(art.deployedBytecode.object.slice(2), 'hex');
const same = code.length === built.length && mask(code).equals(mask(built));
if (!same) bad.push('the deployed code is not our build (run `forge build` on this commit?)');

console.log(`${net} vault ${address}: ${code.length} bytes`);
console.log(`dispatcher: ${dispatched.size} selectors; ABI: ${fns.length} functions, ${fns.length - writes.length} read-only`);
for (const r of Object.keys(ROLES)) console.log(`  ${r}: ${ROLES[r].join(', ')}`);
console.log(found.length ? `contains ${found.join(', ')}` : 'no CALLCODE, DELEGATECALL or SELFDESTRUCT opcode');
console.log(`code ${same ? 'identical to our build, immutables masked, metadata hash included' : 'DIFFERENT from our build'}`);
for (const b of bad) console.log(`✗ ${b}`);
// This proves the inventory, not the checks: that the owner functions refuse other callers is test_admin_is_owner_only.
console.log(bad.length ? `${bad.length} problem(s)` : 'OK: no entry point outside the ABI, and every state-changing one is in a reviewed role');
process.exit(bad.length ? 1 : 0);
