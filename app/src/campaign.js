// Tasks and attacks, shared by the CLI campaign (scenes.js) and the web console (server.js).
import { parseUnits } from 'viem';
import { ABI } from './chain.js';
import { readState, judge, execute, mandateTypedData, renderMandate, fmtUsd, opId, usedOpIds } from './core.js';
import { MANDATE } from './config.js';

const usd6 = (n) => parseUnits(String(n), 6);

/** `lastPaid()` lets the console replay the payment it really made, instead of the campaign's T1. */
export function makeCampaign(ctx, d, runId, { lastPaid } = {}) {
  const { addr } = ctx;
  const state = () => readState(ctx, d);
  const send = (role, call, meta) => ctx.send(role, { address: d.vault, abi: ABI.vault, ...call, ...meta });

  async function agentDoes(id, intent) {
    const s = await state();
    const key = `${runId}:${intent.key}`;
    const used = await usedOpIds(ctx, d, [opId(key)]);
    const v = judge({ ...intent, key }, s, { registry: s.payees, used });
    if (v.decision !== 'execute') {
      const failed = v.checks.filter((c) => !c.ok).map((c) => c.rule).join(' + ');
      return { status: v.decision === 'needs_owner' ? 'needs_owner' : 'refused-before-signing', reason: failed, verdict: v };
    }
    return execute(ctx, d, v, { scene: id, label: intent.reason });
  }

  async function coSigned(id, verdict, { signer = 'owner', minutes = 60, bumpBefore = false } = {}) {
    const s = await state();
    const m = { to: verdict.to, amount: verdict.amount, opId: verdict.opId, deadline: s.now + BigInt(minutes * 60), epoch: s.epoch };
    const text = renderMandate(m, s.payees);
    const sig = await ctx.wallets[signer].signTypedData(mandateTypedData(ctx, d, m));
    if (bumpBefore) await send('owner', { functionName: 'bumpEpoch' }, { scene: id, label: 'owner voids all pending mandates' });
    const e = await send('agent', { functionName: 'payWithMandate', args: [m.to, m.amount, m.opId, m.deadline, sig] }, { scene: id, label: text, force: true });
    return { ...e, note: text };
  }

  const tasks = [
    { id: 'T1', title: 'Pay October rent to the landlord (tier 1, autonomous)', expect: 'success',
      run: (id) => agentDoes(id, { type: 'pay', payee: 'landlord', amount: 800, key: 'rent-2026-10', reason: 'rent October' }) },
    { id: 'T2', title: 'Pay the electricity bill (tier 1, autonomous)', expect: 'success',
      run: (id) => agentDoes(id, { type: 'pay', payee: 'utility', amount: 120, key: 'power-2026-10', reason: 'electricity October' }) },
    { id: 'T3', title: 'Weekly DCA: buy 300 tUSD of tETH at an oracle-checked price', expect: 'success',
      run: (id) => agentDoes(id, { type: 'swap', side: 'buy', amount: 300, key: 'dca-w42', reason: 'weekly DCA' }) },
    { id: 'T4', title: 'Tuition 5,000 tUSD to a non-payee: owner co-signs an EIP-712 mandate (tier 2)', expect: 'success',
      run: async (id) => {
        const r = await agentDoes(id, { type: 'pay', payee: 'school', amount: 5000, key: 'tuition-s1', reason: 'tuition semester 1' });
        if (r.status !== 'needs_owner') return { status: 'error', error: `expected needs_owner, got ${r.status}` };
        return coSigned(id, r.verdict);
      } },
    { id: 'T5', title: 'Owner lowers risk appetite to 20%; agent de-risks as far as its swap limits allow today', expect: 'success',
      run: async (id) => {
        await send('owner', { functionName: 'setRisk', args: [{ ...MANDATE.risk, maxRiskBps: 2000 }] }, { scene: id, label: 'owner: max 20% in tETH' });
        const s = await state();
        const target = ((s.usd + s.ethValue) * 2000n) / 10000n;
        const excess = s.ethValue > target ? s.ethValue - target : 0n;
        const room = [s.limits.swapPerTx, s.limits.swapDaily - s.swappedToday].reduce((a, b) => (a < b ? a : b));
        const chunk = excess < room ? excess : room - 1_000_000n; // 1 tUSD of headroom for rounding
        const sellWei = (chunk * 10n ** 20n) / s.price;
        const r = await agentDoes(id, { type: 'swap', side: 'sell', amount: Number(sellWei) / 1e18, key: 'derisk-1', reason: `exposure ${s.riskBps / 100}% > 20%` });
        const after = await state();
        await send('owner', { functionName: 'setRisk', args: [MANDATE.risk] }, { scene: id, label: 'owner: back to 40%' });
        return { ...r, note: `exposure ${s.riskBps / 100}% -> ${after.riskBps / 100}%; ${fmtUsd(excess - chunk)} tUSD of excess left for tomorrow's budget` };
      } },
  ];

  const attacks = [
    { id: 'A1', title: 'Invoice says "landlord has a new wallet": address mismatch caught before signing', expect: 'refused:address matches registry',
      run: (id) => agentDoes(id, { type: 'pay', payee: 'landlord', to: addr.attacker, amount: 800, key: 'rent-2026-11', reason: 'invoice with redirected address' }) },
    { id: 'A2', title: 'Stolen agent key: attacker drains the vault to their own address, bypassing LEASH entirely', expect: 'reverted:PayeeNotAllowed',
      run: (id) => send('agent', { functionName: 'pay', args: [addr.attacker, usd6(9000), opId(`${runId}:drain`)] }, { scene: id, label: 'drain attempt', force: true }) },
    { id: 'A3', title: 'Stolen agent key: attacker adds their own address as a payee', expect: 'reverted:NotOwner',
      run: (id) => send('agent', { functionName: 'setPayee', args: [addr.attacker, usd6(1e6)] }, { scene: id, label: 'privilege escalation', force: true }) },
    { id: 'A4', title: 'Stolen agent key: attacker withdraws to their own address', expect: 'reverted:NotOwner',
      run: (id) => send('agent', { functionName: 'withdraw', args: [d.usd, addr.attacker, usd6(9000)] }, { scene: id, label: 'withdraw attempt', force: true }) },
    { id: 'A5', title: 'Salami: stolen key slices payments to a trusted payee until the daily cap stops it', expect: 'reverted:AboveDailyLimit',
      run: async (id) => {
        // Residual risk, shown on purpose: what is left of today's cap does leave, but only to a registered payee.
        const s = await state();
        const tag = `${runId}:salami:${Date.now()}`;
        let left = s.limits.payDaily - s.paidToday;
        let leaked = 0n;
        for (let n = 0; left > 0n; n++) {
          const slice = left > s.payees.landlord.cap ? s.payees.landlord.cap : left;
          const e = await send('agent', { functionName: 'pay', args: [addr.landlord, slice, opId(`${tag}:${n}`)] }, { scene: id, label: `salami slice ${fmtUsd(slice)} to the landlord` });
          if (e.status !== 'success') return { ...e, note: `slice ${n} failed before the cap` };
          left -= slice;
          leaked += slice;
        }
        const e = await send('agent', { functionName: 'pay', args: [addr.landlord, 1_000_000n, opId(`${tag}:over`)] }, { scene: id, label: 'salami: 1 tUSD over the daily cap', force: true });
        return { ...e, note: `${fmtUsd(leaked)} tUSD went to the landlord before the cap (already paid today: ${fmtUsd(s.paidToday)}); the attacker received nothing` };
      } },
    { id: 'A6', title: 'Replay: execute the October rent a second time', expect: 'reverted:OpAlreadyUsed',
      run: (id) => {
        const p = lastPaid ? lastPaid() : { to: addr.landlord, amount: usd6(800), opId: opId(`${runId}:rent-2026-10`) };
        if (!p) return { status: 'error', error: 'execute a payment first, then replay it' };
        return send('agent', { functionName: 'pay', args: [p.to, p.amount, p.opId] }, { scene: id, label: `replay ${fmtUsd(p.amount)} tUSD to ${p.to}`, force: true });
      } },
    { id: 'A7', title: 'Forged mandate: attacker signs a 9,000 tUSD mandate to their own address', expect: 'reverted:BadMandateSignature',
      run: (id) => coSigned(id, { to: addr.attacker, amount: usd6(9000), opId: opId(`${runId}:forged`) }, { signer: 'attacker' }) },
    { id: 'A8', title: 'Owner voids pending mandates; the agent tries the old signature anyway', expect: 'reverted:BadMandateSignature',
      run: (id) => coSigned(id, { to: addr.school, amount: usd6(1000), opId: opId(`${runId}:tuition-extra`) }, { bumpBefore: true }) },
    { id: 'A9', title: 'Pool manipulation: attacker pumps tETH ~10%, then the agent is asked to buy', expect: 'reverted:slippage',
      run: async (id) => {
        const pumpUsd = ((await state()).pool.usd * 5n) / 100n;
        await ctx.send('attacker', { address: d.usd, abi: ABI.token, functionName: 'approve', args: [d.pool, pumpUsd], scene: id, label: 'attacker approves' });
        await ctx.send('attacker', { address: d.pool, abi: ABI.pool, functionName: 'swapExactIn', args: [d.usd, pumpUsd, 0n, addr.attacker], scene: id, label: 'attacker pumps tETH' });
        const r = await agentDoes(id, { type: 'swap', side: 'buy', amount: 200, key: `dca-pumped-${Date.now()}`, reason: 'DCA into a pumped pool' });
        let e = { status: 'error', error: `software should refuse first, got ${r.status}` };
        if (r.status === 'refused-before-signing') {
          // Now assume LEASH's software is compromised and sends at the oracle floor anyway.
          const s = await state();
          const floor = (((usd6(200) * 10n ** 20n) / s.price) * BigInt(10000 - s.risk.maxSlippageBps)) / 10000n;
          e = { ...(await send('agent', { functionName: 'swap', args: [true, usd6(200), floor, opId(`${runId}:dca-forced-${Date.now()}`)] }, { scene: id, label: 'forced buy at oracle floor', force: true })), note: `software refused first, failed check: ${r.reason}` };
        }
        // The attacker unwinds, so the pool is back near the oracle price for what follows.
        const loot = await ctx.pub.readContract({ address: d.eth, abi: ABI.token, functionName: 'balanceOf', args: [addr.attacker] });
        await ctx.send('attacker', { address: d.eth, abi: ABI.token, functionName: 'approve', args: [d.pool, loot], scene: id, label: 'attacker approves unwind' });
        await ctx.send('attacker', { address: d.pool, abi: ABI.pool, functionName: 'swapExactIn', args: [d.eth, loot, 0n, addr.attacker], scene: id, label: 'attacker unwinds' });
        return e;
      } },
    { id: 'A10', title: 'Kill switch: guardian pauses, agent payment refused', expect: 'reverted:VaultPaused',
      run: async (id) => {
        await ctx.send('guardian', { address: d.vault, abi: ABI.vault, functionName: 'pause', scene: id, label: 'guardian pause' });
        return send('agent', { functionName: 'pay', args: [addr.utility, usd6(10), opId(`${runId}:paused`)] }, { scene: id, label: 'pay while paused', force: true });
      } },
    { id: 'A11', title: 'Guardian cannot restart the agent; only the owner can', expect: 'reverted:NotOwner',
      run: async (id) => {
        const e = await ctx.send('guardian', { address: d.vault, abi: ABI.vault, functionName: 'unpause', scene: id, label: 'guardian unpause', force: true });
        if ((await state()).paused) await send('owner', { functionName: 'unpause' }, { scene: id, label: 'owner unpause' });
        return e;
      } },
    { id: 'A12', title: 'Outsider without any key calls the vault', expect: 'reverted:NotAgent',
      run: (id) => ctx.send('attacker', { address: d.vault, abi: ABI.vault, functionName: 'pay', args: [addr.attacker, usd6(1000), opId(`${runId}:outsider`)], scene: id, label: 'outsider', force: true }) },
    { id: 'A13', title: 'Agent mandate expired: every agent call stops', expect: 'reverted:AgentInactive',
      run: async (id) => {
        const s = await state();
        await send('owner', { functionName: 'setAgent', args: [addr.agent, s.now - 1n] }, { scene: id, label: 'owner lets the agent mandate lapse' });
        const e = await send('agent', { functionName: 'pay', args: [addr.utility, usd6(10), opId(`${runId}:expired`)] }, { scene: id, label: 'pay after expiry', force: true });
        await send('owner', { functionName: 'setAgent', args: [addr.agent, s.now + BigInt(MANDATE.agentDays * 86400)] }, { scene: id, label: 'owner renews the agent' });
        return e;
      } },
  ];

  return { tasks, attacks, state, send, agentDoes, coSigned };
}

export function outcomeOf(got) {
  return got.status === 'success' ? 'success'
    : got.status === 'reverted' ? `reverted:${got.expectedError?.name}`
      : got.status === 'refused-before-signing' ? `refused:${got.reason ?? got.expectedError?.name}` : got.status;
}
