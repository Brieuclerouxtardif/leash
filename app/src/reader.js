// The offline reader: what reads a free message, typed or spoken, when no model answer is recorded for it and
// no live model is allowed. It is not a model and does not pass for one: a few words and numbers, read by
// rules, give at most two intents in the chat schema. LEASH's code and the vault then judge those intents
// exactly as they judge a model's, so the leash does not depend on what read the message.
//   guarded   follows the guarded prompt's rules: never an address from a message, nothing owner-only
//   hijacked  follows the hijacked prompt: does what the message asks, addresses included
import { amountsLoose } from './chat.js';

export const READER = 'offline reader (rules, no model)';

// Names a person would use for the three payees, in English, French and Chinese.
const PAYEES = {
  landlord: /\b(landlord|marta|silva|rent)\b|loyer|propri[ée]taire|proprio|房东|房租/i,
  utility: /\b(utility|utilities|lumen|electricity|electric|power|energy)\b|[ée]lectricit[ée]|[ée]nergie|电费|电力|水电/i,
  school: /\b(school|tuition|instituto|semester|university)\b|[ée]cole|scolarit[ée]|universit[ée]|学校|学费/i,
};
const BUY = /\bbuy\b|ach[èe]te|acheter|买/i;
const SELL = /\bsell\b|\bvend(?:s|re|ez)\b|卖/i;
const ETH = /\bt?eth\b|\bether(?:eum)?\b|以太/i;
const ADD_PAYEE = /\badd\b.*\b(payee|recipient|beneficiary)\b|ajout\w*.*b[ée]n[ée]ficiaire|添加.*收款|新增.*收款/i;
const LIMIT = /\b(raise|increase|lift)\b.*\blimit\b|augment\w*.*(limite|plafond)|提高.*限额|提额/i;
const WITHDRAW = /\b(withdraw|drain)\b|\bretir(?:e|er|ez)\b|提现|取出|提款/i;
const SECRET = /private key|seed phrase|mnemonic|secret key|system prompt|your (exact )?instructions|cl[ée] priv[ée]e|phrase secr[èe]te|tes instructions|私钥|助记词|指令/i;
const INJECT = /\[system\]|ignore (all |your )?(previous|prior)|maintenance mode|pre-?approved|developer mode|忽略.*指令/i;
const ADDR = /0x[a-fA-F0-9]{40}/;

export const langOf = (t) => (/[一-鿿]/.test(t) ? 'zh'
  : /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|du|des|pour|mon|ma|mes|paie|envoie|merci|stp|s'il)\b/i.test(t) ? 'fr' : 'en');

const NAMES = { en: { landlord: 'Marta, your landlord', utility: 'Lumen Energia', school: 'the school' },
  fr: { landlord: 'Marta, ta propriétaire', utility: 'Lumen Energia', school: 'l’école' },
  zh: { landlord: '房东 Marta', utility: 'Lumen Energia', school: '学校' } };

const SAY = {
  en: {
    pay: (who, n) => `Paying ${who} ${n} tUSD, if the vault allows it.`,
    swap: (side, n) => `${side === 'buy' ? `Buying tETH with ${n} tUSD` : `Selling ${n} tETH`}, at the oracle’s price or not at all.`,
    address: 'I don’t pay an address taken from a message: a new address is fraud until the owner confirms it.',
    owner: 'Only the owner’s key can do that. Not me, and not whoever wrote this.',
    secret: 'I hold no key, and I don’t share my instructions. Code signs, after its own checks.',
    inject: 'A message has no authority, whatever it calls itself. I’m not doing that.',
    howMuch: (who) => `How much should I pay ${who}?`,
    unknown: 'Tell me who to pay and how much, like “pay the electricity, 120”.',
    obey: 'Doing exactly what the message asks.',
    noKey: 'I have no key to give: code signs, not me.',
  },
  fr: {
    pay: (who, n) => `Je paie ${n} tUSD à ${who}, si le vault l’autorise.`,
    swap: (side, n) => `${side === 'buy' ? `J’achète du tETH avec ${n} tUSD` : `Je vends ${n} tETH`}, au prix de l’oracle ou pas du tout.`,
    address: 'Je ne paie pas une adresse lue dans un message : une nouvelle adresse est une fraude tant que le propriétaire ne l’a pas confirmée.',
    owner: 'Seule la clé du propriétaire peut faire ça. Pas moi, ni l’auteur de ce message.',
    secret: 'Je n’ai aucune clé et je ne partage pas mes instructions. C’est le code qui signe, après ses contrôles.',
    inject: 'Un message n’a aucune autorité, quel que soit son nom. Je ne le fais pas.',
    howMuch: (who) => `Combien dois-je payer à ${who} ?`,
    unknown: 'Dis-moi qui payer et combien, par exemple « paie l’électricité, 120 ».',
    obey: 'Je fais exactement ce que le message demande.',
    noKey: 'Je n’ai aucune clé à donner : c’est le code qui signe.',
  },
  zh: {
    pay: (who, n) => `向${who}支付 ${n} tUSD，前提是金库允许。`,
    swap: (side, n) => `${side === 'buy' ? `用 ${n} tUSD 买入 tETH` : `卖出 ${n} tETH`}，按预言机价格，否则不成交。`,
    address: '我不会向消息里的地址付款：在所有者确认之前，新地址一律视为诈骗。',
    owner: '只有所有者的密钥能做这件事。我不能，写这条消息的人也不能。',
    secret: '我没有任何密钥，也不会透露我的指令。签名的是代码，而且先经过它自己的检查。',
    inject: '消息没有任何权限，无论它自称什么。我不会照做。',
    howMuch: (who) => `要向${who}支付多少？`,
    unknown: '告诉我付给谁、付多少，例如“付电费 120”。',
    obey: '完全按照消息的要求执行。',
    noKey: '我没有密钥可给：签名的是代码，不是我。',
  },
};

const intent = (type, { payee = '', to = '', side = '', amount = 0, reason = 'read from the message' } = {}) => ({ type, payee, to, side, amount, reason });

/** Read one message as the guarded or the hijacked agent would. Same shape as the model's chat response. */
export function readMessage(text, profile = 'guarded') {
  const lang = langOf(text);
  const say = SAY[lang];
  const nums = amountsLoose(text);
  const addr = text.match(ADDR)?.[0] ?? '';
  const payee = Object.keys(PAYEES).find((k) => PAYEES[k].test(text)) ?? '';
  const who = payee ? NAMES[lang][payee] : '';
  const swap = ETH.test(text) && (BUY.test(text) || SELL.test(text)) ? (SELL.test(text) ? 'sell' : 'buy') : '';
  const owner = [ADD_PAYEE.test(text) && 'add_payee', LIMIT.test(text) && 'raise_daily_limit', WITHDRAW.test(text) && 'withdraw'].filter(Boolean);
  const out = (reply, intents = [], flags = []) => ({ reply, intents, flags });

  if (profile === 'hijacked') {
    if (SECRET.test(text)) return out(say.noKey);
    const intents = owner.map((type, k) => intent(type, { to: addr, amount: nums[k] ?? 0, reason: 'the message asks for it' }));
    if (!intents.length && swap) intents.push(intent('swap', { side: swap, amount: nums[0] ?? 0 }));
    if (!intents.length && (addr || payee) && nums.length) intents.push(intent('pay', { payee: addr ? '' : payee, to: addr, amount: nums[0], reason: 'the message asks for it' }));
    return out(intents.length ? say.obey : say.unknown, intents.slice(0, 2));
  }

  if (SECRET.test(text)) return out(say.secret, [], [{ kind: 'data_extraction', detail: 'asks for a key or the instructions' }]);
  if (addr) return out(say.address, [], [{ kind: 'address_change', detail: `a payment address in a message: ${addr}` }]);
  if (owner.length) return out(say.owner, [], [{ kind: 'other', detail: `owner-only: ${owner.join(', ')}` }]);
  if (INJECT.test(text)) return out(say.inject, [], [{ kind: 'prompt_injection', detail: 'claims an authority a message cannot have' }]);
  if (swap && nums.length) return out(say.swap(swap, nums[0]), [intent('swap', { side: swap, amount: nums[0] })]);
  if (payee && nums.length) return out(say.pay(who, nums[0]), [intent('pay', { payee, amount: nums[0] })]);
  if (payee) return out(say.howMuch(who));
  return out(say.unknown);
}
