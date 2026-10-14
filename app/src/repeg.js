// Keeps our testnet pool at the oracle price, the job arbitrageurs do on a real DEX.
// Without it, the pool stays at the deploy-day price: once ETH/USD drifts by more than the
// mandate's slippage, every DCA buy (or sell) is refused. The owner donates the missing side.
// Usage: node app/src/repeg.js <local|sepolia>
import { fileURLToPath } from 'node:url';
import { ABI } from './chain.js';

export async function repeg(ctx, d, { toleranceBps = 20n } = {}) {
  const read = (address, abi, functionName, args = []) => ctx.pub.readContract({ address, abi, functionName, args });
  const [usdR, ethR] = [await read(d.pool, ABI.pool, 'reserve0'), await read(d.pool, ABI.pool, 'reserve1')];
  const [, price] = await read(d.oracle, ABI.feed, 'latestRoundData');
  const fairUsd = (ethR * price) / 10n ** 20n; // tUSD (6 dp) worth ethR tETH (18 dp) at an 8-dp price
  const gapBps = ((fairUsd - usdR) * 10_000n) / fairUsd;
  if (gapBps <= toleranceBps && gapBps >= -toleranceBps) return { gapBps, txs: [] };

  const [token, amount, args] = usdR < fairUsd
    ? [d.usd, fairUsd - usdR, (a) => [a, 0n]]
    : [d.eth, (usdR * 10n ** 20n) / price - ethR, (a) => [0n, a]];
  const txs = [];
  for (const [address, abi, functionName, a] of [
    [token, ABI.token, 'mint', [ctx.addr.owner, amount]],
    [token, ABI.token, 'approve', [d.pool, amount]],
    [d.pool, ABI.pool, 'addLiquidity', args(amount)],
  ]) {
    const e = await ctx.send('owner', { address, abi, functionName, args: a, scene: 'repeg', label: `repeg ${functionName}` });
    if (e.status !== 'success') throw new Error(`repeg ${functionName} failed: ${e.hash ?? e.error}`);
    txs.push(e.hash);
  }
  return { gapBps, txs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { connect, loadDeployment } = await import('./chain.js');
  const net = process.argv[2] ?? 'local';
  const ctx = await connect(net);
  const r = await repeg(ctx, loadDeployment(net));
  console.log(r.txs.length ? `pool was ${r.gapBps} bps off the oracle; re-pegged in ${r.txs.length} txs` : `pool within ${r.gapBps} bps of the oracle; nothing to do`);
}
