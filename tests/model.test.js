import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlay, addToOutbox, removeSent, countOutbox, indexRows, emptyTables } from '../app/js/store.js';
import {
  toPt10, fromPt10, buildSession, sessionChanges, hanchanChanges, sessionHanchans,
  filterSessions, aggregate,
} from '../app/js/model.js';
import { parsePt } from '../app/js/calc.js';

// 公開リポジトリのため、実在メンバーの名前は使わない

// store の表を、書き込みの changes を重ねて作る（Store.write と同じ重ね方）
function tablesFrom(...changesList) {
  const outbox = emptyTables();
  for (const changes of changesList) {
    for (const [sheet, rows] of Object.entries(changes)) {
      for (const row of rows) addToOutbox(outbox, sheet, { created_at: '2026-10-23T10:00:00Z', ...row });
    }
  }
  return overlay(emptyTables(), outbox);
}

test('toPt10／fromPt10：シートの pt と内部の整数を誤差なく往復する', () => {
  for (const pt of [55, -26.6, 0, 0.1, -0.3, 74, -46.5]) {
    assert.equal(fromPt10(toPt10(pt)), pt);
  }
  assert.equal(toPt10(-26.6), -266);
  assert.equal(toPt10(null), null);
  assert.equal(toPt10(''), null);
});

test('overlay：送信待ちをサーバーのデータに重ねる（元は変えない）', () => {
  const server = indexRows({ members: [{ id: 'm_1', name: 'A', aliases: '' }] });
  const outbox = emptyTables();
  addToOutbox(outbox, 'members', { id: 'm_1', name: 'A2', updated_at: 't1' });
  addToOutbox(outbox, 'members', { id: 'm_2', name: 'B', updated_at: 't1' });
  const view = overlay(server, outbox);
  assert.deepEqual(view.members.m_1, { id: 'm_1', name: 'A2', aliases: '', updated_at: 't1' });
  assert.equal(view.members.m_2.name, 'B');
  assert.equal(server.members.m_1.name, 'A');
});

test('addToOutbox：同じ行への変更は 1 行にまとまる', () => {
  const outbox = emptyTables();
  addToOutbox(outbox, 'sessions', { id: 's_1', title: 'x', rate: 50, updated_at: 't1' });
  addToOutbox(outbox, 'sessions', { id: 's_1', title: 'y', updated_at: 't2' });
  assert.deepEqual(outbox.sessions.s_1, { id: 's_1', title: 'y', rate: 50, updated_at: 't2' });
  assert.equal(countOutbox(outbox), 1);
});

test('removeSent：送信中にさらに変更された行は残す', () => {
  const outbox = emptyTables();
  addToOutbox(outbox, 'members', { id: 'm_1', name: 'A', updated_at: 't1' });
  addToOutbox(outbox, 'members', { id: 'm_2', name: 'B', updated_at: 't1' });
  const sent = JSON.parse(JSON.stringify(outbox));
  addToOutbox(outbox, 'members', { id: 'm_2', name: 'B2', updated_at: 't2' }); // 送信中の変更
  removeSent(outbox, sent);
  assert.deepEqual(Object.keys(outbox.members), ['m_2']);
  assert.equal(outbox.members.m_2.name, 'B2');
});

test('sessionChanges：参加者の追加・除外・復帰', () => {
  const session = { id: 's_1', group_id: 'g', date: '2026-10-23' };
  const first = sessionChanges({ session, memberIds: ['a', 'b', 'c', 'd'] });
  assert.deepEqual(first.participants.map((p) => [p.id, p.col_order]),
    [['s_1:a', 0], ['s_1:b', 1], ['s_1:c', 2], ['s_1:d', 3]]);
  assert.equal(first.participants[0].fee_share, null);

  const t = tablesFrom(first);
  const existing = Object.values(t.participants);
  // d を外して e を足し、並びを変える
  const second = sessionChanges({ session, memberIds: ['b', 'a', 'c', 'e'], existing });
  const byId = Object.fromEntries(second.participants.map((p) => [p.id, p]));
  assert.deepEqual(byId['s_1:b'], { id: 's_1:b', col_order: 0, deleted: false });
  assert.equal(byId['s_1:e'].session_id, 's_1');
  assert.deepEqual(byId['s_1:d'], { id: 's_1:d', deleted: true });
});

test('hanchanChanges：着順を付け、抜けた人の成績を論理削除する', () => {
  const entries = ['a', 'b', 'c', 'd'].map((memberId, i) => ({ memberId, pt10: [-520, -230, 690, 60][i] }));
  const ch = hanchanChanges({ sessionId: 's_1', hanchanId: 'h_1', seq: 1, entries });
  assert.deepEqual(ch.results.map((r) => [r.member_id, r.pt, r.rank]),
    [['a', -52, 4], ['b', -23, 3], ['c', 69, 1], ['d', 6, 2]]);
  assert.equal(ch.hanchans[0].input_mode, 'pt');

  // 編集で d → e に入れ替え
  const entries2 = ['a', 'b', 'c', 'e'].map((memberId, i) => ({ memberId, pt10: [-520, -230, 690, 60][i] }));
  const ch2 = hanchanChanges({ sessionId: 's_1', hanchanId: 'h_1', seq: 1, entries: entries2, existingResults: ch.results });
  assert.deepEqual(ch2.results.at(-1), { id: 'h_1:d', deleted: true });
  assert.equal(ch2.results.filter((r) => !r.deleted).length, 4);
});

test('buildSession：2026/10/23 の対局を行の形で入れると本家と同じ収支になる', () => {
  // 1〜6 半荘目は本家の表示どおり。7 半荘目以降は画面が切れているため、
  // 各人の「計」との差を 1 行にまとめた（40 / 9 / -58 / 9）。合計・チップ・収支の検算用
  const ids = ['a', 'b', 'c', 'd'];
  const rows = [
    ['-52', '-23', '69', '6'],
    ['-24', '74', '8', '-58'],
    ['46', '-53', '-7', '14'],
    ['11', '49', '-43', '-17'],
    ['-35', '-18', '6', '47'],
    ['-18', '36', '-21', '3'],
    ['40', '9', '-58', '9'],
  ];
  const session = { id: 's_1', group_id: 'g', date: '2026-10-23', rate: 50, chip_rate: 200, game_fee: 9000 };
  const changes = [sessionChanges({ session, memberIds: ids })];
  rows.forEach((row, i) => {
    changes.push(hanchanChanges({
      sessionId: 's_1', hanchanId: `h_${i}`, seq: i + 1,
      entries: ids.map((memberId, j) => ({ memberId, pt10: parsePt(row[j]) })),
    }));
  });
  changes.push({ participants: ids.map((m, i) => ({ id: `s_1:${m}`, chips: [-11, 12, -6, 5][i] })) });

  const model = buildSession(tablesFrom(...changes), 's_1');
  assert.equal(model.hanchans.length, 7);
  assert.deepEqual(model.summary.map((s) => s.pt10), [-320, 740, -460, 40]);
  assert.deepEqual(model.summary.map((s) => s.subtotal), [-3800, 6100, -3500, 1200]);
  assert.deepEqual(model.summary.map((s) => s.balance), [-6050, 3850, -5750, -1050]);
});

test('sessionHanchans／buildSession：論理削除した半荘・対局は数えない', () => {
  const session = { id: 's_1', group_id: 'g', date: '2026-10-23', rate: 50, chip_rate: 200, game_fee: 0 };
  const entries = ['a', 'b', 'c', 'd'].map((memberId, i) => ({ memberId, pt10: [300, 100, -100, -300][i] }));
  const t = tablesFrom(
    sessionChanges({ session, memberIds: ['a', 'b', 'c', 'd'] }),
    hanchanChanges({ sessionId: 's_1', hanchanId: 'h_1', seq: 1, entries }),
    hanchanChanges({ sessionId: 's_1', hanchanId: 'h_2', seq: 2, entries }),
    { hanchans: [{ id: 'h_1', deleted: true }] },
  );
  assert.deepEqual(sessionHanchans(t, 's_1').map((h) => h.hanchan.id), ['h_2']);
  assert.equal(buildSession(t, 's_1').summary[0].pt10, 300);

  const t2 = tablesFrom({ sessions: [{ ...session, deleted: true }] });
  assert.equal(buildSession(t2, 's_1'), null);
});

test('filterSessions：期間（両端を含む）とルールで絞り込む', () => {
  const sessions = [
    { id: '1', date: '2025-12-31', rule_name: 'いつものルール' },
    { id: '2', date: '2026-01-01', rule_name: 'いつものルール' },
    { id: '3', date: '2026-10-23', rule_name: 'Mリーグ' },
    { id: '4', date: '2026-12-31', rule_name: 'いつものルール' },
  ];
  const ids = (f) => filterSessions(sessions, f).map((s) => s.id);
  assert.deepEqual(ids({}), ['1', '2', '3', '4']);
  assert.deepEqual(ids({ from: '2026-01-01', to: '2026-12-31' }), ['2', '3', '4']);
  assert.deepEqual(ids({ to: '2026-01-01' }), ['1', '2']);
  assert.deepEqual(ids({ rule: 'Mリーグ' }), ['3']);
});

test('aggregate：複数の対局をメンバーごとに合算する', () => {
  const mk = (sid, date, fee, members, pts, chips) => {
    const session = { id: sid, group_id: 'g', date, rate: 50, chip_rate: 200, game_fee: fee };
    const changes = [sessionChanges({ session, memberIds: members })];
    pts.forEach((row, i) => changes.push(hanchanChanges({
      sessionId: sid, hanchanId: `${sid}_h${i}`, seq: i + 1,
      entries: members.map((memberId, j) => ({ memberId, pt10: row[j] * 10 })).filter((e, j) => row[j] != null),
    })));
    changes.push({ participants: members.map((m, i) => ({ id: `${sid}:${m}`, chips: chips[i] })) });
    return changes;
  };
  const t = tablesFrom(
    ...mk('s_1', '2026-10-01', 4000, ['a', 'b', 'c', 'd'], [[30, 10, -10, -30], [-20, 40, -5, -15]], [2, 0, 0, -2]),
    ...mk('s_2', '2026-10-08', 5000, ['a', 'b', 'c', 'd', 'e'], [[10, null, 20, -10, -20]], [0, 0, 0, 0, 0]),
  );
  const rows = aggregate(t, ['s_1', 's_2']);
  const a = rows.find((r) => r.memberId === 'a');
  assert.equal(a.sessions, 2);
  assert.equal(a.games, 3);
  assert.deepEqual(a.rankCounts, [1, 1, 0, 1]); // 1着、4着、2着
  assert.equal(a.avgRank, (1 + 4 + 2) / 3);
  assert.equal(a.pt10, 200);
  assert.equal(a.chips, 2);
  // 小計：s_1 は (+10)×50＋2×200＝900、s_2 は +10×50＝500 → 1,400。ゲーム代：1,000＋1,000
  assert.equal(a.subtotal, 1400);
  assert.equal(a.balance, -600);
  const b = rows.find((r) => r.memberId === 'b');
  assert.equal(b.games, 2, '抜け番の半荘は数えない');
  const e = rows.find((r) => r.memberId === 'e');
  assert.equal(e.sessions, 1);
  // 収支の高い順
  assert.deepEqual(rows.map((r) => r.balance), [...rows.map((r) => r.balance)].sort((x, y) => y - x));
  // 全員の小計の合計は 0、収支の合計はゲーム代の総額だけマイナス
  assert.equal(rows.reduce((n, r) => n + r.subtotal, 0), 0);
  assert.equal(rows.reduce((n, r) => n + r.balance, 0), -9000);
});
