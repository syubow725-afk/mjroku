// 麻雀録 段階0：起動確認と GAS 接続テストだけを行う最小構成
'use strict';

// sw.js の CACHE_VERSION と揃えて上げる
const APP_VERSION = '0.0.2';
const STORAGE_KEY_GAS_URL = 'mjroku.gasUrl';
const STORAGE_KEY_PASSCODE = 'mjroku.passcode';

// localStorage は private モード等で例外を投げることがあるため包む
function loadSetting(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 保存できなくても接続テストは続ける */ }
}

// ホーム画面から起動したか（iOS は navigator.standalone、他は display-mode で判定）
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

// GAS の doGet に action=ping を投げ、{ ok: true, ... } が返れば疎通成功
async function pingGas(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', 'ping');
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// GAS の doPost に JSON を送る。body を文字列で渡すと Content-Type は text/plain になり、
// ブラウザの事前確認（CORS preflight）が飛ばないので GAS でも受けられる
async function postGas(baseUrl, body) {
  const res = await fetch(baseUrl, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function init() {
  document.getElementById('version').textContent = APP_VERSION;
  document.getElementById('display-mode').textContent =
    isStandalone() ? 'ホーム画面から起動' : 'ブラウザで表示';

  const urlInput = document.getElementById('gas-url');
  const button = document.getElementById('ping');
  const result = document.getElementById('ping-result');
  urlInput.value = loadSetting(STORAGE_KEY_GAS_URL);

  button.addEventListener('click', async () => {
    const value = urlInput.value.trim();
    result.className = 'result';
    if (!value) {
      result.textContent = 'URL を入力してください';
      return;
    }
    saveSetting(STORAGE_KEY_GAS_URL, value);
    button.disabled = true;
    result.textContent = '接続中…';
    try {
      const data = await pingGas(value);
      if (!data.ok) throw new Error(data.error || '応答が不正です');
      result.classList.add('ok');
      result.textContent = `接続 OK：「${data.spreadsheet}」（${data.time}）`;
    } catch (err) {
      result.classList.add('ng');
      result.textContent = `接続できません：${err.message}`;
    } finally {
      button.disabled = false;
    }
  });

  const passInput = document.getElementById('passcode');
  const loadButton = document.getElementById('load');
  const loadResult = document.getElementById('load-result');
  passInput.value = loadSetting(STORAGE_KEY_PASSCODE);

  loadButton.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    const passcode = passInput.value.trim();
    loadResult.className = 'result';
    if (!url || !passcode) {
      loadResult.textContent = 'URL と合言葉を入力してください';
      return;
    }
    saveSetting(STORAGE_KEY_GAS_URL, url);
    saveSetting(STORAGE_KEY_PASSCODE, passcode);
    loadButton.disabled = true;
    loadResult.textContent = '読み込み中…';
    try {
      const data = await postGas(url, { action: 'load', passcode });
      if (!data.ok) throw new Error(data.error === 'bad_passcode' ? '合言葉が違います' : data.error);
      const d = data.data;
      loadResult.classList.add('ok');
      loadResult.textContent =
        `OK：「${data.group.name}」メンバー ${d.members.length} 人・対局 ${d.sessions.length} 件・ルール ${d.rules.length} 件`;
    } catch (err) {
      loadResult.classList.add('ng');
      loadResult.textContent = `読み込めません：${err.message}`;
    } finally {
      loadButton.disabled = false;
    }
  });

  registerServiceWorker();
}

async function registerServiceWorker() {
  const status = document.getElementById('sw-status');
  if (!('serviceWorker' in navigator)) {
    status.textContent = '非対応の端末';
    return;
  }
  try {
    await navigator.serviceWorker.register('sw.js');
    status.textContent = '有効';
  } catch (err) {
    status.textContent = `登録失敗：${err.message}`;
  }
}

init();
