// GAS ウェブアプリとの通信。API の中身は docs/02_データ設計.md の 4 章

const TIMEOUT_MS = 20000; // 電波が弱い場所で待ち続けないよう打ち切る

async function request(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('GAS の応答を読めません（URL かデプロイ設定を確認）');
    }
  } catch (err) {
    // 通信そのものの失敗には network を付ける（GAS が断ったときと分けるため。store.js の同期で使う）
    const network = (message) => Object.assign(new Error(message), { network: true });
    if (err.name === 'AbortError') throw network('時間切れ（電波を確認）');
    if (err instanceof TypeError) throw network('通信できません（電波を確認）');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// body を文字列で渡すと Content-Type は text/plain になり、
// ブラウザの事前確認（CORS preflight）が飛ばないので GAS でも受けられる。
// group_id は表示中のグループ。管理者の合言葉ではこれで開くグループが決まり、メンバーの合言葉では GAS が無視する
async function post(config, body) {
  const data = await request(config.gasUrl, {
    method: 'POST',
    body: JSON.stringify({ group_id: config.groupId || undefined, ...body, passcode: config.passcode }),
  });
  if (!data.ok) {
    if (data.error === 'bad_passcode') throw new Error('合言葉が違います');
    if (data.error === 'forbidden') throw new Error('管理者の合言葉が必要です');
    throw new Error(data.error);
  }
  return data;
}

export async function ping(gasUrl) {
  const url = new URL(gasUrl);
  url.searchParams.set('action', 'ping');
  const data = await request(url, { method: 'GET' });
  if (!data.ok) throw new Error(data.error || '応答が不正です');
  return data;
}

export function load(config) {
  return post(config, { action: 'load' });
}

// records: { シート名: [行, …] }
export function save(config, records) {
  return post(config, { action: 'save', records });
}

// グループの追加（id なし）と名前・設定の変更（管理者だけ）。group：{ id?, name, min_games }
export function saveGroup(config, group) {
  return post(config, { action: 'save_group', group });
}

// グループの合言葉の設定（管理者だけ）
export function setGroupPasscode(config, groupId, newPasscode) {
  return post(config, { action: 'set_group_passcode', group_id: groupId, new_passcode: newPasscode });
}
