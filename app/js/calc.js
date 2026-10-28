// 麻雀録 計算ロジック（純粋関数のみ。画面や通信には触らない）
//
// 単位の約束（浮動小数の誤差を出さないため、内部はすべて整数で持つ）
//   pt   … ×10 の整数（pt10）。+55 → 550、-26.6 → -266。1pt＝1,000 点なので 100 点単位と同じ
//   金額 … P の整数
//   チップ … 枚数の整数

// ---------------------------------------------------------------------------
// pt の入力と表示
// ---------------------------------------------------------------------------

// 利用者の入力（"+20"、"-32"、"−26.6"、全角数字など）を pt10 に変換する。
// 小数は第 1 位まで。読めないときは null。
// Number() で掛け算すると 26.6 × 10 ＝ 266.00000000000003 のような誤差が出るため、
// 整数部と小数部を文字列のまま分けて組み立てる。
export function parsePt(input) {
  if (input == null) return null;
  const s = String(input)
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－ー‐]/g, '-')
    .replace(/[＋]/g, '+')
    .replace(/[．]/g, '.');
  const m = /^([+-]?)(\d+)(?:\.(\d))?$/.exec(s);
  if (!m) return null;
  const abs = Number(m[2]) * 10 + Number(m[3] || 0);
  return m[1] === '-' ? -abs : abs;
}

// pt10 を表示用の文字列にする。正は "+" を付け、小数第 1 位が 0 なら省く。
// 例：550 → "+55"、-266 → "-26.6"、0 → "0"
export function formatPt(pt10) {
  if (pt10 === 0) return '0';
  const sign = pt10 > 0 ? '+' : '-';
  const abs = Math.abs(pt10);
  const int = Math.floor(abs / 10);
  const dec = abs % 10;
  return dec === 0 ? `${sign}${int}` : `${sign}${int}.${dec}`;
}

// ---------------------------------------------------------------------------
// 合計と補完
// ---------------------------------------------------------------------------

export function sum(values) {
  return values.reduce((acc, v) => acc + v, 0);
}

// 1 つだけ空（null）の欄を、全体の合計が total になるよう埋める。
// pt なら total＝0、チップなら total＝0、素点（段階2）なら total＝100,000。
// 空がちょうど 1 つでなければ補完できないので null を返す（空が 0 個なら写しを返す）。
export function fillMissing(values, total = 0) {
  const missing = values.filter((v) => v == null).length;
  if (missing === 0) return [...values];
  if (missing !== 1) return null;
  const known = sum(values.filter((v) => v != null));
  return values.map((v) => (v == null ? total - known : v));
}

// ---------------------------------------------------------------------------
// 着順（pt 入力のとき）
// ---------------------------------------------------------------------------

// pt の高い順に 1, 2, 3… を振る。同 pt は配列で前にいる人（＝入力表の列順が前）を上位とする。
// 戻り値は入力と同じ並びの着順配列。例：[100, 550, -180, -470] → [2, 1, 3, 4]
export function rankByPt(pts10) {
  const order = pts10
    .map((pt, index) => ({ pt, index }))
    .sort((a, b) => b.pt - a.pt || a.index - b.index);
  const ranks = new Array(pts10.length);
  order.forEach(({ index }, i) => { ranks[index] = i + 1; });
  return ranks;
}

// ---------------------------------------------------------------------------
// ゲーム代（仕様書 7.2）
// ---------------------------------------------------------------------------

// total を n 人で均等割りする。10P 単位に切り捨て、余りは先頭の人に寄せる（本家の挙動）。
// 例：4,450 ÷ 4 → 1,110 ずつだと 4,440 で 10 余る → [1120, 1110, 1110, 1110]
export function splitEvenly(total, n) {
  if (n <= 0) return [];
  const base = Math.floor(total / (n * 10)) * 10;
  const shares = new Array(n).fill(base);
  shares[0] += total - base * n;
  return shares;
}

// 参加者ごとの負担額を決める。shares の各要素は手入力の額か null（＝自動）。
// 手入力分を総額から引き、残りを自動の人で splitEvenly する（余りは自動の人の先頭へ）。
// 例：総額 9,000、[3000, null, null, null] → [3000, 2000, 2000, 2000]
export function allocateFees(total, shares) {
  const autoCount = shares.filter((v) => v == null).length;
  const manualSum = sum(shares.filter((v) => v != null));
  const auto = splitEvenly(total - manualSum, autoCount);
  let next = 0;
  return shares.map((v) => (v == null ? auto[next++] : v));
}

// ---------------------------------------------------------------------------
// 精算（仕様書 7.1）
// ---------------------------------------------------------------------------

// 0.5 を 0 から遠い側に丸める（-12.5 → -13）。Math.round は -12.5 を -12 にするため使わない。
function roundHalfAwayFromZero(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

// pt10 を金額にする。レートは P／千点（＝P／pt）なので pt10 × レート ÷ 10。
// レート 50 なら小数 pt でも必ず割り切れる。割り切れないレートのときだけ 1P 単位に丸める。
export function ptToMoney(pt10, rate) {
  return roundHalfAwayFromZero((pt10 * rate) / 10);
}

// 1 人分の精算。
//   収支（小計）＝ pt 合計 × レート ＋ チップ枚数 × チップレート
//   収支 ＝ 収支（小計）− ゲーム代負担額
export function settle({ pt10, chips, rate, chipRate, fee }) {
  const ptMoney = ptToMoney(pt10, rate);
  const chipMoney = chips * chipRate;
  const subtotal = ptMoney + chipMoney;
  return { ptMoney, chipMoney, subtotal, balance: subtotal - fee };
}

// ---------------------------------------------------------------------------
// 対局 1 日分の集計
// ---------------------------------------------------------------------------

// 入力（アプリ内部の形。シートの行からの変換は呼び出し側で行う）
//   session      { rate, chipRate, gameFee }
//   participants [{ memberId, chips, feeShare }]  … 入力表の列順。feeShare は null で自動
//   hanchans     [{ results: [{ memberId, pt10, rank }] }]  … 抜け番の人は results にいない
// 出力：participants と同じ並びで 1 人 1 件
//   { memberId, games, pt10, rankCounts: [1着, 2着, 3着, 4着], chips, fee, ptMoney, chipMoney, subtotal, balance }
export function summarizeSession({ session, participants, hanchans }) {
  const fees = allocateFees(session.gameFee, participants.map((p) => p.feeShare ?? null));

  return participants.map((p, i) => {
    let games = 0;
    let pt10 = 0;
    const rankCounts = [0, 0, 0, 0];
    for (const h of hanchans) {
      const r = h.results.find((x) => x.memberId === p.memberId);
      if (!r) continue; // 抜け番
      games += 1;
      pt10 += r.pt10;
      rankCounts[r.rank - 1] += 1;
    }
    const chips = p.chips ?? 0;
    const money = settle({ pt10, chips, rate: session.rate, chipRate: session.chipRate, fee: fees[i] });
    return { memberId: p.memberId, games, pt10, rankCounts, chips, fee: fees[i], ...money };
  });
}
