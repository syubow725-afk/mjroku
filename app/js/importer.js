// 本家「雀簿」の過去対局の一括取り込み（段階 5。形式は docs/06_過去対局の取り込み形式.md）。
// 画面に依存しない純粋な関数だけを置く（tests/importer.test.js で確かめる）。
//
// 流れ：planImport でファイルを読んで対局ごとに「取り込む／取り込み済み／重複／誤り」を決める
//   → importChanges で書き込む行を作り、store.write で送る → verifyImported で、取り込んだ行から計算し直した
//   計と収支が本家の値（check）と一致するかを確かめる。
// 対局・半荘の ID は本家の元ファイル名から決めるので、同じ対局を 2 回取り込んでも二重にならない
import { summarizeSession, sum } from './calc.js';
import { sessionChanges, hanchanChanges, ruleSnapshot, buildSession, STANDARD_PRESET } from './model.js';

export const IMPORT_VERSION = 1;
export const IMPORTED_BY = '本家から取り込み';

// 文字列から決まる英小文字・数字 10 桁（ID 用。FNV-1a を 2 本使う。暗号ではない）
export function stableCode(text) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2 * i + 1) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 10; i++) {
    const h = i < 5 ? h1 : h2;
    out += chars[(h >>> ((i % 5) * 6)) % 36];
  }
  return out;
}

// 対局の取り込み用の鍵。本家の元ファイル名（なければ日付と参加者）で決まる
function importKey(groupId, s) {
  return `honke:${groupId}:${s.source_file || `${s.date}|${s.players.join(',')}`}`;
}

export function importIds(groupId, s) {
  const sessionId = `s_${stableCode(importKey(groupId, s))}`;
  return {
    sessionId,
    hanchanId: (seq) => `h_${stableCode(`${sessionId}#${seq}`)}`,
  };
}

const alive = (row) => row && !row.deleted;
const toPt10 = (pt) => Math.round(Number(pt) * 10); // 本家の pt は小数第 1 位まで
const isInt = (v) => Number.isInteger(v);

// ファイルを読む。形が違えば Error
export function readImportFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読めません');
  }
  if (!data || data.version !== IMPORT_VERSION || typeof data.groups !== 'object' || !data.groups) {
    throw new Error(`取り込み用のファイルではありません（version ${IMPORT_VERSION} と groups が必要）`);
  }
  return data;
}

// 1 対局の中身の検査。本家の計（check.total）と収支（check.balance）に、アプリの計算が一致するかまで見る。
// 戻り値は誤りの文の配列（空なら正しい）
export function checkSession(s) {
  const errors = [];
  const n = Array.isArray(s.players) ? s.players.length : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) errors.push('日付が YYYY-MM-DD でない');
  if (n < 4) errors.push('参加者が 4 人未満');
  if (new Set(s.players || []).size !== n) errors.push('参加者の名前が重なっている');
  for (const key of ['rate', 'chip_rate', 'game_fee']) if (!isInt(s[key])) errors.push(`${key} が整数でない`);
  const lengths = [['chips', s.chips], ['fee_shares', s.fee_shares], ['check.total', s.check?.total], ['check.balance', s.check?.balance]];
  for (const [name, arr] of lengths) {
    if (name === 'fee_shares' && arr == null) continue;
    if (!Array.isArray(arr) || arr.length !== n) errors.push(`${name} の人数が参加者と違う`);
  }
  if (!Array.isArray(s.hanchans) || !s.hanchans.length) errors.push('半荘がない');
  if (errors.length) return errors;

  (s.hanchans).forEach((row, i) => {
    const played = row.filter((v) => v != null);
    if (row.length !== n) errors.push(`${i + 1} 回目：列の数が参加者と違う`);
    else if (played.length !== 4) errors.push(`${i + 1} 回目：pt が入っている人が 4 人でない`);
    else if (sum(played.map(toPt10)) !== 0) errors.push(`${i + 1} 回目：合計が 0 でない`);
  });
  if (s.fee_shares && sum(s.fee_shares) !== s.game_fee) errors.push('fee_shares の合計がゲーム代と違う');
  if (errors.length) return errors;

  // アプリの計算（精算）で計と収支を出し直して、本家の値と比べる
  const summary = summarizeSession({
    session: { rate: s.rate, chipRate: s.chip_rate, gameFee: s.game_fee },
    participants: s.players.map((_, j) => ({ memberId: j, chips: s.chips[j], feeShare: s.fee_shares ? s.fee_shares[j] : null })),
    hanchans: s.hanchans.map((row) => ({
      results: row.map((v, j) => (v == null ? null : { memberId: j, pt10: toPt10(v) })).filter(Boolean),
    })),
  });
  summary.forEach((r, j) => {
    if (r.pt10 !== toPt10(s.check.total[j])) errors.push(`${s.players[j]}：計が本家（${s.check.total[j]}）と違う`);
    if (r.balance !== s.check.balance[j]) errors.push(`${s.players[j]}：収支 ${r.balance} が本家（${s.check.balance[j]}）と違う`);
  });
  return errors;
}

// 名前からメンバーを決める。今のグループ → ほかのグループ（同じ人を 1 人のメンバーにする。仕様書 4 章）→ 新しく作る
//   groupMembers … 今のグループのメンバーの行／otherMembers … 端末にあるほかのグループのメンバーの行
//   newId        … 新しいメンバーの ID を作る関数
export function resolveMembers(names, { groupMembers, otherMembers, newId }) {
  const find = (rows, name) => rows.find((m) => alive(m) && (m.name === name
    || String(m.aliases || '').split(/[,、]/).map((a) => a.trim()).includes(name)));
  const out = new Map();
  for (const name of names) {
    if (out.has(name)) continue;
    const here = find(groupMembers, name);
    if (here) { out.set(name, { id: here.id, how: 'group' }); continue; }
    const other = find(otherMembers, name);
    out.set(name, other ? { id: other.id, how: 'other' } : { id: newId(), how: 'new' });
  }
  return out;
}

// 取り込みの計画。対局ごとに status を決める
//   'import'   … 取り込む
//   'imported' … 同じ対局を取り込み済み（削除していても、もう一度は入れない）
//   'duplicate'… 同じ日・同じ顔ぶれの対局が本アプリにもう入っている（手で入れた分と二重にしない）
//   'after'    … 切替日以降（本アプリで入れる分なので取り込まない）
//   'error'    … 中身が合わない（errors に理由）
export function planImport(data, { tables, group, otherMembers = [], newId }) {
  const list = data.groups[group.name];
  const sessions = Array.isArray(list) ? list : [];
  const cutover = group.cutover_date || '';
  const existing = Object.values(tables.sessions).filter(alive);
  const peopleOf = (sessionId) => Object.values(tables.participants)
    .filter((p) => alive(p) && p.session_id === sessionId).map((p) => p.member_id).sort().join(',');

  const names = [...new Set(sessions.flatMap((s) => s.players || []))];
  const members = resolveMembers(names, {
    groupMembers: Object.values(tables.members),
    otherMembers,
    newId,
  });

  const items = sessions.map((s) => {
    const ids = importIds(group.id, s);
    const errors = checkSession(s);
    let status = 'import';
    if (tables.sessions[ids.sessionId]) status = 'imported';
    else if (errors.length) status = 'error';
    else if (cutover && s.date >= cutover) status = 'after';
    else {
      const people = s.players.map((name) => members.get(name).id).sort().join(',');
      if (existing.some((e) => e.date === s.date && peopleOf(e.id) === people)) status = 'duplicate';
    }
    return { source: s, ids, status, errors };
  });
  const used = new Set(items.filter((i) => i.status === 'import').flatMap((i) => i.source.players));
  return {
    group,
    items,
    members,
    // 取り込む対局に出てくる人のうち、新しく作る人・ほかのグループから加える人
    newMembers: [...used].filter((n) => members.get(n).how === 'new'),
    joinMembers: [...used].filter((n) => members.get(n).how === 'other'),
    otherGroups: Object.keys(data.groups).filter((g) => g !== group.name),
    pending: Object.entries(data).filter(([k, v]) => k.startsWith('pending') && Array.isArray(v)).reduce((n, [, v]) => n + v.length, 0),
  };
}

// 取り込む対局（status 'import'）の書き込みを 1 つの changes にまとめる。
//   rule … 付けるルールのプリセットの行（いつものルール）
export function importChanges(plan, { rule = STANDARD_PRESET } = {}) {
  const G = plan.group.id;
  const out = { members: [], group_members: [], sessions: [], participants: [], hanchans: [], results: [] };
  const add = (changes) => { for (const [sheet, rows] of Object.entries(changes)) out[sheet].push(...rows); };

  for (const name of plan.newMembers) {
    const { id } = plan.members.get(name);
    out.members.push({ id, name, aliases: '' });
  }
  for (const name of [...plan.newMembers, ...plan.joinMembers]) {
    const { id } = plan.members.get(name);
    out.group_members.push({ id: `${G}:${id}`, group_id: G, member_id: id });
  }

  for (const item of plan.items.filter((i) => i.status === 'import')) {
    const s = item.source;
    const { sessionId, hanchanId } = item.ids;
    const memberIds = s.players.map((name) => plan.members.get(name).id);
    const session = {
      id: sessionId, group_id: G, date: s.date, title: s.title || '',
      rule_name: rule.name || '', rule_snapshot: ruleSnapshot(rule),
      rate: s.rate, chip_rate: s.chip_rate, game_fee: s.game_fee,
      memo: '', created_by: s.creator ? `${s.creator}（${IMPORTED_BY}）` : IMPORTED_BY, event_id: '',
    };
    const base = sessionChanges({ session, memberIds });
    base.participants = base.participants.map((p, j) => ({
      ...p, chips: s.chips[j], fee_share: s.fee_shares ? s.fee_shares[j] : null,
    }));
    add(base);
    s.hanchans.forEach((row, i) => {
      add(hanchanChanges({
        sessionId, hanchanId: hanchanId(i + 1), seq: i + 1,
        entries: row.map((v, j) => (v == null ? null : { memberId: memberIds[j], pt10: toPt10(v) })).filter(Boolean),
      }));
    });
  }
  return out;
}

// 取り込んだ対局を、本アプリに入った行から計算し直して本家の値と比べる。
// [{ item, ok, diffs: [文] }]（対局が見つからないときは ok: false）
export function verifyImported(plan, tables) {
  return plan.items.filter((i) => i.status === 'import' || i.status === 'imported').map((item) => {
    const s = item.source;
    const model = buildSession(tables, item.ids.sessionId);
    if (!model) return { item, ok: false, diffs: ['本アプリに見つからない（削除したか、まだ同期していない）'] };
    const byMember = new Map(model.summary.map((r) => [r.memberId, r]));
    const diffs = [];
    if (model.hanchans.length !== s.hanchans.length) diffs.push(`半荘の数 ${model.hanchans.length}（本家 ${s.hanchans.length}）`);
    s.players.forEach((name, j) => {
      const r = byMember.get(plan.members.get(name)?.id);
      if (!r) { diffs.push(`${name}：参加者にいない`); return; }
      if (r.pt10 !== toPt10(s.check.total[j])) diffs.push(`${name}：計 ${r.pt10 / 10}（本家 ${s.check.total[j]}）`);
      if (r.balance !== s.check.balance[j]) diffs.push(`${name}：収支 ${r.balance}（本家 ${s.check.balance[j]}）`);
    });
    return { item, ok: diffs.length === 0, diffs };
  });
}
