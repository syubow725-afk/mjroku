// シートの行（store の表）と計算ロジック（calc.js）の橋渡し。画面には触らない純粋関数。
//
// シートの pt は人が読める値（55、-26.6）、計算は ×10 の整数（pt10）で行う（docs/02_データ設計.md 2.3）

import { rankByPt, summarizeSession } from './calc.js';

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
export function hanchanChanges({ sessionId, hanchanId, seq, entries, existingResults = [] }) {
  const ranks = rankByPt(entries.map((e) => e.pt10));
  const results = entries.map((e, i) => ({
    id: `${hanchanId}:${e.memberId}`,
    hanchan_id: hanchanId,
    member_id: e.memberId,
    seat: null,
    raw_score: null,
    pt: fromPt10(e.pt10),
    rank: ranks[i],
    deleted: false,
  }));
  const playing = new Set(entries.map((e) => e.memberId));
  for (const r of existingResults) {
    if (!playing.has(r.member_id) && !r.deleted) results.push({ id: r.id, deleted: true });
  }
  return {
    hanchans: [{ id: hanchanId, session_id: sessionId, seq, input_mode: 'pt', deleted: false }],
    results,
  };
}

// ルールプリセットの行から、対局に保存するスナップショット（JSON 文字列）を作る
export function ruleSnapshot(rule) {
  if (!rule) return '';
  const { id, name, players, start_points, return_points, uma, rounding, tie_break } = rule;
  return JSON.stringify({ id, name, players, start_points, return_points, uma, rounding, tie_break });
}
