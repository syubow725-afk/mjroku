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
    if (err.name === 'AbortError') throw new Error('時間切れ（電波を確認）');
    if (err instanceof TypeError) throw new Error('通信できません（電波を確認）');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// body を文字列で渡すと Content-Type は text/plain になり、
// ブラウザの事前確認（CORS preflight）が飛ばないので GAS でも受けられる
async function post(config, body) {
  const data = await request(config.gasUrl, {
    method: 'POST',
    body: JSON.stringify({ ...body, passcode: config.passcode }),
  });
  if (!data.ok) throw new Error(data.error === 'bad_passcode' ? '合言葉が違います' : data.error);
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
