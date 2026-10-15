// PDFs of the judge-facing documents, to attach to the submission email. A minimal Markdown → HTML (headings,
// paragraphs, nested lists, tables, code, quotes, links, images), printed by headless Edge or Chrome. Nothing leaves
// the machine.
// Usage: node scripts/doc-pdf.mjs [--repo <url>] [doc.md ...]   (default: docs/TECHNICAL.md docs/SECURITY.md; out: work/pdf)
// With --repo, links to repo files point to <url>/blob/main/...; without it they are relative and dead in a PDF.
// BROWSER=<path to msedge.exe or chrome.exe> if neither is at its usual place.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--repo');
const REPO_URL = at >= 0 ? args.splice(at, 2)[1]?.replace(/\/$/, '').replace(/\.git$/, '') : undefined;
const docs = args.length ? args : ['docs/TECHNICAL.md', 'docs/SECURITY.md'];
const OUT = join(ROOT, 'work', 'pdf');
const BROWSER = process.env.BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!BROWSER) { console.error('no Edge or Chrome found: set BROWSER'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s, base) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img alt="${alt}" src="${pathToFileURL(resolve(base, src)).href}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, href) => {
    if (REPO_URL && !/^(https?:|#)/.test(href)) href = `${REPO_URL}/blob/main/${relative(ROOT, resolve(base, href)).replace(/\\/g, '/')}`;
    return `<a href="${href}">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

function render(md, base) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const stack = []; // open lists: { indent, tag }
  const closeLists = (indent = -1) => { while (stack.length && stack.at(-1).indent > indent) out.push(`</li></${stack.pop().tag}>`); };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      closeLists(); const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      const longest = Math.max(...buf.map((b) => [...b].length)); // shrink wide diagrams instead of wrapping them
      out.push(`<pre style="font-size:${Math.min(8.5, 490 / (0.6 * longest)).toFixed(2)}pt">${esc(buf.join('\n'))}</pre>`); continue;
    }
    if (/^\s*\|/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      closeLists();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim(), base));
      out.push(`<table><thead><tr>${cells(l).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`); i++;
      while (/^\s*\|/.test(lines[i + 1] ?? '')) out.push(`<tr>${cells(lines[++i]).map((c) => `<td>${c}</td>`).join('')}</tr>`);
      out.push('</tbody></table>'); continue;
    }
    const h = l.match(/^(#{1,4}) (.*)/);
    if (h) { closeLists(); out.push(`<h${h[1].length}>${inline(h[2], base)}</h${h[1].length}>`); continue; }
    if (/^>/.test(l)) {
      closeLists(); const buf = [l];
      while (/^>/.test(lines[i + 1] ?? '')) buf.push(lines[++i]);
      out.push(`<blockquote>${render(buf.map((b) => b.replace(/^> ?/, '')).join('\n'), base)}</blockquote>`); continue;
    }
    const li = l.match(/^(\s*)([-*]|\d+\.) (.*)/);
    if (li) {
      const indent = li[1].length; const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      if (!stack.length || indent > stack.at(-1).indent) { out.push(`<${tag}><li>`); stack.push({ indent, tag }); }
      else { closeLists(indent); out.push('</li><li>'); }
      out.push(inline(li[3], base)); continue;
    }
    if (!l.trim()) { if (!/^\s+\S/.test(lines[i + 1] ?? '')) closeLists(); continue; }
    if (stack.length && /^\s+\S/.test(l)) { out.push(`<p>${inline(l.trim(), base)}</p>`); continue; } // paragraph inside a list item
    closeLists();
    const buf = [l];
    while (lines[i + 1]?.trim() && !/^(#|```|\s*\||>|\s*([-*]|\d+\.) )/.test(lines[i + 1])) buf.push(lines[++i]);
    out.push(`<p>${inline(buf.join(' '), base)}</p>`);
  }
  closeLists();
  return out.join('\n');
}

const CSS = `@page { size: A4; margin: 16mm 15mm; }
body { font: 10.5pt/1.45 "Segoe UI", Arial, sans-serif; color: #1a1d21; }
h1 { font-size: 20pt; margin: 0 0 8pt; } h2 { font-size: 14pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccd; padding-bottom: 2pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; } p, li { margin: 4pt 0; } ul, ol { padding-left: 18pt; margin: 4pt 0; }
h1, h2, h3 { break-after: avoid; }
code { font: 9pt Consolas, monospace; background: #f1f2f4; padding: 0 2pt; border-radius: 2pt; overflow-wrap: break-word; }
pre { font-family: Consolas, monospace; line-height: 1.3; background: #f4f5f7; padding: 6pt 8pt; white-space: pre; overflow: hidden; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9pt; } th, td { border: 1px solid #c9ccd3; padding: 3pt 5pt; vertical-align: top; text-align: left; overflow-wrap: break-word; }
th { background: #eef0f3; } tr { break-inside: avoid; } blockquote { border-left: 3pt solid #c9ccd3; margin: 6pt 0; padding: 0 8pt; color: #333; }
img { max-width: 100%; max-height: 120mm; display: block; margin: 6pt auto; } a { color: #1f5fbf; text-decoration: none; }`;

let failed = 0;
for (const doc of docs) {
  const file = resolve(ROOT, doc);
  const name = basename(doc, '.md');
  const html = `<!doctype html><meta charset="utf-8"><title>LEASH ${name}</title><style>${CSS}</style>${render(readFileSync(file, 'utf8'), dirname(file))}`;
  const htmlFile = join(OUT, `${name}.html`);
  const pdf = join(OUT, `LEASH-${name}.pdf`);
  writeFileSync(htmlFile, html);
  rmSync(pdf, { force: true }); // or an old PDF would pass for a new one
  const r = spawnSync(BROWSER, ['--headless=new', '--disable-gpu', `--user-data-dir=${join(OUT, '.browser-profile')}`, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { encoding: 'utf8', timeout: 120000 });
  if (r.status === 0 && existsSync(pdf)) console.log(`${doc} -> ${relative(ROOT, pdf)} (${Math.round(readFileSync(pdf).length / 1024)} KB)${REPO_URL ? '' : ', links relative: pass --repo <url> once the repo exists'}`);
  else { console.error(`${doc}: the browser failed (${r.status ?? r.error?.message})`); failed++; }
}
process.exit(failed ? 1 : 0);
