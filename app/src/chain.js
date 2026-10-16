// Clients, keys, contract handles and the evidence journal. Every transaction LEASH sends goes
// through `send`, which records hash, status and decoded revert reason, success or not.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, http, decodeErrorResult, encodeFunctionData, BaseError,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ALLOWED_CHAIN_IDS, REAL_FUNDS_CHAIN_IDS, network } from './config.js';

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

function keys(name = 'testnet-keys.json') {
  const file = join(ROOT, 'secrets', name);
  if (!existsSync(file)) throw new Error(`secrets/${name} is missing.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function addresses(keyFile) {
  const k = keys(keyFile);
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
  const pub = createPublicClient({ chain: net.chain, transport: http(net.rpc), pollingInterval: net.pollMs });
  const live = await pub.getChainId();
  // network() has already refused a real-funds chain without LEASH_REAL_FUNDS; here the RPC must agree.
  if (live !== net.chain.id || !(ALLOWED_CHAIN_IDS.has(live) || (net.realFunds && REAL_FUNDS_CHAIN_IDS.has(live)))) {
    throw new Error(`RPC answered chain ${live}, expected ${net.realFunds ? '' : 'test '}chain ${net.chain.id}. Refusing to sign anything.`);
  }
  const k = keys(net.keyFile);
  const wallets = {};
  // school only seals invoices (an off-chain signature); it never sends a transaction.
  for (const role of ['owner', 'agent', 'guardian', 'attacker', 'hot', 'school']) {
    if (!k[role]) continue; // hot came later: `node app/src/keys.js` adds it
    wallets[role] = createWalletClient({ account: privateKeyToAccount(k[role].privateKey), chain: net.chain, transport: http(net.rpc) });
  }
  const journalFile = journal ?? join(ROOT, 'evidence', `${netName}-journal.jsonl`);
  mkdirSync(dirname(journalFile), { recursive: true });
  const ctx = { net, pub, wallets, journalFile, addr: addresses(net.keyFile) };

  /** Send a contract call as `role`. With force=true the gas is fixed so a doomed call is still
   *  mined: the reverted transaction becomes public proof that the vault refused it. */
  /** A forced call is sent with every field filled. Otherwise viem asks the node to fill the transaction
   *  (`eth_fillTransaction`); behind a load balancer some nodes simulate it there and viem throws on the
   *  very revert we want mined (Sepolia run 3, A9). A stale nonce from a lagging node is retried. */
  async function sendFilled(wallet, tx) {
    for (let i = 0; ; i++) {
      try {
        const [nonce, fees] = await Promise.all([
          pub.getTransactionCount({ address: wallet.account.address, blockTag: 'pending' }), pub.estimateFeesPerGas(),
        ]);
        return await wallet.sendTransaction({ ...tx, nonce, ...fees, chainId: net.chain.id, type: 'eip1559' });
      } catch (e) {
        if (i >= 3 || !/nonce/i.test(e.shortMessage ?? e.message ?? '')) throw e;
        await sleep(3000);
      }
    }
  }

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
    const hash = force || gas ? await sendFilled(wallet, { to: address, data, gas: gas ?? FORCED_GAS }) : await wallet.sendTransaction({ to: address, data });
    const r = await pub.waitForTransactionReceipt({ hash });
    Object.assign(entry, { hash, status: r.status, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed) });
    // The reason that counts is the mined one. On a load-balanced RPC the pre-send simulation can hit a
    // node one block behind (Sepolia run 1, A8) and say "ok".
    if (r.status === 'reverted') entry.minedError = await minedRevert(pub, hash, abi);
    if (net.explorer) entry.url = `${net.explorer}/tx/${hash}`;
    record(ctx, entry);
    return { ...entry, receipt: r };
  };
  return ctx;
}

function record(ctx, entry) {
  appendFileSync(ctx.journalFile, JSON.stringify(entry, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
}

/** Gas for a forced call. It must leave room to reach the vault's own check: a call that dies out of gas
 *  proves nothing. The same swap uses 2.4x the gas on Sepolia (T3: 384k vs 160k), mostly from creating
 *  storage, and the 300k we had tuned locally made Sepolia's A9 run out of gas in runs 1 and 2. Only the gas used is paid. */
export const FORCED_GAS = 1_500_000n;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Why a mined transaction reverted, from the chain alone: out of gas if it burnt its whole limit,
 *  otherwise the reason of the same call (sender, data and gas limit) replayed at its block. */
export async function minedRevert(pub, hash, abi) {
  let tx, r;
  for (let i = 0; !tx; i++) {
    try {
      [tx, r] = await Promise.all([pub.getTransaction({ hash }), pub.getTransactionReceipt({ hash })]);
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(2000);
    }
  }
  if (r.gasUsed >= tx.gas) return { name: 'OutOfGas', args: [String(tx.gas)] };
  return replayRevert(pub, { account: tx.from, to: tx.to, data: tx.input, gas: tx.gas }, r.blockNumber, abi);
}

/** Decoded reason of a call that reverted in `blockNumber`, or null after a few tries. Only a revert is an
 *  answer: a lagging node can lack the block or answer from an older state and not revert at all, and a public
 *  RPC can fail the call itself (Sepolia, 2026-10-15: A2 came back once as "Missing or invalid parameters."). */
export async function replayRevert(pub, call, blockNumber, abi, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      await pub.call({ ...call, blockNumber });
    } catch (e) {
      if (revertData(e) || /revert/i.test(e?.shortMessage ?? e?.message ?? '')) return decodeRevert(e, abi);
    }
    await sleep(2000);
  }
  return null;
}

function revertData(err) {
  const raw = err instanceof BaseError ? err.walk((e) => e?.data !== undefined)?.data : undefined;
  const data = typeof raw === 'string' ? raw : raw?.data;
  return typeof data === 'string' && data.startsWith('0x') && data.length >= 10 ? data : null;
}

export function decodeRevert(err, abi) {
  const data = revertData(err);
  if (data) {
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
