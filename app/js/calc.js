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

// ---------------------------------------------------------------------------
// 素点から pt（段階2。仕様書 6.1.1〜6.4）
// ---------------------------------------------------------------------------
//
// 計算用のルールの形（normalizeRule で作る）
//   start   … 持ち点（25000）
//   ret     … 返し（30000）
//   uma     … 1〜4 着のウマ（pt10 の配列。10-20 なら [200, 100, -100, -200]）
//   umaOka  … false ならウマ・オカなし。返しは持ち点と同じとみなし、素点の差だけで pt にする
//   rounding … 'none'（丸めない）／'round4'（四捨五入）／'round5'（五捨六入）／'floor'（切り捨て）／'ceil'（切り上げ）
//   tieBreak … 同点のとき 'seat'（上家優先）／'split'（ウマ・オカを等分。Mリーグ方式）

export const TIE_BREAK_LABELS = {
  seat: '上家優先',
  split: '等分',
};

export const ROUNDING_LABELS = {
  none: '丸めなし',
  round4: '四捨五入',
  round5: '五捨六入',
  floor: '切り捨て',
  ceil: '切り上げ',
};

// 100 点単位の素点 h（34 なら 3,400 点）の百の位を丸め、1,000 点単位にする。
// 丸めは素点そのものの百の位に対して行う（返しとの差ではない。仕様書 6.3）。
// マイナス（飛び）は絶対値で丸めて符号を戻す（仮決定）：−3,400 → −3,000、−3,600 → −4,000
function roundHundreds(h, mode) {
  if (mode === 'none' || !ROUNDING_LABELS[mode]) return h;
  const abs = Math.abs(h);
  const digit = abs % 10;          // 百の位
  const base = abs - digit;        // 千点単位に切り捨てた値
  const up = (mode === 'round4' && digit >= 5)
    || (mode === 'round5' && digit >= 6)
    || (mode === 'ceil' && digit > 0);
  const rounded = up ? base + 10 : base;
  return h < 0 ? -rounded : rounded;
}

// 素点（点）を丸める。表示とテスト用
export function roundScore(score, mode) {
  return roundHundreds(Math.round(score / 100), mode) * 100;
}

// 4 人の素点（点。席順＝起家から）を pt10 にする。戻り値も席順
//   1. 着順：素点の高い順。同点は上家（席の番号が小さい人）が上位
//   2. 各自：丸めた素点 − 返し（千点で割る）＋ ウマ
//   3. オカと丸めのずれ（合計を 0 にする残り）はトップが受け取る。合計は必ず 0 になる
// 内部は 100 点単位の整数で計算する。(素点 − 返し) ÷ 1,000 を ×10 した pt10 は「100 点単位の差」と同じ
//
// 同点を「等分」にしたとき（Mリーグ方式）：同点の人たちが占める順位のウマを合計して人数で割る。
// トップが同点なら、オカと丸めのずれも同点の人たちで分ける。
// 0.1pt 未満の端数は起家に近い人から 0.1pt ずつ配る。着順の記録は上家優先のまま（統計で着順を 1 つに決めるため）
export function scoreToPt(scores, rule) {
  const hs = scores.map((s) => Math.round(s / 100));
  const order = hs
    .map((h, seat) => ({ h, seat }))
    .sort((a, b) => b.h - a.h || a.seat - b.seat);
  const ranks = new Array(scores.length);
  order.forEach(({ seat }, i) => { ranks[seat] = i + 1; });

  const split = rule.tieBreak === 'split';
  const baseH = (rule.umaOka ? rule.ret : rule.start) / 100;
  // 同点の人のまとまり（着順の並びでの位置）。上家優先なら 1 人ずつ
  const groups = [];
  order.forEach(({ h }, i) => {
    const last = groups[groups.length - 1];
    if (split && last && order[last[0]].h === h) last.push(i);
    else groups.push([i]);
  });

  const uma = rule.umaOka ? rule.uma : [0, 0, 0, 0];
  const sorted = order.map(({ h }) => roundHundreds(h, rule.rounding) - baseH);
  for (const g of groups) {
    const shares = splitAmong(sum(g.map((i) => uma[i])), g.length);
    g.forEach((i, k) => { sorted[i] += shares[k]; });
  }
  const rest = splitAmong(-sum(sorted), groups[0].length);
  groups[0].forEach((i, k) => { sorted[i] += rest[k]; });

  const pts10 = new Array(scores.length);
  order.forEach(({ seat }, i) => { pts10[seat] = sorted[i] || 0; }); // -0 にしない
  return { ranks, pts10 };
}

// 整数 total を n 人で分ける。割り切れない分は前の人（起家に近い人）から 1 ずつ多くする
function splitAmong(total, n) {
  const each = Math.floor(total / n);
  const extra = total - each * n;
  return Array.from({ length: n }, (_, k) => each + (k < extra ? 1 : 0));
}

// ウマの入力を pt10 の配列にする。読めなければ null
//   "10-20" … 2・3 着が ±10、1・4 着が ±20
//   "20,10,-10,-20" … 1〜4 着を直接。合計が 0 でなければ不可
export function parseUma(input) {
  const s = String(input ?? '').trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－‐]/g, '-');
  const pair = /^(\d+(?:\.\d)?)\s*[-ー〜~]\s*(\d+(?:\.\d)?)$/.exec(s);
  if (pair) {
    const small = parsePt(pair[1]);
    const large = parsePt(pair[2]);
    return [large, small, -small, -large];
  }
  const values = s.split(/[,、，\s]+/).filter(Boolean).map(parsePt);
  if (values.length !== 4 || values.some((v) => v == null) || sum(values) !== 0) return null;
  return values;
}

// ウマを短く表す。上下対称なら "10-20"、そうでなければ "30/10/-5/-35"
export function umaLabel(uma) {
  const f = (v) => formatPt(v).replace('+', '');
  const symmetric = uma[0] === -uma[3] && uma[1] === -uma[2] && uma[0] >= uma[1] && uma[1] >= 0;
  return symmetric ? `${f(uma[1])}-${f(uma[0])}` : uma.map(f).join('/');
}

// 設定を 1 行で表す（対局作成画面と入力表の見出し用）
// 例："25,000 持ち 30,000 返し・ウマ 10-20・丸めなし"
export function describeRule(rule) {
  const n = (v) => v.toLocaleString('ja-JP');
  const umaPart = rule.umaOka ? ` ${n(rule.ret)} 返し・ウマ ${umaLabel(rule.uma)}` : '・ウマオカなし';
  const tiePart = rule.umaOka && rule.tieBreak === 'split' ? '・同点は等分' : '';
  return `${n(rule.start)} 持ち${umaPart}・${ROUNDING_LABELS[rule.rounding] || ROUNDING_LABELS.none}${tiePart}`;
}

// シートの rules 行や対局の rule_snapshot（列名はシートと同じ）を計算用の形にする
export function normalizeRule(row) {
  const flag = row.uma_oka;
  const umaOka = flag === undefined || flag === null || flag === '' ? true : flag === true || String(flag).toUpperCase() === 'TRUE';
  return {
    start: Number(row.start_points) || 25000,
    ret: Number(row.return_points) || 30000,
    uma: (umaOka && parseUma(row.uma)) || [0, 0, 0, 0],
    umaOka,
    rounding: ROUNDING_LABELS[row.rounding] ? row.rounding : 'none',
    tieBreak: row.tie_break === 'split' ? 'split' : 'seat',
  };
}
