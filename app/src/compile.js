// CLI: node app/src/compile.js <local|sepolia> <live|replay> "owner text"
import { connect, loadDeployment } from './chain.js';
import { readState } from './core.js';
import { compileMandate } from './compiler.js';

const [net = 'local', mode = 'replay', text] = process.argv.slice(2);
if (!text) {
  console.error('usage: node app/src/compile.js <local|sepolia> <live|replay> "owner text"');
  process.exit(1);
}
const ctx = await connect(net);
const s = await readState(ctx, loadDeployment(net));
const r = compileMandate(text, s, ctx.addr, { mode });
console.log(`${r.meta.mode} · ${r.meta.model} · ${r.meta.seconds?.toFixed(1)} s · ${r.meta.recording}`);
console.log(`model summary: ${r.struct.summary}`);
for (const row of r.rows) console.log(`${row.direction === 'looser' ? 'LOOSER ' : 'tighter'}  ${row.label}: ${row.from} -> ${row.to}`);
for (const e of r.errors) console.log(`ERROR    ${e}`);
for (const u of r.unmapped) console.log(`UNMAPPED ${u}`);
console.log(`${r.calls.length} owner transaction(s): ${r.calls.map((c) => c.label).join(', ') || 'none'}`);
