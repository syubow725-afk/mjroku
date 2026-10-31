// 端末ごとの設定（GAS の URL、合言葉、自分の名前）。ソースには書かず、初回に入力させて端末に保存する。
// localStorage は private モード等で例外を投げることがあるため包む

const KEYS = {
  gasUrl: 'mjroku.gasUrl',
  passcode: 'mjroku.passcode',
  myName: 'mjroku.myName',
};

export function getConfig() {
  const out = {};
  for (const [name, key] of Object.entries(KEYS)) {
    try { out[name] = localStorage.getItem(key) || ''; } catch { out[name] = ''; }
  }
  return out;
}

export function setConfig(values) {
  for (const [name, value] of Object.entries(values)) {
    if (!KEYS[name]) continue;
    try { localStorage.setItem(KEYS[name], value); } catch { /* 保存できない端末では今回限り */ }
  }
}

export function isConfigured(config = getConfig()) {
  return Boolean(config.gasUrl && config.passcode);
}
