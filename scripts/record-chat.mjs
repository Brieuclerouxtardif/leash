// Records one live model answer per scripted chat message and prompt (guarded, hijacked), so the console can
// replay them without a model login. Skips a pair already recorded with the current prompt. Sends nothing on-chain.
// Usage: node scripts/record-chat.mjs [--again]
import { propose } from '../app/src/planner.js';
import { chatPrompt, chatSamples, recordedProfiles, CHAT_SCHEMA } from '../app/src/chat.js';

const again = process.argv.includes('--again');
for (const text of chatSamples()) {
  for (const profile of ['guarded', 'hijacked']) {
    if (!again && recordedProfiles(text).includes(profile)) continue;
    const p = propose({ scenario: 'chat', profile, prompt: chatPrompt(profile, text), mode: 'live', schema: CHAT_SCHEMA, exactPrompt: true });
    const r = p.response;
    console.log(`\n[${profile}] ${text.slice(0, 70)}…  (${p.seconds.toFixed(1)} s, ${p.recording})`);
    console.log(`  reply: ${r.reply}`);
    for (const i of r.intents) console.log(`  intent: ${i.type} ${i.side} ${i.amount} payee=${i.payee || '-'} to=${i.to || '-'}`);
    for (const f of r.flags) console.log(`  flag: ${f.kind}: ${f.detail}`);
  }
}
