// Clients, keys, contract handles and the evidence journal. Every transaction LEASH sends goes
// through `send`, which records hash, status and decoded revert reason, success or not.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, decodeErrorResult, encodeFunctionData, BaseError,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ALLOWED_CHAIN_IDS, network } from './config.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'contracts', 'out');

export function artifact(file, name = file.replace('.sol', '')) {
  const a = JSON.parse(readFileSync(join(OUT, file, `${name}.json`), 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

export const ABI = {
  vault: artifact('LeashVault.sol').abi,
  pool: artifact('LeashPool.sol').abi,
  token: artifact('Mocks.sol', 'TestToken').abi,
  feed: artifact('Mocks.sol', 'MockAggregator').abi,
};

function keys() {
  const file = join(ROOT, 'secrets', 'testnet-keys.json');
  if (!existsSync(file)) throw new Error('secrets/testnet-keys.json is missing.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function addresses() {
  const k = keys();
  return Object.fromEntries(Object.entries(k).filter(([, v]) => v?.address).map(([r, v]) => [r, v.address]));
}

export function deploymentFile(net) {
  return join(ROOT, 'deployments', `${net}.json`);
}

export function loadDeployment(net) {
  const f = deploymentFile(net);
  if (!existsSync(f)) throw new Error(`No deployment for ${net}. Run: node app/src/deploy.js ${net}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

export async function connect(netName, { journal } = {}) {
  const net = network(netName);
  const pub = createPublicClient({ chain: net.chain, transport: http(net.rpc) });
  const live = await pub.getChainId();
  if (live !== net.chain.id || !ALLOWED_CHAIN_IDS.has(live)) {
    throw new Error(`RPC answered chain ${live}, expected test chain ${net.chain.id}. Refusing to sign anything.`);
  }
  const k = keys();
  const wallets = {};
  for (const role of ['owner', 'agent', 'guardian', 'attacker']) {
    wallets[role] = createWalletClient({ account: privateKeyToAccount(k[role].privateKey), chain: net.chain, transport: http(net.rpc) });
  }
  const journalFile = journal ?? join(ROOT, 'evidence', `${netName}-journal.jsonl`);
  mkdirSync(dirname(journalFile), { recursive: true });
  const ctx = { net, pub, wallets, journalFile, addr: addresses() };

  /** Send a contract call as `role`. With force=true the gas is fixed so a doomed call is still
   *  mined: the reverted transaction becomes public proof that the vault refused it. */
  ctx.send = async (role, { address, abi, functionName, args = [], label, scene, force = false, gas }) => {
    const wallet = wallets[role];
    const entry = { at: new Date().toISOString(), network: netName, scene, label, role, from: wallet.account.address, to: address, fn: functionName };
    const data = encodeFunctionData({ abi, functionName, args });
    try {
      await pub.call({ account: wallet.account, to: address, data });
      entry.simulated = 'ok';
    } catch (e) {
      entry.simulated = 'revert';
      entry.expectedError = decodeRevert(e, abi);
      if (!force) {
        entry.status = 'refused-before-signing';
        record(ctx, entry);
        return entry;
      }
    }
    const hash = await wallet.sendTransaction({ to: address, data, gas: force || gas ? (gas ?? 300000n) : undefined });
    const r = await pub.waitForTransactionReceipt({ hash });
    Object.assign(entry, { hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed) });
    // The reason that counts is the mined one: replay the call at its block. On a load-balanced RPC the
    // pre-send simulation can hit a node one block behind (Sepolia run of 2026-10-14, A8) and say "ok".
    if (r.status === 'reverted') entry.minedError = await replayRevert(pub, { account: wallet.account, to: address, data }, r.blockNumber, abi);
    if (net.explorer) entry.url = `${net.explorer}/tx/${hash}`;
    record(ctx, entry);
    return { ...entry, receipt: r };
  };
  return ctx;
}

function record(ctx, entry) {
  appendFileSync(ctx.journalFile, JSON.stringify(entry, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
}

/** Decoded reason of a call that reverted in `blockNumber`, or null after a few tries (a lagging node can
 *  lack the block, or answer from an older state and not revert at all). */
export async function replayRevert(pub, call, blockNumber, abi, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      await pub.call({ ...call, blockNumber });
    } catch (e) {
      const d = decodeRevert(e, abi);
      if (!/block|header/i.test(d.name)) return d;
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return null;
}

export function decodeRevert(err, abi) {
  const raw = err instanceof BaseError ? err.walk((e) => e?.data !== undefined)?.data : undefined;
  const data = typeof raw === 'string' ? raw : raw?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const d = decodeErrorResult({ abi, data });
      const args = (d.args ?? []).map(String);
      return d.errorName === 'Error' ? { name: args[0], args: [] } : { name: d.errorName, args };
    } catch { /* not one of our errors */ }
  }
  const msg = err?.shortMessage ?? err?.message ?? String(err);
  const m = /reverted with reason string '([^']+)'|reverted: (.+)$/m.exec(msg);
  return { name: m ? (m[1] ?? m[2]) : msg.split('\n')[0] };
}
