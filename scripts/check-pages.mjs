// 公開を確かめる：npm run check:pages（公開を待つなら npm run check:pages -- --wait）
//
// 1. Cloudflare Pages（本番。https://mjroku.pages.dev/）
//    公開中の sw.js の版が、手元の最新コミットの app/sw.js の版と同じか。接続先の site.json が公開されているか
//    （Cloudflare の公開の記録はログインが要るので見ない。版が変われば公開が済んだとみなす）
// 2. GitHub Pages（移行が済むまでの旧公開先。.github/workflows/pages.yml がある間だけ見る）
//    GitHub Actions の最新の公開（pages.yml）が成功したか（公開 API。ログイン不要、1 時間 60 回まで）と、公開中の sw.js の版
// GitHub のリポジトリと Pages の URL は git remote から求める（ソースに個人名を直書きしない）
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SITE_URL = process.env.MJROKU_SITE_URL || 'https://mjroku.pages.dev/';
const wait = process.argv.includes('--wait');
const WAIT_LIMIT_MS = 5 * 60 * 1000;
const withGithub = existsSync('.github/workflows/pages.yml');

const versionOf = (text) => /CACHE_VERSION = '([^']+)'/.exec(text)?.[1] || '?';
// 比べるのはコミット済みの版（push したもの）。作業中でまだコミットしていない変更は見ない
const localVersion = versionOf(execSync('git show HEAD:app/sw.js', { encoding: 'utf8' }));
// GitHub Pages の公開（pages.yml）は app/ が変わったときだけ動くので、app/ を最後に変えたコミットと比べる
const head = execSync('git log -1 --format=%H -- app', { encoding: 'utf8' }).trim();

async function liveVersion(base) {
  // ?t= で途中のキャッシュを避ける
  try {
    const res = await fetch(`${base}sw.js?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? versionOf(await res.text()) : `取得できません（${res.status}）`;
  } catch (err) {
    return `取得できません（${err.message}）`;
  }
}

// site.json があり、接続先が入っているか（URL そのものは表示しない）
async function siteConfig(base) {
  try {
    const res = await fetch(`${base}site.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return `なし（${res.status}）`;
    const { gasUrl } = await res.json();
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl || '') ? 'あり' : '形が違う';
  } catch (err) {
    return `読めません（${err.message}）`;
  }
}

async function checkCloudflare() {
  const [live, site] = await Promise.all([liveVersion(SITE_URL), siteConfig(SITE_URL)]);
  return { live, site, ok: live === localVersion && site === 'あり' };
}

function githubRepo() {
  const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  const [, owner, repo] = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remote) || [];
  if (!owner) throw new Error(`GitHub のリポジトリが分かりません: ${remote}`);
  return { owner, repo, pagesUrl: `https://${owner}.github.io/${repo}/` };
}

async function checkGithub() {
  const { owner, repo, pagesUrl } = githubRepo();
  const latestRun = async () => {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/pages.yml/runs?per_page=1`,
      { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return { error: `GitHub API ${res.status}` };
    const run = (await res.json()).workflow_runs?.[0];
    return run ? { status: run.status, conclusion: run.conclusion, sha: run.head_sha, url: run.html_url } : { error: '公開の記録がありません' };
  };
  const [run, live] = await Promise.all([latestRun(), liveVersion(pagesUrl)]);
  return { run, live, ok: !run.error && run.conclusion === 'success' && run.sha === head && live === localVersion };
}

async function check() {
  const [cf, gh] = await Promise.all([checkCloudflare(), withGithub ? checkGithub() : null]);
  return { cf, gh, ok: cf.ok && (!gh || gh.ok) };
}

const v = (version) => (/^\d/.test(version) ? `v${version}` : version);

function report({ cf, gh }) {
  console.log(`手元       : v${localVersion}（app/ の最新コミット ${head.slice(0, 7)}）`);
  console.log(`Cloudflare : 公開中 ${v(cf.live)}・接続先（site.json）${cf.site}  ${SITE_URL}`);
  if (!gh) return;
  const { run } = gh;
  let state;
  if (run.error) state = run.error;
  else {
    const s = run.status !== 'completed' ? `実行中（${run.status}）` : run.conclusion === 'success' ? '成功' : `失敗（${run.conclusion}）`;
    state = `${s}・${run.sha === head ? 'app/ の最新コミットと同じ' : `別のコミット ${run.sha.slice(0, 7)}（公開待ち）`}`;
  }
  console.log(`GitHub     : 公開中 ${v(gh.live)}・公開処理 ${state}（旧公開先。全員が移ったら止める）`);
  if (run.conclusion && run.conclusion !== 'success') console.log(`             ${run.url}`);
}

// GitHub の公開が最新のコミットで失敗したら、待っても変わらないのでやめる
const githubFailed = ({ gh }) => gh && gh.run.status === 'completed' && gh.run.conclusion !== 'success' && gh.run.sha === head;

const started = Date.now();
let result = await check();
while (wait && !result.ok && Date.now() - started < WAIT_LIMIT_MS && !githubFailed(result)) {
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 15000));
  result = await check();
}
if (wait) console.log('');
report(result);
console.log(result.ok ? 'OK：手元の版が公開されています' : 'NG：手元の版はまだ公開されていません');
process.exitCode = result.ok ? 0 : 1;
