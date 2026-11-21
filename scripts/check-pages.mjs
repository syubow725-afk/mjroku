// 公開を確かめる：npm run check:pages（公開を待つなら npm run check:pages -- --wait）
//
// 公開先は Cloudflare Pages（https://mjroku.pages.dev/。GitHub Pages は v1.0.0 で止めた）。
// 公開中の sw.js の版が、手元の最新コミットの app/sw.js の版と同じで、接続先の site.json が公開されていて、
// site.json の commit（公開のもとになったコミット。scripts/build-site.mjs が書く）が手元の最新コミットなら OK。
// （Cloudflare の公開の記録はログインが要るので見ない。版が変わらない push でも、commit で公開が済んだか分かる）
// Cloudflare の Build watch paths で公開の対象を絞っている場合に備え、公開に関わるファイル（app/・scripts/・package*.json）を
// 最後に変えたコミットでも OK とする
import { execSync } from 'node:child_process';

const SITE_URL = process.env.MJROKU_SITE_URL || 'https://mjroku.pages.dev/';
const wait = process.argv.includes('--wait');
const WAIT_LIMIT_MS = 5 * 60 * 1000;

const versionOf = (text) => /CACHE_VERSION = '([^']+)'/.exec(text)?.[1] || '?';
// 比べるのはコミット済みの版（push したもの）。作業中でまだコミットしていない変更は見ない
const localVersion = versionOf(execSync('git show HEAD:app/sw.js', { encoding: 'utf8' }));
const git = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const head = git('git rev-parse HEAD');
const lastBuilt = git('git log -1 --format=%H -- app scripts package.json package-lock.json');

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
    if (!res.ok) return { site: `なし（${res.status}）`, commit: '' };
    const { gasUrl, commit = '' } = await res.json();
    return { site: /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(gasUrl || '') ? 'あり' : '形が違う', commit };
  } catch (err) {
    return { site: `読めません（${err.message}）`, commit: '' };
  }
}

async function checkCloudflare() {
  const [live, { site, commit }] = await Promise.all([liveVersion(SITE_URL), siteConfig(SITE_URL)]);
  return { live, site, commit, ok: live === localVersion && site === 'あり' && (commit === head || commit === lastBuilt) };
}

async function check() {
  const cf = await checkCloudflare();
  return { cf, ok: cf.ok };
}

const v = (version) => (/^\d/.test(version) ? `v${version}` : version);

function report({ cf }) {
  console.log(`手元       : v${localVersion}（最新コミット ${head.slice(0, 7)}）`);
  const from = !cf.commit ? '不明' : cf.commit === head ? `${cf.commit.slice(0, 7)}（最新と同じ）`
    : cf.commit === lastBuilt ? `${cf.commit.slice(0, 7)}（それより後のコミットは公開に関わらない）` : `${cf.commit.slice(0, 7)}（古い。公開待ちか失敗）`;
  console.log(`Cloudflare : 公開中 ${v(cf.live)}・接続先（site.json）${cf.site}・公開のもと ${from}  ${SITE_URL}`);
}

const started = Date.now();
let result = await check();
while (wait && !result.ok && Date.now() - started < WAIT_LIMIT_MS) {
  process.stdout.write('.');
  await new Promise((r) => setTimeout(r, 15000));
  result = await check();
}
if (wait) console.log('');
report(result);
console.log(result.ok ? 'OK：手元の版が公開されています' : 'NG：手元の版はまだ公開されていません');
process.exitCode = result.ok ? 0 : 1;
