// LEASH agent core: read the vault, judge an intent, execute it. The model only ever proposes
// intents; addresses come from the registry, numbers are re-checked here and again on-chain.
import { keccak256, toHex, formatUnits, parseUnits, parseEther, isAddress, encodeAbiParameters, recoverTypedDataAddress } from 'viem';
import { ABI } from './chain.js';

const USD = 6;
const ETH = 18;
export const fmtUsd = (u) => Number(formatUnits(u, USD));
export const fmtEth = (w) => Number(formatUnits(w, ETH));

export async function readState(ctx, d) {
  const { pub, addr } = ctx;
  const v = (functionName, args = []) => pub.readContract({ address: d.vault, abi: ABI.vault, functionName, args });
  const bal = (token, who) => pub.readContract({ address: token, abi: ABI.token, functionName: 'balanceOf', args: [who] });
  const oracle = d.oracle;
  const [block, agent, agentExpiry, agentBudget, guardian, paused, epoch, limits, risk, today, usdBal, ethBal, round, r0, r1] = await Promise.all([
    pub.getBlock(), v('agent'), v('agentExpiry'), v('agentBudget'), v('guardian'), v('paused'), v('epoch'), v('limits'), v('risk'), v('today'),
    bal(d.usd, d.vault), bal(d.eth, d.vault),
    pub.readContract({ address: oracle, abi: ABI.feed, functionName: 'latestRoundData' }),
    pub.readContract({ address: d.pool, abi: ABI.pool, functionName: 'reserve0' }),
    pub.readContract({ address: d.pool, abi: ABI.pool, functionName: 'reserve1' }),
  ]);
  const payees = {};
  for (const name of ['landlord', 'utility', 'school']) {
    payees[name] = { address: addr[name], cap: await v('payeeCap', [addr[name]]) };
  }
  // Creditors whose sealed invoices the owner accepts, and what their seals may still take.
  const seals = {};
  for (const name of ['school']) seals[name] = { address: addr[name], allowance: await v('sealAllowance', [addr[name]]) };
  const [held, contestWindow] = await Promise.all([v('held'), v('contestWindow')]);
  const price = round[1];
  const ethValue = (ethBal * price) / 10n ** 20n;
  return {
    now: block.timestamp, agent, agentExpiry, agentBudget, guardian, paused, epoch: Number(epoch),
    limits: { payPerTx: limits[0], payDaily: limits[1], swapPerTx: limits[2], swapDaily: limits[3] },
    risk: { maxSlippageBps: risk[0], maxRiskBps: risk[1], maxOracleAge: risk[2] },
    day: today[0], paidToday: today[1], swappedToday: today[2],
    usd: usdBal, eth: ethBal, ethValue, price, priceUpdatedAt: round[3],
    riskBps: usdBal + ethValue === 0n ? 0 : Number((ethValue * 10000n) / (usdBal + ethValue)),
    pool: { usd: r0, eth: r1, price: r1 === 0n ? 0n : (r0 * 10n ** 20n) / r1 }, // pool ETH price, 8 decimals
    payees, seals, held, contestWindow: Number(contestWindow),
  };
}

const DAY = 86400n;
const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * The most the agent key can move if everything off-chain is hijacked: the model, LEASH's code and the key
 * itself. It is read from the vault's own limits, so it is also the most any message, from anyone, can make
 * the agent do. Owner-signed payments are not in it: they need the owner's key, which the agent never holds.
 */
export function worstCase(s) {
  const min = (...x) => x.reduce((a, b) => (b < a ? b : a));
  const to = Object.entries(s.payees).filter(([, p]) => p.cap > 0n).map(([n]) => n);
  const live = !s.paused && s.agent !== ZERO && s.agentExpiry >= s.now;
  const perDay = to.length ? s.limits.payDaily : 0n;
  const budget = live && to.length ? s.agentBudget : 0n;
  // The vault counts payments per UTC day (block.timestamp / 1 days); a new day starts at each midnight before expiry.
  const leftToday = live && perDay > s.paidToday ? perDay - s.paidToday : 0n;
  const newDays = live ? s.agentExpiry / DAY - s.now / DAY : 0n;
  const byDays = leftToday + newDays * perDay;
  // Three bounds: the daily limit over the key's remaining days, the key's budget, the vault's balance.
  const total = min(byDays, budget, s.usd);
  return {
    live, to, perDay: fmtUsd(perDay), today: fmtUsd(min(leftToday, budget, s.usd)), expiry: Number(s.agentExpiry),
    // When the budget or the balance is the bound, a shorter key no longer shows in untilExpiry: days still does.
    days: live ? Number(newDays) + 1 : 0, budget: fmtUsd(budget),
    bound: total === budget && budget < byDays ? 'budget' : total === s.usd && s.usd < byDays ? 'balance' : 'days',
    untilExpiry: fmtUsd(total),
    // A swap can only fail to get the oracle price by the slippage bound, on at most swapDaily a day.
    swapLossPerDay: fmtUsd((s.limits.swapDaily * BigInt(s.risk.maxSlippageBps)) / 10000n),
    // Sealed invoices add nothing to a stolen agent key: it cannot make a creditor's seal. If a creditor's own key
    // is stolen too, its seals can take at most its allowance, held for the contest window first.
    sealedIfCreditorStolen: fmtUsd(Object.values(s.seals ?? {}).reduce((a, c) => a + c.allowance, 0n)),
    contestWindow: s.contestWindow ?? 0,
  };
}

/** Canonical op id: the same obligation always maps to the same id, so it can never run twice. */
export const opId = (key) => keccak256(toHex(`leash:${key}`));

function check(list, rule, ok, detail) {
  list.push({ rule, ok, detail });
  return ok;
}

/**
 * Judge an intent against the live mandate. Returns
 *  { decision: 'execute' | 'needs_owner' | 'refuse', tier, checks, call? }.
 * Tier-1 failures that only an owner signature can lift become 'needs_owner'; everything else is 'refuse'.
 */
export function judge(intent, s, { registry, denylist = new Set(), used = new Set() } = {}) {
  const checks = [];
  const gate = check(checks, 'agent active', s.agentExpiry >= s.now && s.agent !== '0x0000000000000000000000000000000000000000', `expires ${new Date(Number(s.agentExpiry) * 1000).toISOString()}`)
    & check(checks, 'vault not paused', !s.paused, s.paused ? 'guardian or owner paused the vault' : 'running');
  const id = opId(intent.key);
  const fresh = check(checks, 'operation not already executed', !used.has(id), intent.key);
  if (!gate || !fresh) return { decision: 'refuse', tier: 3, checks, opId: id };
  // Model numbers are untrusted too: NaN, negatives and 1e+21 never reach parseUnits.
  const n = Number(intent.amount);
  if (!check(checks, 'positive amount', Number.isFinite(n) && n > 0 && !/e/i.test(String(intent.amount)), String(intent.amount))) return { decision: 'refuse', tier: 3, checks, opId: id };

  if (intent.type === 'pay') {
    const amount = parseUnits(String(intent.amount), USD);
    const known = registry[intent.payee];
    // Addresses never come from the model or from a document: only from the registry.
    if (intent.to && known && intent.to.toLowerCase() !== known.address.toLowerCase()) {
      check(checks, 'address matches registry', false, `document says ${intent.to}, registry says ${known.address} — classic invoice-redirection fraud`);
      return { decision: 'refuse', tier: 3, checks, opId: id };
    }
    const to = known?.address ?? intent.to;
    if (!check(checks, 'recipient resolved to a valid address', isAddress(to ?? '', { strict: false }), known ? to : `"${intent.payee || intent.to || ''}" is neither a registry name nor an address`)) return { decision: 'refuse', tier: 3, checks, opId: id };
    if (!check(checks, 'recipient not on denylist', !denylist.has(to?.toLowerCase()), to)) return { decision: 'refuse', tier: 3, checks, opId: id };
    const cap = known?.cap ?? 0n;
    const t1 = check(checks, 'recipient is a payee', cap > 0n, known ? `${intent.payee} cap ${fmtUsd(cap)}` : `${to} is not in the payee list`)
      & check(checks, 'within payee cap', amount <= cap, `${intent.amount} ≤ ${fmtUsd(cap)}`)
      & check(checks, 'within per-payment limit', amount <= s.limits.payPerTx, `${intent.amount} ≤ ${fmtUsd(s.limits.payPerTx)}`)
      & check(checks, 'within daily limit', s.paidToday + amount <= s.limits.payDaily, `${fmtUsd(s.paidToday)} + ${intent.amount} ≤ ${fmtUsd(s.limits.payDaily)}`)
      & check(checks, 'within the agent key\'s budget', amount <= s.agentBudget, `${intent.amount} ≤ ${fmtUsd(s.agentBudget)} left, for the key's whole life`);
    const call = { functionName: 'pay', args: [to, amount, id] };
    if (t1) return { decision: 'execute', tier: 1, checks, opId: id, call, to, amount };
    if (!check(checks, 'vault can cover it', amount <= s.usd, `${intent.amount} ≤ ${fmtUsd(s.usd)}`)) return { decision: 'refuse', tier: 3, checks, opId: id };
    return { decision: 'needs_owner', tier: 2, checks, opId: id, to, amount };
  }

  if (intent.type === 'swap') {
    const buy = intent.side === 'buy';
    const amountIn = buy ? parseUnits(String(intent.amount), USD) : parseEther(String(intent.amount));
    const age = s.now - s.priceUpdatedAt;
    if (!check(checks, 'oracle fresh', age <= BigInt(s.risk.maxOracleAge), `${age}s old, max ${s.risk.maxOracleAge}s`)) return { decision: 'refuse', tier: 3, checks, opId: id };
    const notional = buy ? amountIn : (amountIn * s.price) / 10n ** 20n;
    const fair = buy ? (amountIn * 10n ** 20n) / s.price : notional;
    const quote = poolQuote(s.pool, buy, amountIn);
    const floor = (fair * BigInt(10000 - s.risk.maxSlippageBps)) / 10000n;
    const deviationBps = Number(((s.pool.price - s.price) * 10000n) / s.price);
    const ok = check(checks, 'within per-swap limit', notional <= s.limits.swapPerTx, `${fmtUsd(notional)} ≤ ${fmtUsd(s.limits.swapPerTx)}`)
      & check(checks, 'within daily swap limit', s.swappedToday + notional <= s.limits.swapDaily, `${fmtUsd(s.swappedToday)} + ${fmtUsd(notional)} ≤ ${fmtUsd(s.limits.swapDaily)}`)
      & check(checks, 'pool price close to oracle', quote >= floor, `pool ${(Number(s.pool.price) / 1e8).toFixed(2)} vs oracle ${(Number(s.price) / 1e8).toFixed(2)} (${deviationBps} bps)`);
    let after = s.riskBps;
    if (buy) {
      const ethValue = s.ethValue + (quote * s.price) / 10n ** 20n;
      const total = s.usd - amountIn + ethValue;
      after = Number((ethValue * 10000n) / total);
      check(checks, 'exposure stays within mandate', after <= s.risk.maxRiskBps, `${(after / 100).toFixed(1)}% ≤ ${s.risk.maxRiskBps / 100}%`);
    }
    if (checks.some((c) => !c.ok)) return { decision: 'refuse', tier: 3, checks, opId: id };
    // Ask for a little better than the mandate floor so a sandwich between simulation and inclusion fails.
    const minOut = [floor, (quote * 9980n) / 10000n].reduce((a, b) => (a > b ? a : b));
    return { decision: 'execute', tier: 1, checks, opId: id, call: { functionName: 'swap', args: [buy, amountIn, minOut, id] }, amountIn, minOut, after };
  }

  check(checks, 'known intent type', false, intent.type);
  return { decision: 'refuse', tier: 3, checks, opId: id };
}

export function poolQuote(pool, buy, amountIn) {
  const [rIn, rOut] = buy ? [pool.usd, pool.eth] : [pool.eth, pool.usd];
  const inFee = amountIn * 9970n;
  return (inFee * rOut) / (rIn * 10000n + inFee);
}

export async function usedOpIds(ctx, d, ids) {
  const used = new Set();
  for (const id of ids) {
    if (await ctx.pub.readContract({ address: d.vault, abi: ABI.vault, functionName: 'used', args: [id] })) used.add(id);
  }
  return used;
}

export const MANDATE_TYPES = {
  Mandate: [
    { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'opId', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' }, { name: 'epoch', type: 'uint32' },
  ],
};

export function mandateTypedData(ctx, d, m) {
  return {
    domain: { name: 'LeashVault', version: '1', chainId: ctx.net.chain.id, verifyingContract: d.vault },
    types: MANDATE_TYPES, primaryType: 'Mandate', message: m,
  };
}

export const INVOICE_TYPES = {
  Invoice: [{ name: 'creditor', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'invoiceId', type: 'bytes32' }],
};

/** A creditor seals its invoice for one vault: the domain names the vault and the chain. */
export function invoiceTypedData(ctx, d, inv) {
  return {
    domain: { name: 'LeashVault', version: '1', chainId: ctx.net.chain.id, verifyingContract: d.vault },
    types: INVOICE_TYPES, primaryType: 'Invoice', message: inv,
  };
}

export const invoiceKey = (creditor, invoiceId) => keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [creditor, invoiceId]));
export const invoiceId = (text) => keccak256(toHex(`invoice:${text}`));

/**
 * Judge a sealed invoice before the agent signs anything. The seal decides who and how much; this only checks
 * that the seal is the creditor's own and that the vault would take it. The vault checks it all again.
 */
export async function judgeInvoice(ctx, d, inv, seal, s, { used = new Set() } = {}) {
  const checks = [];
  const key = invoiceKey(inv.creditor, inv.invoiceId);
  const signer = await recoverTypedDataAddress({ ...invoiceTypedData(ctx, d, inv), signature: seal }).catch(() => ZERO);
  const name = Object.entries(s.seals).find(([, c]) => c.address.toLowerCase() === inv.creditor.toLowerCase())?.[0];
  const left = name ? s.seals[name].allowance : 0n;
  const free = s.usd > s.held ? s.usd - s.held : 0n;
  const ok = check(checks, 'agent active', s.agentExpiry >= s.now && s.agent !== ZERO, `expires ${new Date(Number(s.agentExpiry) * 1000).toISOString()}`)
    & check(checks, 'vault not paused', !s.paused, s.paused ? 'guardian or owner paused the vault' : 'running')
    & check(checks, 'seal intact: signed by the creditor itself', signer.toLowerCase() === inv.creditor.toLowerCase(), signer === ZERO ? 'no valid signature' : `signed by ${signer}`)
    & check(checks, 'creditor\'s seal accepted by the owner', left > 0n, name ? `${name}: ${fmtUsd(left)} tUSD of sealed invoices left` : `${inv.creditor} is not an accepted creditor`)
    & check(checks, 'within the creditor\'s allowance', inv.amount <= left, `${fmtUsd(inv.amount)} ≤ ${fmtUsd(left)}`)
    & check(checks, 'invoice not already settled', !used.has(key), key)
    & check(checks, 'vault can cover it', inv.amount <= free, `${fmtUsd(inv.amount)} ≤ ${fmtUsd(free)} not held for creditors`);
  const call = { functionName: 'settleInvoice', args: [inv.creditor, inv.amount, inv.invoiceId, seal] };
  return { decision: ok ? 'execute' : 'refuse', tier: 1, checks, opId: key, key, call, creditor: name ?? inv.creditor, amount: inv.amount, holdFor: s.contestWindow };
}

/** What the owner reads before signing. Built from the struct itself, never paraphrased by the model. */
export function renderMandate(m, registry) {
  const name = Object.entries(registry).find(([, p]) => p.address.toLowerCase() === m.to.toLowerCase());
  const who = name ? `${name[0]}${name[1].cap > 0n ? '' : ' (not a payee)'}` : 'UNKNOWN recipient, never paid before';
  return `Pay ${fmtUsd(m.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} tUSD to ${m.to} [${who}], once, `
    + `before ${new Date(Number(m.deadline) * 1000).toISOString().replace('.000Z', 'Z')}. Void if you revoke the agent (epoch ${m.epoch}).`;
}

export async function execute(ctx, d, verdict, { scene, label, force = false } = {}) {
  return ctx.send('agent', { address: d.vault, abi: ABI.vault, ...verdict.call, scene, label, force });
}
