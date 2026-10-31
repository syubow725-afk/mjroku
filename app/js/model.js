// シートの行（store の表）と計算ロジック（calc.js）の橋渡し。画面には触らない純粋関数。
//
// シートの pt は人が読める値（55、-26.6）、計算は ×10 の整数（pt10）で行う（docs/02_データ設計.md 2.3）

import { rankByPt, summarizeSession, scoreToPt, normalizeRule, formatPt } from './calc.js';

export function toPt10(pt) {
  return pt == null || pt === '' ? null : Math.round(Number(pt) * 10);
}

export function fromPt10(pt10) {
  return pt10 / 10;
}

const alive = (row) => row && !row.deleted;

// メンバー名。削除済みのメンバーも過去の対局で表示するため deleted は見ない
export function memberName(tables, memberId) {
  return tables.members[memberId]?.name || '（不明）';
}

// 対局の参加者（入力表の列順）
export function sessionParticipants(tables, sessionId) {
  return Object.values(tables.participants)
    .filter((p) => alive(p) && p.session_id === sessionId)
    .sort((a, b) => a.col_order - b.col_order);
}

// 対局の半荘（回の順）。results は member_id → 成績行
export function sessionHanchans(tables, sessionId) {
  const hanchans = Object.values(tables.hanchans)
    .filter((h) => alive(h) && h.session_id === sessionId)
    .sort((a, b) => a.seq - b.seq || String(a.created_at).localeCompare(String(b.created_at)));
  const byHanchan = new Map(hanchans.map((h) => [h.id, {}]));
  for (const r of Object.values(tables.results)) {
    if (alive(r) && byHanchan.has(r.hanchan_id)) byHanchan.get(r.hanchan_id)[r.member_id] = r;
  }
  return hanchans.map((hanchan) => ({ hanchan, results: byHanchan.get(hanchan.id) }));
}

// 対局 1 日分を画面に出せる形にまとめる。summary は calc.summarizeSession の結果（参加者と同じ並び）
export function buildSession(tables, sessionId) {
  const session = tables.sessions[sessionId];
  if (!alive(session)) return null;
  const participants = sessionParticipants(tables, sessionId);
  const hanchans = sessionHanchans(tables, sessionId);
  const summary = summarizeSession({
    session: { rate: session.rate ?? 0, chipRate: session.chip_rate ?? 0, gameFee: session.game_fee ?? 0 },
    participants: participants.map((p) => ({ memberId: p.member_id, chips: p.chips ?? 0, feeShare: p.fee_share ?? null })),
    hanchans: hanchans.map(({ results }) => ({
      results: Object.values(results).map((r) => ({ memberId: r.member_id, pt10: toPt10(r.pt), rank: r.rank })),
    })),
  });
  return { session, participants, hanchans, summary };
}

// 対局の作成・編集で書く行を作る。
//   memberIds … 参加者（入力表の列順）
//   existing  … その対局の既存の参加者行（論理削除済みも含めて良い）
// 外れた参加者は論理削除、戻ってきた参加者は削除を取り消す
export function sessionChanges({ session, memberIds, existing = [] }) {
  const byMember = new Map(existing.map((p) => [p.member_id, p]));
  const participants = memberIds.map((memberId, i) => {
    const old = byMember.get(memberId);
    return old
      ? { id: old.id, col_order: i, deleted: false }
      : { id: `${session.id}:${memberId}`, session_id: session.id, member_id: memberId, col_order: i, chips: null, fee_share: null, deleted: false };
  });
  const keep = new Set(memberIds);
  for (const p of existing) {
    if (!keep.has(p.member_id) && !p.deleted) participants.push({ id: p.id, deleted: true });
  }
  return { sessions: [session], participants };
}

// pt 入力の半荘 1 回分で書く行を作る。
//   entries … 対局した人（入力表の列順）[{ memberId, pt10 }]。着順は pt の高い順、同 pt は列順が前の人が上
//   existingResults … 編集時の既存の成績行。今回対局しなかった人の行は論理削除する
//   inputMode … 'pt'（pt 直接入力）／'score'（素点入力。entries に seat・rawScore・rank も入れる）
export function hanchanChanges({ sessionId, hanchanId, seq, entries, existingResults = [], inputMode = 'pt' }) {
  // 素点入力では席順で決めた着順をそのまま使う。pt 入力では pt から決める
  const ranks = entries.every((e) => e.rank != null) ? entries.map((e) => e.rank) : rankByPt(entries.map((e) => e.pt10));
  const results = entries.map((e, i) => ({
    id: `${hanchanId}:${e.memberId}`,
    hanchan_id: hanchanId,
    member_id: e.memberId,
    seat: e.seat ?? null,
    raw_score: e.rawScore ?? null,
    pt: fromPt10(e.pt10),
    rank: ranks[i],
    deleted: false,
  }));
  const playing = new Set(entries.map((e) => e.memberId));
  for (const r of existingResults) {
    if (!playing.has(r.member_id) && !r.deleted) results.push({ id: r.id, deleted: true });
  }
  return {
    hanchans: [{ id: hanchanId, session_id: sessionId, seq, input_mode: inputMode, deleted: false }],
    results,
  };
}

// 素点入力の 4 人分から、pt と着順を付けた entries（hanchanChanges に渡す形）を作る。
//   players … [{ memberId, seat（0＝起家〜3）, score（点） }]（入力表の列順のままで良い）
// 計算は席順に並べて calc.scoreToPt で行う（同点は上家優先のため席順が要る）
export function scoreEntries(players, rule) {
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);
  const { ranks, pts10 } = scoreToPt(bySeat.map((p) => p.score), rule);
  const computed = new Map(bySeat.map((p, i) => [p.memberId, { pt10: pts10[i], rank: ranks[i] }]));
  return players.map((p) => ({ memberId: p.memberId, seat: p.seat, rawScore: p.score, ...computed.get(p.memberId) }));
}

// 対局のルールを変えたとき、素点で入れた半荘の pt・着順を新しいルールで計算し直す。
// 変わる成績行だけを返す（pt 入力の半荘はそのまま）
export function recomputeScoreResults(tables, sessionId, rule) {
  const changes = [];
  for (const { hanchan, results } of sessionHanchans(tables, sessionId)) {
    if (hanchan.input_mode !== 'score') continue;
    const rows = Object.values(results);
    if (rows.length !== 4 || rows.some((r) => r.raw_score == null || r.seat == null)) continue;
    const entries = scoreEntries(rows.map((r) => ({ memberId: r.member_id, seat: r.seat, score: r.raw_score })), rule);
    entries.forEach((e, i) => {
      const pt = fromPt10(e.pt10);
      if (rows[i].pt !== pt || rows[i].rank !== e.rank) changes.push({ id: rows[i].id, pt, rank: e.rank });
    });
  }
  return changes;
}

// 対局の絞り込み。from／to は "2026-01-01" 形式で両端を含む。空なら制限なし。rule は rule_name
export function filterSessions(sessions, { from = '', to = '', rule = '' } = {}) {
  return sessions.filter((s) => (!from || s.date >= from) && (!to || s.date <= to) && (!rule || s.rule_name === rule));
}

// 複数の対局をメンバーごとに合算する（本家の「全件集計」「合算集計」、ホーム、ランキングで使う）。
// 戻り値は収支（ゲーム代込）の高い順。率は半荘がなければ null
//   sessions … 参加した対局の数（日数）／games … 打った半荘の数（5 人以上の対局の抜け番は数えない）
//   pt10 … 総スコア／chips … 総チップ（枚）／subtotal … 収支（ゲーム代別）／balance … 収支（ゲーム代込）
//   rankRates … 1〜4 着の率／topRate … トップ率／rentaiRate … 連対率（1・2 着）／lastAvoidRate … ラス回避率
//   scoredGames … 素点が分かる半荘の数／tobi … そのうち素点がマイナスだった回数／tobiRate … 飛び率
//     pt で入れた半荘は素点が分からないので、飛び率の分母に入れない
export function aggregate(tables, sessionIds) {
  const byMember = new Map();
  for (const id of sessionIds) {
    const model = buildSession(tables, id);
    if (!model) continue;
    for (const s of model.summary) {
      const a = byMember.get(s.memberId) || {
        memberId: s.memberId, sessions: 0, games: 0, rankCounts: [0, 0, 0, 0],
        pt10: 0, chips: 0, subtotal: 0, balance: 0, scoredGames: 0, tobi: 0,
      };
      a.sessions += 1;
      a.games += s.games;
      s.rankCounts.forEach((n, i) => { a.rankCounts[i] += n; });
      a.pt10 += s.pt10;
      a.chips += s.chips;
      a.subtotal += s.subtotal;
      a.balance += s.balance;
      byMember.set(s.memberId, a);
    }
    for (const { results } of model.hanchans) {
      for (const r of Object.values(results)) {
        const a = byMember.get(r.member_id);
        if (!a || r.raw_score == null || r.raw_score === '') continue;
        a.scoredGames += 1;
        if (Number(r.raw_score) < 0) a.tobi += 1;
      }
    }
  }
  return [...byMember.values()]
    .map((a) => ({ ...a, ...rates(a) }))
    .sort((x, y) => y.balance - x.balance);
}

// 回数から率を出す（表示用。金額や pt と違い、小数で持って良い）
function rates({ games, rankCounts, scoredGames, tobi }) {
  const rate = (n) => (games ? n / games : null);
  return {
    avgRank: games ? rankCounts.reduce((acc, n, i) => acc + n * (i + 1), 0) / games : null,
    rankRates: rankCounts.map(rate),
    topRate: rate(rankCounts[0]),
    rentaiRate: rate(rankCounts[0] + rankCounts[1]),
    lastAvoidRate: rate(games - rankCounts[3]),
    tobiRate: scoredGames ? tobi / scoredGames : null,
  };
}

// ルールプリセットの行から、対局に保存するスナップショット（JSON 文字列）を作る
//   settings … 対局作成画面で切り替えた { umaOka, uma（pt10 の配列）, rounding, tieBreak }。省いた項目はプリセットのまま
export function ruleSnapshot(preset, settings = {}) {
  if (!preset) return '';
  const rule = { ...normalizeRule(preset), ...settings };
  return JSON.stringify({
    id: preset.id,
    name: preset.name,
    players: preset.players ?? 4,
    start_points: rule.start,
    return_points: rule.ret,
    uma: umaToString(rule.uma),
    uma_oka: rule.umaOka,
    rounding: rule.rounding,
    tie_break: rule.tieBreak,
  });
}

// pt10 のウマ配列をシートの形（"20,10,-10,-20"）にする
export function umaToString(uma) {
  return uma.map((v) => formatPt(v).replace('+', '')).join(',');
}

// 標準ルール「いつものルール」（GAS の「シートを準備」で入るものと同じ）。
// ルールのシートがまだ読めていないときや、対局のスナップショットが欠けているときの補いに使う
export const STANDARD_PRESET = {
  id: 'r_standard', name: 'いつものルール', group_id: '', players: 4, start_points: 25000, return_points: 30000,
  uma: '20,10,-10,-20', uma_oka: true, rounding: 'round4', tie_break: 'seat',
};
const STANDARD_RULE = STANDARD_PRESET;

// 対局に保存したルール（rule_snapshot）を計算用の形にする
export function sessionRule(session) {
  let snapshot = {};
  try {
    snapshot = JSON.parse(session?.rule_snapshot || '{}') || {};
  } catch { /* 壊れていたら標準ルール */ }
  return normalizeRule({ ...STANDARD_RULE, ...snapshot });
}

// ルールのシートの行を作る（ルール画面と「この設定をルールとして保存」で使う）
//   groupId … 空なら全グループ共通、グループの id ならそのグループ限定
//   uma     … ウマ・オカなしでも、選んでいたウマを残す（あとで「あり」に戻したとき使う）
export function presetRow({ id, name, groupId = '', start, ret, umaOka, uma, rounding, tieBreak = 'seat', note = '' }) {
  return {
    id, name, group_id: groupId, players: 4, start_points: start, return_points: ret,
    uma: umaToString(uma), uma_oka: umaOka, rounding, tie_break: tieBreak, note,
  };
}

// ルールの並び：全グループ共通を先に、次にグループ限定。それぞれ作った順
export function sortPresets(rows) {
  return [...rows].sort((a, b) => (a.group_id ? 1 : 0) - (b.group_id ? 1 : 0)
    || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

// 複製したときの名前。「〇〇のコピー」が既にあれば「〇〇のコピー2」…
export function copyName(name, existingNames) {
  const used = new Set(existingNames);
  let candidate = `${name}のコピー`;
  for (let n = 2; used.has(candidate); n++) candidate = `${name}のコピー${n}`;
  return candidate;
}
