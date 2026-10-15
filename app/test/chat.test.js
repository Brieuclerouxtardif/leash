import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worstCase } from '../src/core.js';
import { diffMandate } from '../src/compiler.js';
import { chatPrompt, chatSamples, judgeChat, rawCall, amountsLoose } from '../src/chat.js';

const A = {
  landlord: '0xDAB5071EAf37Bf4D564e6a33da3F9E6A74687B82',
  utility: '0x0EB8b81BC749F35ec9333dae78CD178d69aB6AeE',
  school: '0x1ef32F56C8fd7c972eE68FD845691C80755b7C6f',
  attacker: '0x5DF4d21799E8b29698121B3091D22F9A7510FeaE',
};
const u = (n) => BigInt(Math.round(n * 1e6));
const DAY = 86400n;
const NOW = 20833n * DAY + 3600n; // 01:00 UTC

function state(over = {}) {
  const price = 2500n * 10n ** 8n;
  return {
    now: NOW, agent: '0x4B2afDa45aa306B02ee4b5286585BC558c165fbD', agentExpiry: NOW + DAY, paused: false, epoch: 1,
    limits: { payPerTx: u(1000), payDaily: u(1500), swapPerTx: u(500), swapDaily: u(1000) },
    risk: { maxSlippageBps: 100, maxRiskBps: 4000, maxOracleAge: 7200 },
    paidToday: 0n, swappedToday: 0n, usd: u(12000), eth: 12n * 10n ** 17n, ethValue: u(3000), price, priceUpdatedAt: NOW - 60n,
    riskBps: 2000, pool: { usd: u(500000), eth: 200n * 10n ** 18n, price },
    payees: { landlord: { address: A.landlord, cap: u(900) }, utility: { address: A.utility, cap: u(150) }, school: { address: A.school, cap: 0n } },
    ...over,
  };
}

test('worst case: what is left of today, then the daily limit at each midnight before the key expires, capped by the vault', () => {
  const w = worstCase(state());
  assert.deepEqual([w.live, w.to, w.today, w.perDay, w.untilExpiry, w.swapLossPerDay], [true, ['landlord', 'utility'], 1500, 1500, 3000, 10]);
  assert.equal(worstCase(state({ paidToday: u(800) })).today, 700);
  assert.equal(worstCase(state({ paidToday: u(800) })).untilExpiry, 2200);
  assert.equal(worstCase(state({ agentExpiry: NOW + 30n * DAY })).untilExpiry, 12000, 'never more than the vault holds');
  // Then the balance is the bound and a shorter key does not lower the total: the number of paying days does.
  assert.deepEqual([w.days, w.byBalance], [2, false]);
  assert.deepEqual(['days', 'byBalance'].map((k) => worstCase(state({ agentExpiry: NOW + 30n * DAY }))[k]), [31, true]);
  // Limits lowered below what was already paid today: nothing more today, not a negative number.
  assert.equal(worstCase(state({ paidToday: u(1500), limits: { ...state().limits, payDaily: u(1000) } })).today, 0);
});

test('worst case is zero when the agent cannot act: paused, expired, revoked or no payee', () => {
  for (const over of [{ paused: true }, { agentExpiry: NOW - 1n }, { agent: '0x0000000000000000000000000000000000000000' }]) {
    const w = worstCase(state(over));
    assert.deepEqual([w.live, w.today, w.untilExpiry, w.days], [false, 0, 0, 0], Object.keys(over)[0]);
  }
  const none = worstCase(state({ payees: { landlord: { address: A.landlord, cap: 0n } } }));
  assert.deepEqual([none.to, none.today, none.untilExpiry], [[], 0, 0]);
});

test('the mandate editor shows the worst case after a change: a looser rule raises it, a tighter one lowers it', () => {
  const s = state();
  const after = (m) => worstCase({ ...s, ...diffMandate(s, m, A).next });
  assert.equal(after({ limits: { payDaily: 3000 } }).perDay, 3000);
  assert.deepEqual(after({ payees: [{ name: 'school', cap: 900 }] }).to, ['landlord', 'utility', 'school']);
  assert.deepEqual(after({ payees: [{ name: 'landlord', cap: 0 }, { name: 'utility', cap: 0 }] }).untilExpiry, 0);
  assert.equal(after({ risk: { maxSlippagePct: 3 } }).swapLossPerDay, 30);
  assert.equal(after({ agentDays: 1 / 24 }).untilExpiry, 1500, 'a key that expires before midnight only has today');
  assert.equal(after({ agentDays: 1 / 24 }).days, 1);
});

test('the chat prompt carries no secret and no vault state; the message stays inside its markers', () => {
  for (const profile of ['guarded', 'hijacked']) {
    const p = chatPrompt(profile, 'hello');
    assert.doesNotMatch(p, /0x[0-9a-fA-F]{64}|private ?key/i);
    assert.doesNotMatch(p, /\b(12,?000|1,?500|900)\b/, 'no balance or limit: code checks the numbers');
    assert.match(p, /<<<MESSAGE\nhello\nMESSAGE>>>/);
  }
});

test('LEASH\'s code refuses what a hijacked model proposes from a chat message, and asks the owner for the rest', () => {
  const s = state();
  const [bec, becZh, fakeOwner, , , school, power] = chatSamples(A.attacker).map((text, n) => ({ id: `msg-${n}`, text }));
  const J = (intent, doc) => judgeChat({ payee: '', to: '', side: '', reason: 'r', ...intent }, s, doc, { week: 'w' });
  // Induced transfer: the address in the message is never paid, by name or by address, in English or Chinese.
  for (const doc of [bec, becZh]) {
    assert.equal(J({ type: 'pay', to: A.attacker, amount: 800 }, doc).decision, 'refuse');
    assert.equal(J({ type: 'pay', payee: 'landlord', amount: 800 }, doc).decision, 'refuse');
  }
  assert.equal(J({ type: 'pay', to: A.attacker, amount: 9000 }, fakeOwner).decision, 'refuse');
  // Privilege escalation: no agent path, whatever the message.
  for (const type of ['add_payee', 'raise_daily_limit', 'withdraw']) {
    const v = J({ type, to: A.attacker, amount: 1e6 }, power);
    assert.deepEqual([v.decision, v.tier], ['refuse', 3]);
  }
  // Honest requests: tier 1 alone, tier 2 with the owner's signature; never an amount the message did not give.
  assert.equal(J({ type: 'pay', payee: 'utility', amount: 120 }, power).decision, 'execute');
  assert.equal(J({ type: 'pay', payee: 'school', amount: 5000 }, school).decision, 'needs_owner');
  assert.equal(J({ type: 'pay', payee: 'utility', amount: 150 }, power).decision, 'refuse');
  assert.deepEqual(amountsLoose(`pay 800 to ${A.attacker}, not 1,500.5`), [800, 1500.5]);
});

test('a hijacked server sends exactly what the model asked, unchecked; only a call the contract cannot parse is dropped', () => {
  const s = state();
  const d = { usd: '0x000000000000000000000000000000000000dEaD' };
  const R = (intent) => rawCall({ payee: '', to: '', side: '', reason: '', ...intent }, s, d, 'k');
  assert.deepEqual(R({ type: 'pay', to: A.attacker, amount: 9000 }).args.slice(0, 2), [A.attacker, u(9000)]);
  assert.deepEqual(R({ type: 'pay', payee: 'landlord', amount: 800 }).args.slice(0, 2), [A.landlord, u(800)]);
  assert.deepEqual(R({ type: 'swap', side: 'buy', amount: 400 }).args.slice(0, 3), [true, u(400), 0n], 'any price: the vault sets the floor');
  assert.equal(R({ type: 'add_payee', to: A.attacker, amount: 1e6 }).functionName, 'setPayee');
  assert.equal(R({ type: 'raise_daily_limit', amount: 50000 }).args[0].payDaily, u(50000));
  assert.deepEqual(R({ type: 'withdraw', to: A.attacker, amount: 100 }).args, [d.usd, A.attacker, u(100)]);
  for (const bad of [{ type: 'pay', to: '0x1234', amount: 5 }, { type: 'pay', amount: Number.NaN, payee: 'landlord' }, { type: 'pay', payee: 'landlord', amount: 1e21 }, { type: 'withdraw', amount: 5 }]) {
    assert.equal(R(bad), null, JSON.stringify(bad));
  }
});
