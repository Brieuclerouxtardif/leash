// Deploys and configures a LEASH vault. Usage: node app/src/deploy.js <local|sepolia|basefork|base> [--fresh]
import { writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseUnits, parseEther, toHex } from 'viem';
import { connect, artifact, ABI, deploymentFile } from './chain.js';
import { MANDATE } from './config.js';

const net = process.argv[2] ?? 'local';
const fresh = process.argv.includes('--fresh');
const file = deploymentFile(net);
if (existsSync(file) && !fresh) {
  console.error(`${file} exists. Pass --fresh to deploy a new set of contracts.`);
  process.exit(1);
}

const ctx = await connect(net);
const { pub, wallets, addr } = ctx;
const owner = wallets.owner;
const usd6 = (n) => parseUnits(String(n), 6);
const out = { network: net, chainId: ctx.net.chain.id, deployedAt: new Date().toISOString(), owner: addr.owner, txs: {} };

if (net === 'local' || ctx.net.fork) {
  for (const a of Object.values(addr)) await pub.request({ method: 'anvil_setBalance', params: [a, toHex(parseEther('100'))] });
}

// Each forwarded key must afford ~2 M gas of campaign at twice today's gas price (the local campaign
// used 1.2 M for the agent). Deploy (~6 M gas) plus the owner's share fit in 10 M.
const gasPrice = await pub.getGasPrice();
const perRole = [parseEther(ctx.net.minRoleEth ?? '0.002'), gasPrice * 2n * 2_000_000n].reduce((a, b) => (a > b ? a : b));
if (net !== 'local' && !ctx.net.fork) {
  const need = gasPrice * 2n * 10_000_000n + perRole * 3n;
  const have = await pub.getBalance({ address: addr.owner });
  if (have < need) {
    console.error(`owner ${addr.owner} has ${Number(have) / 1e18} ETH; at ${Number(gasPrice) / 1e9} gwei this deploy needs ~${Number(need) / 1e18} ETH. Fund it, or wait for cheaper gas.`);
    process.exit(1);
  }
}

async function deploy(key, file_, name, args) {
  const { abi, bytecode } = artifact(file_, name);
  const hash = await owner.deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`deploy ${key} failed: ${hash}`);
  out[key] = r.contractAddress;
  out.txs[`deploy:${key}`] = hash;
  console.log(`${key.padEnd(8)} ${r.contractAddress}`);
  return r.contractAddress;
}

async function call(key, address, abi, functionName, args) {
  const e = await ctx.send('owner', { address, abi, functionName, args, scene: 'deploy', label: key });
  if (e.status !== 'success') throw new Error(`${key} failed: ${JSON.stringify(e.expectedError ?? e.hash)}`);
  out.txs[key] = e.hash;
}

const usd = await deploy('usd', 'Mocks.sol', 'TestToken', ['Test Dollar', 'tUSD', 6]);
const eth = await deploy('eth', 'Mocks.sol', 'TestToken', ['Test Ether', 'tETH', 18]);

let oracle = ctx.net.oracle;
if (!oracle) {
  oracle = await deploy('oracle', 'Mocks.sol', 'MockAggregator', []);
  const block = await pub.getBlock();
  await call('oracle:set', oracle, ABI.feed, 'set', [2500n * 10n ** 8n, block.timestamp]);
} else {
  out.oracle = oracle;
}
const [, price] = await pub.readContract({ address: oracle, abi: ABI.feed, functionName: 'latestRoundData' });
out.priceAtDeploy = Number(price) / 1e8;
console.log(`oracle   ${oracle} ETH/USD = ${out.priceAtDeploy}`);

const pool = await deploy('pool', 'LeashPool.sol', 'LeashPool', [usd, eth]);
const poolUsd = usd6(MANDATE.poolUsd);
const poolEth = (poolUsd * 10n ** 20n) / price; // same value at the oracle price
await call('mint:pool-usd', usd, ABI.token, 'mint', [addr.owner, poolUsd]);
await call('mint:pool-eth', eth, ABI.token, 'mint', [addr.owner, poolEth]);
await call('approve:usd', usd, ABI.token, 'approve', [pool, poolUsd]);
await call('approve:eth', eth, ABI.token, 'approve', [pool, poolEth]);
await call('pool:liquidity', pool, ABI.pool, 'addLiquidity', [poolUsd, poolEth]);

const vault = await deploy('vault', 'LeashVault.sol', 'LeashVault', [addr.owner, usd, eth, oracle]);
const now = (await pub.getBlock()).timestamp;
const L = MANDATE.limits;
await call('setAgent', vault, ABI.vault, 'setAgent', [addr.agent, now + BigInt(MANDATE.agentDays * 86400)]);
await call('setGuardian', vault, ABI.vault, 'setGuardian', [addr.guardian]);
await call('setPool', vault, ABI.vault, 'setPool', [pool]);
await call('setLimits', vault, ABI.vault, 'setLimits', [{ payPerTx: usd6(L.payPerTx), payDaily: usd6(L.payDaily), swapPerTx: usd6(L.swapPerTx), swapDaily: usd6(L.swapDaily) }]);
await call('setRisk', vault, ABI.vault, 'setRisk', [MANDATE.risk]);
for (const [who, cap] of Object.entries(MANDATE.payees)) await call(`setPayee:${who}`, vault, ABI.vault, 'setPayee', [addr[who], usd6(cap)]);
await call('fund:usd', usd, ABI.token, 'mint', [vault, usd6(MANDATE.funding.usd)]);
await call('fund:eth', eth, ABI.token, 'mint', [vault, parseEther(String(MANDATE.funding.eth))]);
await call('mint:attacker', usd, ABI.token, 'mint', [addr.attacker, usd6(200000)]); // the pool manipulator's war chest

if (net !== 'local') {
  // The role keys are the same on every deploy: top them up rather than pay them again.
  for (const role of ['agent', 'guardian', 'attacker']) {
    const has = await pub.getBalance({ address: addr[role] });
    if (has >= perRole) { console.log(`gas:${role} already has ${Number(has) / 1e18} ETH`); continue; }
    const hash = await owner.sendTransaction({ to: addr[role], value: perRole - has });
    await pub.waitForTransactionReceipt({ hash });
    out.txs[`gas:${role}`] = hash;
  }
}

mkdirSync(dirname(file), { recursive: true });
// A testnet deployment may be the one evidence points to: keep it under its own date before replacing it.
if (net !== 'local' && existsSync(file)) {
  const old = JSON.parse(readFileSync(file, 'utf8'));
  const dir = dirname(file);
  const kept = readdirSync(dir).find((f) => f.startsWith(`${net}-`) && JSON.parse(readFileSync(join(dir, f), 'utf8')).vault === old.vault);
  const keep = kept ?? `${net}-${old.deployedAt.replace(/[-:]/g, '').slice(0, 15)}.json`;
  if (!kept) copyFileSync(file, join(dir, keep));
  console.log(`previous deployment (vault ${old.vault}) kept in deployments/${keep}`);
}
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`saved ${file}`);
