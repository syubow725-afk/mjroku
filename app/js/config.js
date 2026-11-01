// 端末ごとの設定（GAS の URL、合言葉、自分の名前）。ソースには書かず、初回に入力させて端末に保存する。
// localStorage は private モード等で例外を投げることがあるため包む
//
// 合言葉は端末にいくつでも持てる（グループごとの合言葉、管理者の合言葉）。
//   passcode・groupId … いま表示しているグループと、それを開く合言葉。GAS にはこの 2 つを送る
//   合言葉の一覧（getKeys）… 端末が持つ合言葉と、それぞれで開けるグループ。グループの切り替えに使う

const KEYS = {
  gasUrl: 'mjroku.gasUrl',
  passcode: 'mjroku.passcode',
  groupId: 'mjroku.groupId',
  myName: 'mjroku.myName',
};

const KEYRING = 'mjroku.keys';

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

// 配布元が決めた接続先（Cloudflare Pages の公開のときに scripts/build-site.mjs が site.json に書く）。
// あれば GAS の URL として保存し、利用者には入れさせない。なければ（GitHub Pages・手元）今までどおり設定画面で入れる。
// 電波がないときは Service Worker が前に読んだ site.json を返す。それもなければ保存済みの URL のまま使う
const SITE_KEY = 'mjroku.gasUrlFromSite';

export async function loadSiteConfig({ timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('site.json', { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) return;
    const { gasUrl } = await res.json();
    if (typeof gasUrl !== 'string' || !/^https?:\/\//.test(gasUrl)) return;
    setConfig({ gasUrl });
    try { localStorage.setItem(SITE_KEY, '1'); } catch { /* 保存できない端末では今回限り */ }
  } catch { /* 読めなければ保存済みの設定のまま */ } finally {
    clearTimeout(timer);
  }
}

// 接続先が配布元で決まっているか（設定画面で URL の欄を出さない）
export function isSiteManaged() {
  try { return localStorage.getItem(SITE_KEY) === '1'; } catch { return false; }
}

export function isConfigured(config = getConfig()) {
  return Boolean(config.gasUrl && config.passcode);
}

// 端末が持つ合言葉の一覧。[{ passcode, role, groups: [{ id, name }] }]
//   groups はその合言葉で開けるグループ（メンバーの合言葉は 1 つ、管理者の合言葉は全グループ）。接続できるたびに書き直す
export function getKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEYRING) || 'null');
    if (Array.isArray(saved)) return saved;
  } catch { /* 読めなければ下で作り直す */ }
  // v0.6.0 までの端末は合言葉が 1 つだけ。開けるグループは次の接続で分かる
  const { passcode } = getConfig();
  return passcode ? [{ passcode, role: 'member', groups: [] }] : [];
}

export function setKeys(keys) {
  try { localStorage.setItem(KEYRING, JSON.stringify(keys)); } catch { /* 保存できない端末では今回限り */ }
}

// load の応答から、合言葉の一覧に入れる 1 件を作る
export function keyEntry(passcode, res) {
  const role = res.role === 'admin' ? 'admin' : 'member';
  const groups = role === 'admin' && res.groups ? res.groups : [res.group];
  return { passcode, role, groups: groups.map(({ id, name }) => ({ id, name })) };
}

// 合言葉の一覧に 1 件を足す（同じ合言葉なら書き直す）。
// 合言葉はグループに 1 つ、管理者に 1 つなので、同じグループのメンバーの合言葉（または別の管理者の合言葉）が
// ほかにあれば、付け替える前の古い合言葉として外す
export function mergeKey(keys, entry) {
  const ids = new Set(entry.groups.map((g) => g.id));
  const stale = (k) => k.passcode !== entry.passcode && (entry.role === 'admin'
    ? k.role === 'admin'
    : k.role !== 'admin' && k.groups.some((g) => ids.has(g.id)));
  const out = keys.filter((k) => !stale(k));
  const i = out.findIndex((k) => k.passcode === entry.passcode);
  if (i >= 0) out[i] = entry;
  else out.push(entry);
  return out;
}

// 切り替えられるグループの一覧。[{ groupId, name, passcode, role }]
// 同じグループをメンバーと管理者の両方の合言葉で開けるときは、管理者の方を使う（できることが多いので）
export function groupChoices(keys) {
  const byId = new Map();
  for (const k of keys) {
    for (const g of k.groups || []) {
      const prev = byId.get(g.id);
      if (!prev || (k.role === 'admin' && prev.role !== 'admin')) {
        byId.set(g.id, { groupId: g.id, name: g.name, passcode: k.passcode, role: k.role });
      }
    }
  }
  return [...byId.values()];
}
