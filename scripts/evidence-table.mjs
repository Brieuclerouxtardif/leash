// Prints the latest campaign of a network as a Markdown table with explorer links, for README, SECURITY and the deck.
// Usage: node scripts/evidence-table.mjs [local|sepolia]
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const net = process.argv[2] ?? 'sepolia';
const dir = join(ROOT, 'evidence');
const file = readdirSync(dir).filter((f) => f.startsWith(`${net}-campaign-`) && f.endsWith('.json')).sort().at(-1);
if (!file) throw new Error(`no ${net} campaign in evidence/`);
const c = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const explorer = net === 'sepolia' ? 'https://sepolia.etherscan.io' : null;
const short = (h) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const link = (h) => (!h ? '(refused before signing)' : explorer ? `[${short(h)}](${explorer}/tx/${h})` : `\`${short(h)}\``);

// Every transaction of the run, not only the scene's final one, so [N] in the deck is a real count.
const journal = join(dir, file.replace(/\.json$/, '.jsonl'));
const txs = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.hash);

console.log(`Campaign \`${file}\`: **${c.passed}/${c.total}** as expected · vault ${explorer ? `[${c.vault}](${explorer}/address/${c.vault})` : `\`${c.vault}\``} · ${txs.length} transactions (${txs.filter((e) => e.status === 'reverted').length} mined refusals)\n`);
console.log('| Scene | What | Outcome | Transaction |');
console.log('|---|---|---|---|');
for (const r of c.results) console.log(`| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${r.pass ? '✓' : '✗'} \`${r.outcome}\` | ${link(r.hash)} |`);
