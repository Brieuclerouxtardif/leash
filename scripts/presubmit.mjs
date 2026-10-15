// The last check before submitting: what is easy to get wrong on the last day. It sends no transaction; it reads git,
// the files in the repo, and the public APIs of GitHub and Blockscout.
// Usage: node scripts/presubmit.mjs [--forge]   (GIT=<path to git.exe>, FORGE=<path to forge.exe> if not on the PATH)
// ✓ fine · ! a decision or a reminder · ✗ must be fixed. Exit code 1 when anything is ✗.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './video-script.mjs';

const DEADLINE = Date.parse('2026-10-20T15:59:00Z');
let failed = 0;
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const fail = (m) => { console.log(`✗ ${m}`); failed++; };
const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } }); return { status: r.status, body: r.ok ? await r.json() : null }; };

const left = (DEADLINE - Date.now()) / 3.6e6;
if (left <= 0) fail('the deadline (2026-10-20 15:59 UTC) has passed');
else (left < 24 ? warn : ok)(`${Math.floor(left)} h ${Math.floor((left % 1) * 60)} min left before the deadline (2026-10-20 15:59 UTC, 17:59 Paris)`);

// ---- Git: nothing secret tracked, everything committed and pushed to a public repo.
const GIT = process.env.GIT ?? 'git';
const git = (...a) => { const r = spawnSync(GIT, a, { cwd: ROOT, encoding: 'utf8' }); if (r.error) throw r.error; return r.status === 0 ? r.stdout.trimEnd() : ''; };
let remote = '';
try {
  const dirty = git('status', '--porcelain');
  if (dirty) fail(`uncommitted changes, which the judges will not see:\n  ${dirty.split('\n').join('\n  ')}`); else ok('everything is committed');
  const leaks = git('ls-files').split('\n').filter((f) => /^secrets\/|(^|\/)\.env|local-access\.json$|\.(pem|key)$/.test(f));
  if (leaks.length) fail(`tracked files that must never be public: ${leaks.join(', ')}`); else ok('no secrets/, .env or key file is tracked');
  remote = git('remote', 'get-url', 'origin').replace(/\.git$/, '');
  if (!remote) fail('no GitHub remote yet (SUBMISSION.md, step 8)');
  else if (git('rev-parse', 'HEAD') !== git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main')) fail(`the last commit is not on ${remote}: git push`);
  else ok(`the last commit is on ${remote}`);
  const repo = remote.match(/github\.com[/:]([^/]+\/[^/]+)$/)?.[1];
  if (repo) {
    const r = await get(`https://api.github.com/repos/${repo}`).catch((e) => ({ status: e.message }));
    if (r.status === 200 && !r.body.private) ok(`${repo} is public`); else fail(`${repo} is not visible without logging in (GitHub answered ${r.status}): make it public`);
  }
  const emails = [...new Set(git('log', '--format=%ae').split('\n'))].filter((e) => e && !e.endsWith('@users.noreply.github.com'));
  if (emails.length) warn(`the commits show ${emails.join(', ')} to anyone once pushed (SUBMISSION.md, step 8: your decision)`);
} catch (e) { fail(`git did not run (${e.message}): set GIT to the path of git.exe`); }

if (existsSync(join(ROOT, 'LICENSE'))) ok('LICENSE file present');
else warn('no LICENSE file: only the contracts carry a license (SPDX MIT); SUBMISSION.md, step 8');

// ---- Judge-facing documents: no placeholder left.
for (const f of ['README.md', 'docs/TECHNICAL.md', 'docs/SECURITY.md', 'docs/evidence-sepolia.md']) {
  const hits = readFileSync(join(ROOT, f), 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\[team name\]|<url>|<user>|\bTODO\b|\bTBD\b|XXX/.test(l));
  if (hits.length) fail(`${f} still has placeholders: ${hits.map(([n]) => `line ${n}`).join(', ')}`);
}

// ---- The video: the newest full-size render of compose-video.mjs (it leaves a .json next to each one).
const renders = [];
const walk = (dir, depth) => {
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (depth) walk(p, depth - 1); } else if (name.endsWith('.json')) {
      try { const j = JSON.parse(readFileSync(p, 'utf8')); if (j.renderedAt && j.file) renders.push(j); } catch {}
    }
  }
};
walk(join(ROOT, 'work'), 2);
const video = renders.filter((r) => !r.preview && existsSync(r.file)).sort((a, b) => b.renderedAt.localeCompare(a.renderedAt))[0];
const size = video && statSync(video.file).size;
if (!video) fail('no final video under work/ with its render record (.json); the rules page requires one: render it with compose-video.mjs --repo <url> (docs/VIDEO.md); a --preview does not count');
else if (size !== video.bytes) fail(`${video.file} is ${size} bytes, not the ${video.bytes ?? '?'} its render wrote: an interrupted render or another file; render it again`);
else {
  const mb = (size / 1e6).toFixed(0);
  const s = Math.round(video.seconds); // round first, or 179.7 s prints as 2:60
  ok(`video: ${video.file} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}, ${mb} MB, ${video.network}, rendered ${video.renderedAt.slice(0, 16)} UTC)`);
  if (video.seconds > 300) fail('the video is longer than the 5-minute limit');
  if (video.voice === 'person') ok('the video is narrated by a person');
  else if (video.voice === 'windows') warn('the video has the synthetic voice; a narrated one is preferred (record-voice.mjs, docs/VIDEO.md)');
  else fail('the video has no voice at all');
  if (!video.repo) fail('the closing card shows no repo URL: render again with --repo <url>');
  else if (remote && video.repo.replace(/\/$/, '').replace(/\.git$/, '') !== remote.replace(/^git@github\.com:/, 'https://github.com/')) fail(`the closing card shows ${video.repo}, but the repo is ${remote}`);
  else ok(`the closing card shows ${video.repo}`);
}

// ---- Blockscout: does the README's "decodes N of M" still match, now that its indexer has had time?
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const claim = readme.match(/Blockscout decodes (\d+) of the (\d+) refusals|Blockscout decodes (\d+) of (\d+)/);
const vault = readme.match(/sepolia\.etherscan\.io\/address\/(0x[0-9a-fA-F]{40})/)?.[1]?.toLowerCase();
const run = readdirSync(join(ROOT, 'evidence')).filter((f) => /^sepolia-campaign-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'evidence', f), 'utf8'))).find((c) => c.vault?.toLowerCase() === vault);
if (claim && run) {
  const said = Number(claim[1] ?? claim[3]);
  const refusals = run.results.filter((r) => r.hash && r.outcome.startsWith('reverted'));
  try {
    const decoded = [];
    for (const r of refusals) {
      const t = (await get(`https://eth-sepolia.blockscout.com/api/v2/transactions/${r.hash}`)).body;
      if (t?.revert_reason?.method_call || t?.revert_reason?.parameters) decoded.push(r.id);
    }
    if (decoded.length === said) ok(`Blockscout decodes ${decoded.length} of ${refusals.length} refusals, as the README says`);
    else if (decoded.length > said) warn(`Blockscout now decodes ${decoded.length} of ${refusals.length} refusals (the README says ${said}): run node scripts/evidence-doc.mjs and update README, SECURITY.md, SUBMISSION.md and the deck`);
    else fail(`Blockscout decodes only ${decoded.length} of ${refusals.length} refusals, fewer than the README's ${said}: check before claiming it`);
  } catch (e) { warn(`Blockscout did not answer (${e.message}); the README's "${said} of ${refusals.length}" is unchecked`); }
} else warn('could not find the Blockscout claim or the reference run in the README; unchecked');

// ---- Tests, as a judge would run them.
const node = spawnSync(process.execPath, ['--test', 'app/test/*.test.js'], { cwd: ROOT, encoding: 'utf8' });
const pass = node.stdout.match(/^(?:# |ℹ )pass (\d+)/m)?.[1]; // tap or spec reporter
if (node.status === 0) ok(`npm test: ${pass} passed`); else fail(`npm test failed:\n${node.stdout.slice(-1500)}`);
if (process.argv.includes('--forge')) {
  const forge = spawnSync(process.env.FORGE ?? 'forge', ['test'], { cwd: join(ROOT, 'contracts'), encoding: 'utf8' });
  if (forge.error) fail(`forge did not run (${forge.error.message}): set FORGE to the path of forge.exe`);
  else if (forge.status === 0) ok(`forge test: ${forge.stdout.match(/Ran \d+ test suites?.*$/m)?.[0] ?? 'passed'}`);
  else fail(`forge test failed:\n${forge.stdout.slice(-1500)}`);
}

// ---- What no script can see.
console.log(`
Still to do by hand, if not done:
- the team: 2 to 5 full-time students, at least 60 % non-Chinese, each with ID and proof of enrolment (a one-person entry is refused)
- the organizers' answers (fintechathon@ican-x.com): are testnet hashes accepted, and can the topic move from C to F?
- the deck: team name and GitHub URL filled in, exported to PDF or PPTX
- the video as a link (a GitHub release asset or an unlisted upload): 91 MB cannot be attached to an email; do not commit it
- the submission itself: one email to fintechathon@ican-x.com with every member's details and the materials (docs/SUBMISSION.md)`);
process.exit(failed ? 1 : 0);
