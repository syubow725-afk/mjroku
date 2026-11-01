// Cloudflare Pages の公開のときに動かす（ビルドコマンド：node scripts/build-site.mjs、出力するフォルダ：app）。
// Cloudflare に登録した環境変数 GAS_URL を app/site.json に書き、アプリはそこから接続先を読む。
// こうすると利用者は GAS の URL を入れずに済み、URL はリポジトリにも残らない（CLAUDE.md の約束）。
// ただし site.json は公開されるファイルなので、URL を秘密にするものではない（データを守るのは合言葉）
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// GAS のウェブアプリ URL の形：https://script.google.com/macros/s/…/exec
export function checkGasUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url || '').trim());
}

export function buildSite(env = process.env, outDir = 'app') {
  const url = String(env.GAS_URL || '').trim();
  if (!checkGasUrl(url)) {
    // 接続先のない版を公開しないよう、公開を失敗させる。URL 自体はログに出さない
    throw new Error(url
      ? '環境変数 GAS_URL の形が違います（https://script.google.com/macros/s/…/exec）'
      : '環境変数 GAS_URL がありません（Cloudflare の Settings → Variables and Secrets で登録）');
  }
  writeFileSync(join(outDir, 'site.json'), `${JSON.stringify({ gasUrl: url })}\n`);
  return join(outDir, 'site.json');
}

// node scripts/build-site.mjs として動かしたときだけ書く（テストから読み込んだときは書かない）
if (process.argv[1]?.endsWith('build-site.mjs')) {
  try {
    console.log(`接続先を書きました：${buildSite()}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
