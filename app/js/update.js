// 新しい版の確認と更新。
//
// 確認：公開中の sw.js を（キャッシュを通さずに）読み、CACHE_VERSION が今動いている版（APP_VERSION）と違えば、
//       「新しい版があります」の帯を出す。起動時、アプリに戻ったとき、30 分ごとに確かめる。
//       iPhone のホーム画面のアプリは開き直さずに動き続けることが多く、Service Worker の更新だけに任せると
//       古い版のまま残ることがあるため（v0.4.1 で止まった件）。
// 更新：Service Worker の取り替えに頼らず、確実に切り替える。
//       1. 新しい sw.js に書かれたファイルを、HTTP キャッシュを通さずに全部取り直す（電波がなければここで中止）
//       2. Service Worker の登録とキャッシュを消す（登録の解除は 3 秒で見切る）
//       3. 読み込み直す（次の起動で新しい Service Worker が入り直す）

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

const versionOf = (text) => /CACHE_VERSION = '([^']+)'/.exec(text)?.[1] || null;

// sw.js の APP_SHELL に並んだファイル
function shellFiles(text) {
  const block = /APP_SHELL = \[([\s\S]*?)\]/.exec(text)?.[1] || '';
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

async function fetchSw() {
  const res = await fetch(`sw.js?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`sw.js ${res.status}`);
  return res.text();
}

// banner：帯の要素（#update-banner）、text：文言の要素、button：更新ボタン
export function setupUpdates({ version, banner, text, button }) {
  let latest = null;

  const show = (v) => {
    latest = v;
    text.textContent = `新しい版 v${v} があります（今は v${version}）`;
    button.disabled = false;
    button.textContent = '更新';
    banner.hidden = false;
  };

  // 新しい版があれば帯を出し、{ current, latest } を返す。確かめられなければ latest は null
  async function check() {
    try {
      navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
      const v = versionOf(await fetchSw());
      if (v && v !== version) show(v);
      return { current: version, latest: v };
    } catch {
      return { current: version, latest: null };
    }
  }

  async function apply() {
    button.disabled = true;
    button.textContent = '更新中…';
    try {
      const swText = await fetchSw();
      // 全部取り直せたときだけ先へ進む。途中で失敗したら今の版のまま使い続けられるようにする
      await Promise.all(shellFiles(swText).map(async (file) => {
        const res = await fetch(file, { cache: 'reload' });
        if (!res.ok) throw new Error(`${file} ${res.status}`);
      }));
      // 登録の解除は返ってこないことがあるので、3 秒で見切って先へ進む。
      // 解除できなくても、キャッシュを空にしてファイルも取り直してあるので、読み込み直せば新しい版になる
      const regs = await navigator.serviceWorker?.getRegistrations() || [];
      await Promise.race([Promise.all(regs.map((r) => r.unregister())), new Promise((r) => setTimeout(r, 3000))]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('mjroku-')).map((k) => caches.delete(k)));
      location.reload();
    } catch {
      alert('通信できないので更新できませんでした。電波のよいところでもう一度押してください。');
      if (latest) show(latest);
    }
  }

  button.addEventListener('click', apply);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  setInterval(check, CHECK_INTERVAL_MS);

  if ('serviceWorker' in navigator) {
    // sw.js 自体も HTTP キャッシュを通さずに確かめる
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* 登録できなくてもオンラインでは動く */ });
  }
  check();

  return { check };
}
