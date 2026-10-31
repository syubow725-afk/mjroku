// GitHub Pages の公開を確かめる：npm run check:pages（公開を待つなら npm run check:pages -- --wait）
//
// 1. GitHub Actions の最新の公開（pages.yml）が成功したか（公開 API。ログイン不要、1 時間 60 回まで）
// 2. 公開中の sw.js の版が、手元の最新コミットの app/sw.js の版と同じか
// リポジトリと Pages の URL は git remote から求める（ソースに個人名を直書きしない）
import { execSync } from 'node:child_process';

const wait = process.argv.includes('--wait');
const WAIT_LIMIT_MS = 5 * 60 * 1000;

const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const [, owner, repo] = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote) || [];
if (!owner) throw new Error(`GitHub のリポジトリが分かりません: ${remote}`);
const pagesUrl = `https://${owner}.github.io/${repo}/`;
const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const versionOf = (text) => /CACHE_VERSION = '([^']+)'/.exec(text)?.[1] || '?';
// 比べるのはコミット済みの版（push したもの）。作業中でまだコミットしていない変更は見ない
const localVersion = versionOf(execSync('git show HEAD:app/sw.js', { encoding: 'utf8' }));

async function latestRun() {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/pages.yml/runs?per_page=1`,
    { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return { error: `GitHub API ${res.status}` };
  const run = (await res.json()).workflow_runs?.[0];
  return run ? { status: run.status, conclusion: run.conclusion, sha: run.head_sha, url: run.html_url } : { error: '公開の記録がありません' };
}

async function liveVersion() {
  // ?t= で途中のキャッシュを避ける
  const res = await fetch(`${pagesUrl}sw.js?t=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? versionOf(await res.text()) : `取得できません（${res.status}）`;
}

async function check() {
  const [run, live] = await Promise.all([latestRun(), liveVersion()]);
  return { run, live, ok: !run.error && run.conclusion === 'success' && run.sha === head && live === localVersion };
}

function report({ run, live }) {
  console.log(`手元     : v${localVersion}（${head.slice(0, 7)}・コミット済みの版）`);
  if (run.error) console.log(`公開処理 : ${run.error}`);
  else {
    const state = run.status !== 'completed' ? `実行中（${run.status}）` : run.conclusion === 'success' ? '成功' : `失敗（${run.conclusion}）`;
    const which = run.sha === head ? '手元と同じコミット' : `別のコミット ${run.sha.slice(0, 7)}（手元をまだ push していないか、公開待ち）`;
    console.log(`公開処理 : ${state}・${which}`);
    if (run.conclusion && run.conclusion !== 'success') console.log(`           ${run.url}`);
  }
  console.log(`公開中   : v${live}`);
}

const started = Date.now();
let result = await check();
while (wait && !result.ok && Date.now() - started < WAIT_LIMIT_MS
  && !(result.run.status === 'completed' && result.run.conclusion !== 'success' && result.run.sha === head)) {
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 15000));
  result = await check();
}
if (wait) console.log('');
report(result);
console.log(result.ok ? 'OK：手元の版が公開されています' : 'NG：手元の版はまだ公開されていません');
process.exitCode = result.ok ? 0 : 1;
