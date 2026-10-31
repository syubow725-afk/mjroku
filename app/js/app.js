// 麻雀録 アプリの入口：画面の切り替え（#/… のハッシュで決める）と同期のきっかけづくり
import { Store } from './store.js';
import * as api from './api.js';
import { getConfig, isConfigured } from './config.js';
import { h } from './util.js';
import { sessionsView, sessionFormView, summaryView } from './views/sessions.js';
import { sessionView, hanchanView, chipsView, shareView } from './views/session.js';
import { membersView } from './views/members.js';
import { settingsView } from './views/settings.js';
import { rulesView, ruleEditView } from './views/rules.js';
import { homeView } from './views/home.js';
import { rankingView } from './views/ranking.js';

// sw.js の CACHE_VERSION と揃えて上げる
const APP_VERSION = '0.4.5';

const store = new Store({ api, getConfig });

const ctx = {
  store,
  version: APP_VERSION,
  go: (hash) => { location.hash = hash; },
  // フォームの保存後など、戻るでフォームに戻らないよう履歴を置き換える
  replace: (hash) => { location.replace(hash); },
  refresh: () => render(),
  notFound: () => ({
    title: '見つかりません',
    back: '#/sessions',
    live: true,
    body: h('p', { class: 'empty' }, '削除されたか、まだ同期されていません。'),
  }),
};

// [ハッシュの形, 画面, 下のタブ]
const routes = [
  [/^#\/home$/, () => homeView(ctx), 'home'],
  [/^#\/ranking$/, () => rankingView(ctx), 'ranking'],
  [/^#\/sessions\/new$/, () => sessionFormView(ctx, null), 'sessions'],
  [/^#\/session\/([^/]+)\/edit$/, (m) => sessionFormView(ctx, m[1]), 'sessions'],
  [/^#\/session\/([^/]+)\/hanchan\/([^/]+)$/, (m) => hanchanView(ctx, m[1], m[2]), 'sessions'],
  [/^#\/session\/([^/]+)\/chips$/, (m) => chipsView(ctx, m[1]), 'sessions'],
  [/^#\/session\/([^/]+)\/share$/, (m) => shareView(ctx, m[1]), 'sessions'],
  [/^#\/summary$/, () => summaryView(ctx), 'sessions'],
  [/^#\/session\/([^/]+)$/, (m) => sessionView(ctx, m[1]), 'sessions'],
  [/^#\/members$/, () => membersView(ctx), 'members'],
  [/^#\/settings$/, () => settingsView(ctx), 'settings'],
  [/^#\/rules$/, () => rulesView(ctx), 'settings'],
  [/^#\/rule\/([^/]+)$/, (m) => ruleEditView(ctx, m[1]), 'settings'],
  [/^/, () => sessionsView(ctx), 'sessions'],
];

const main = document.getElementById('main');
const titleEl = document.getElementById('title');
const backEl = document.getElementById('back');
const syncEl = document.getElementById('sync-status');

// 画面は { title, body, back?, live?, update? } を返す。
//   live   … データが変わったら作り直して良い画面（入力欄のない一覧など）
//   update … 作り直さずに一部だけ最新にする関数（入力中の内容を消さないため）
let current = null;

// onlyIfChanged：作り直した結果が今の画面と同じなら差し替えない（タップ中のボタンを消さないため）
function render({ onlyIfChanged = false } = {}) {
  const hash = location.hash || '#/sessions';
  for (const [pattern, view, tab] of routes) {
    const m = hash.match(pattern);
    if (!m) continue;
    const next = view(m);
    if (onlyIfChanged && current && next.body.outerHTML === current.body.outerHTML) break;
    current = next;
    main.replaceChildren(current.body);
    titleEl.textContent = current.title;
    backEl.hidden = !current.back;
    backEl.onclick = () => ctx.go(current.back);
    for (const a of document.querySelectorAll('.tabbar a')) a.classList.toggle('active', a.dataset.tab === tab);
    break;
  }
  renderSyncStatus();
}

function renderSyncStatus() {
  const pending = store.pendingCount();
  // 帯が緑なので、正常時は色を付けず、問題があるときだけ赤くする
  let text = '同期済';
  let cls = '';
  if (!isConfigured()) [text, cls] = ['未設定', 'ng'];
  else if (store.syncing) [text, cls] = ['同期中…', ''];
  else if (pending > 0) [text, cls] = [`送信待ち ${pending}`, store.error ? 'ng' : ''];
  else if (store.error) [text, cls] = ['同期エラー', 'ng'];
  syncEl.textContent = text;
  syncEl.className = `sync ${cls}`;
}

store.subscribe((kind) => {
  if (kind === 'data' && current?.live) {
    render({ onlyIfChanged: true });
  } else {
    current?.update?.();
    renderSyncStatus();
  }
});

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// 同期のきっかけ：起動時、電波の復帰、アプリに戻ったとき、送信待ちがある間の定期再送
window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.sync();
});
setInterval(() => {
  if (store.pendingCount() > 0) store.sync();
}, 60000);

if (!isConfigured() && !location.hash) location.hash = '#/settings';
render();
store.sync();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 登録できなくてもオンラインでは動く */ });
}
