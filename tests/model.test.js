import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlay, addToOutbox, removeSent, countOutbox, indexRows, emptyTables } from '../app/js/store.js';
import {
  toPt10, fromPt10, buildSession, sessionChanges, hanchanChanges, sessionHanchans,
  filterSessions, aggregate, scoreEntries, recomputeScoreResults, ruleSnapshot, sessionRule, umaToString,
  presetRow, sortPresets, copyName, STANDARD_PRESET, rankBy, rankWithMinimum,
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

// 本家で記録した対局を、半荘ごとの pt（現場の書き方の文字列）とチップから組み立てる
function realSession({ date, gameFee, rows, chips }) {
  const ids = ['a', 'b', 'c', 'd'];
  const session = { id: 's_1', group_id: 'g', date, rate: 50, chip_rate: 200, game_fee: gameFee };
  const changes = [sessionChanges({ session, memberIds: ids })];
  rows.forEach((row, i) => {
    changes.push(hanchanChanges({
      sessionId: 's_1', hanchanId: `h_${i}`, seq: i + 1,
      entries: ids.map((memberId, j) => ({ memberId, pt10: parsePt(row[j]) })),
    }));
  });
  changes.push({ participants: ids.map((m, i) => ({ id: `s_1:${m}`, chips: chips[i] })) });
  return buildSession(tablesFrom(...changes), 's_1');
}

test('検算 1：2026/10/23（10 半荘、ゲーム代 9,000）が本家と同じ収支になる', () => {
  const model = realSession({
    date: '2026-10-23',
    gameFee: 9000,
    rows: [
      ['-52', '-23', '+69', '+6'],
      ['-24', '+74', '+8', '-58'],
      ['+46', '-53', '-7', '+14'],
      ['+11', '+49', '-43', '-17'],
      ['-35', '-18', '+6', '+47'],
      ['-18', '+36', '-21', '+3'],
      ['-39', '+4', '+62', '-27'],
      ['-17', '+14', '-41', '+44'],
      ['+47', '+11', '-43', '-15'],
      ['+49', '-20', '-36', '+7'],
    ],
    chips: [-11, 12, -6, 5],
  });
  assert.equal(model.hanchans.length, 10);
  assert.deepEqual(model.summary.map((s) => s.pt10), [-320, 740, -460, 40]);
  assert.deepEqual(model.summary.map((s) => s.subtotal), [-3800, 6100, -3500, 1200]);
  assert.deepEqual(model.summary.map((s) => s.fee), [2250, 2250, 2250, 2250]);
  assert.deepEqual(model.summary.map((s) => s.balance), [-6050, 3850, -5750, -1050]);
});

test('検算 2：2026/9/26（ゲーム代 4,450 の端数は先頭に寄せる）が本家と同じ収支になる', () => {
  const model = realSession({
    date: '2026-09-26',
    gameFee: 4450,
    rows: [
      ['-48', '-12', '+12', '+48'],
      ['-25', '+7', '+58', '-40'],
      ['+15', '+55', '-46', '-24'],
      ['+3', '-19', '-41', '+57'],
      ['-32', '-44', '0', '+76'],
    ],
    chips: [-3, 0, 0, 3],
  });
  assert.deepEqual(model.summary.map((s) => s.pt10), [-870, -130, -170, 1170]);
  assert.deepEqual(model.summary.map((s) => s.fee), [1120, 1110, 1110, 1110]);
  assert.deepEqual(model.summary.map((s) => s.balance), [-6070, -1760, -1960, 5340]);
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
  // 率（a は 1着・4着・2着）
  assert.deepEqual(a.rankRates, [1 / 3, 1 / 3, 0, 1 / 3]);
  assert.equal(a.topRate, 1 / 3);
  assert.equal(a.rentaiRate, 2 / 3);
  assert.equal(a.lastAvoidRate, 2 / 3);
  // pt で入れた半荘は素点が分からないので、飛び率は出さない
  assert.equal(a.scoredGames, 0);
  assert.equal(a.tobiRate, null);
});

const preset = {
  id: 'r_standard', name: 'いつものルール', players: 4, start_points: 25000, return_points: 30000,
  uma: '20,10,-10,-20', uma_oka: true, rounding: 'none', tie_break: 'seat',
};

test('ruleSnapshot／sessionRule：対局作成画面の切り替えを保存し、計算用に読み戻す', () => {
  const plain = sessionRule({ rule_snapshot: ruleSnapshot(preset) });
  assert.deepEqual(plain, { start: 25000, ret: 30000, uma: [200, 100, -100, -200], umaOka: true, rounding: 'none', tieBreak: 'seat' });

  const snap = ruleSnapshot(preset, { rounding: 'round4', uma: [300, 100, -100, -300] });
  assert.equal(JSON.parse(snap).uma, '30,10,-10,-30');
  assert.equal(JSON.parse(snap).name, 'いつものルール');
  assert.deepEqual(sessionRule({ rule_snapshot: snap }).uma, [300, 100, -100, -300]);
  assert.equal(sessionRule({ rule_snapshot: snap }).rounding, 'round4');

  const off = sessionRule({ rule_snapshot: ruleSnapshot(preset, { umaOka: false }) });
  assert.equal(off.umaOka, false);
  assert.deepEqual(off.uma, [0, 0, 0, 0]);

  // スナップショットがない・壊れているときは標準ルール（四捨五入）
  const standardRule = { ...plain, rounding: 'round4' };
  assert.deepEqual(sessionRule({ rule_snapshot: '' }), standardRule);
  assert.deepEqual(sessionRule({ rule_snapshot: '{壊れ' }), standardRule);
  assert.equal(umaToString([100, 50, -50, -100]), '10,5,-5,-10');

  // 同点の扱いも切り替えを保存する
  const split = ruleSnapshot(preset, { tieBreak: 'split' });
  assert.equal(JSON.parse(split).tie_break, 'split');
  assert.equal(sessionRule({ rule_snapshot: split }).tieBreak, 'split');
});

test('scoreEntries：列順のまま渡しても席順で計算する（仕様書 6.4 例 1）', () => {
  const rule = sessionRule({ rule_snapshot: ruleSnapshot(preset) });
  // 列順は A, B, C, D。席は D が起家、A が南家…
  const entries = scoreEntries([
    { memberId: 'a', seat: 1, score: 45000 },
    { memberId: 'b', seat: 2, score: 30000 },
    { memberId: 'c', seat: 3, score: 21600 },
    { memberId: 'd', seat: 0, score: 3400 },
  ], rule);
  assert.deepEqual(entries.map((e) => [e.memberId, e.pt10, e.rank, e.seat, e.rawScore]), [
    ['a', 550, 1, 1, 45000], ['b', 100, 2, 2, 30000], ['c', -184, 3, 3, 21600], ['d', -466, 4, 0, 3400],
  ]);
});

test('scoreEntries：同点は上家（席の番号が小さい人）が上位', () => {
  const rule = sessionRule({ rule_snapshot: ruleSnapshot(preset) });
  const entries = scoreEntries([
    { memberId: 'a', seat: 3, score: 30000 },
    { memberId: 'b', seat: 1, score: 30000 },
    { memberId: 'c', seat: 0, score: 20000 },
    { memberId: 'd', seat: 2, score: 20000 },
  ], rule);
  assert.deepEqual(entries.map((e) => e.rank), [2, 1, 3, 4]);
});

test('recomputeScoreResults：ルールを変えたら素点の半荘だけ計算し直す', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const session = { id: 's_1', group_id: 'g', date: '2026-11-01', rate: 50, chip_rate: 200, game_fee: 0, rule_snapshot: ruleSnapshot(preset) };
  const rule = sessionRule(session);
  const scoreHanchan = hanchanChanges({
    sessionId: 's_1', hanchanId: 'h_1', seq: 1, inputMode: 'score',
    entries: scoreEntries(ids.map((memberId, i) => ({ memberId, seat: i, score: [45000, 30000, 21600, 3400][i] })), rule),
  });
  assert.equal(scoreHanchan.hanchans[0].input_mode, 'score');
  assert.equal(scoreHanchan.results[2].pt, -18.4);
  assert.equal(scoreHanchan.results[2].raw_score, 21600);
  const ptHanchan = hanchanChanges({
    sessionId: 's_1', hanchanId: 'h_2', seq: 2,
    entries: ids.map((memberId, i) => ({ memberId, pt10: [100, 0, 0, -100][i] })),
  });
  const t = tablesFrom(sessionChanges({ session, memberIds: ids }), scoreHanchan, ptHanchan);

  // 同じルールなら変更なし
  assert.deepEqual(recomputeScoreResults(t, 's_1', rule), []);
  // 五捨六入に変えると、素点の半荘だけ例 2 の値になる
  const changes = recomputeScoreResults(t, 's_1', { ...rule, rounding: 'round5' });
  assert.deepEqual(changes, [
    { id: 'h_1:c', pt: -18, rank: 3 },
    { id: 'h_1:d', pt: -47, rank: 4 },
  ]);
});

test('presetRow：ルールの行を作る（ウマ・オカなしでも選んだウマは残す）', () => {
  const row = presetRow({ id: 'r_1', name: '内輪', groupId: 'g', start: 25000, ret: 25000, umaOka: false, uma: [300, 100, -100, -300], rounding: 'round5' });
  assert.deepEqual(row, {
    id: 'r_1', name: '内輪', group_id: 'g', players: 4, start_points: 25000, return_points: 25000,
    uma: '30,10,-10,-30', uma_oka: false, rounding: 'round5', tie_break: 'seat', note: '',
  });
  // 対局に保存するときはウマ・オカなしとして扱われる
  const rule = sessionRule({ rule_snapshot: ruleSnapshot(row) });
  assert.equal(rule.umaOka, false);
  assert.deepEqual(rule.uma, [0, 0, 0, 0]);
  // 標準ルールの行を作り直すと元と同じ
  const std = presetRow({ id: 'r_standard', name: 'いつものルール', start: 25000, ret: 30000, umaOka: true, uma: [200, 100, -100, -200], rounding: 'round4' });
  for (const key of ['start_points', 'return_points', 'uma', 'uma_oka', 'rounding', 'tie_break', 'group_id']) {
    assert.equal(std[key], STANDARD_PRESET[key], key);
  }
  // 等分を選んだルール
  const ml = presetRow({ id: 'r_2', name: 'M', start: 25000, ret: 30000, umaOka: true, uma: [300, 100, -100, -300], rounding: 'none', tieBreak: 'split' });
  assert.equal(ml.tie_break, 'split');
});

test('sortPresets：共通ルールを先に、それぞれ作った順', () => {
  const rows = [
    { id: 'g2', group_id: 'g', created_at: '2026-10-02' },
    { id: 's2', group_id: '', created_at: '2026-10-03' },
    { id: 'g1', group_id: 'g', created_at: '2026-10-01' },
    { id: 's1', group_id: '', created_at: '2026-09-01' },
  ];
  assert.deepEqual(sortPresets(rows).map((r) => r.id), ['s1', 's2', 'g1', 'g2']);
});

test('copyName：複製の名前が重ならない', () => {
  assert.equal(copyName('Mリーグ', ['Mリーグ']), 'Mリーグのコピー');
  assert.equal(copyName('Mリーグ', ['Mリーグ', 'Mリーグのコピー']), 'Mリーグのコピー2');
  assert.equal(copyName('Mリーグ', ['Mリーグのコピー', 'Mリーグのコピー2']), 'Mリーグのコピー3');
});

test('aggregate：飛び率は素点で入れた半荘だけで数える', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const session = { id: 's_1', group_id: 'g', date: '2026-11-01', rate: 50, chip_rate: 200, game_fee: 0, rule_snapshot: ruleSnapshot(preset) };
  const rule = sessionRule(session);
  const byScore = (hid, seq, scores) => hanchanChanges({
    sessionId: 's_1', hanchanId: hid, seq, inputMode: 'score',
    entries: scoreEntries(ids.map((memberId, i) => ({ memberId, seat: i, score: scores[i] })), rule),
  });
  const t = tablesFrom(
    sessionChanges({ session, memberIds: ids }),
    byScore('h_1', 1, [60000, 30000, 12000, -2000]), // d が飛び
    byScore('h_2', 2, [40000, 30000, 30000, 0]),     // 0 点ちょうどは飛びに数えない
    hanchanChanges({ sessionId: 's_1', hanchanId: 'h_3', seq: 3, entries: ids.map((memberId, i) => ({ memberId, pt10: [500, 100, -100, -500][i] })) }),
  );
  const d = aggregate(t, ['s_1']).find((r) => r.memberId === 'd');
  assert.equal(d.games, 3);
  assert.equal(d.scoredGames, 2);
  assert.equal(d.tobi, 1);
  assert.equal(d.tobiRate, 1 / 2);
  assert.equal(d.lastAvoidRate, 0);
});

test('rankBy：高い順に順位を付け、同じ値は同じ順位、率が出ない人は外す', () => {
  const rows = [
    { memberId: 'a', games: 10, pt10: 300, topRate: 0.3 },
    { memberId: 'b', games: 6, pt10: -500, topRate: 2 / 6 },
    { memberId: 'c', games: 3, pt10: 300, topRate: 1 / 3 },
    { memberId: 'd', games: 0, pt10: 0, topRate: null },
  ];
  const byPt = rankBy(rows, (r) => r.pt10);
  assert.deepEqual(byPt.map((x) => [x.row.memberId, x.place]), [['a', 1], ['c', 1], ['d', 3], ['b', 4]]);
  // 2/6 と 1/3 は同じ率なので同じ順位。並びは半荘数の多い順
  const byTop = rankBy(rows, (r) => r.topRate);
  assert.deepEqual(byTop.map((x) => [x.row.memberId, x.place]), [['b', 1], ['c', 1], ['a', 3]]);
  assert.deepEqual(rankBy([], (r) => r.pt10), []);
});

test('rankWithMinimum：規定半荘数に届かない人は順位を付けずに下にまとめる', () => {
  const rows = [
    { memberId: 'a', games: 12, topRate: 0.25 },
    { memberId: 'b', games: 10, topRate: 0.4 },
    { memberId: 'c', games: 9, topRate: 0.6 },
    { memberId: 'd', games: 0, topRate: null },
    { memberId: 'e', games: 3, topRate: 0 },
  ];
  const { ranked, below } = rankWithMinimum(rows, (r) => r.topRate, 10);
  // 10 半荘ちょうどは規定に届いている
  assert.deepEqual(ranked.map((x) => [x.row.memberId, x.place]), [['b', 1], ['a', 2]]);
  // 規定未満は率の高い順、率の出ない人は最後
  assert.deepEqual(below.map((x) => x.row.memberId), ['c', 'e', 'd']);
  // 規定 0 なら半荘 0 の人だけが下に残る
  const zero = rankWithMinimum(rows, (r) => r.topRate, 0);
  assert.deepEqual(zero.ranked.map((x) => x.row.memberId), ['c', 'b', 'a', 'e']);
  assert.deepEqual(zero.below.map((x) => x.row.memberId), ['d']);
});

test('aggregate：半荘が 1 回もない対局は数えない（ゲーム代だけ引かれないように）', () => {
  const session = { id: 's_1', group_id: 'g', date: '2026-11-01', rate: 50, chip_rate: 200, game_fee: 4000 };
  const empty = { id: 's_2', group_id: 'g', date: '2026-11-02', rate: 50, chip_rate: 200, game_fee: 4000 };
  const ids = ['a', 'b', 'c', 'd'];
  const t = tablesFrom(
    sessionChanges({ session, memberIds: ids }),
    hanchanChanges({ sessionId: 's_1', hanchanId: 'h_1', seq: 1, entries: ids.map((memberId, i) => ({ memberId, pt10: [500, 100, -100, -500][i] })) }),
    sessionChanges({ session: empty, memberIds: ids }),
  );
  const rows = aggregate(t, ['s_1', 's_2']);
  const a = rows.find((r) => r.memberId === 'a');
  assert.equal(a.sessions, 1);
  assert.equal(a.balance, 50 * 50 - 1000);
  // 半荘のない対局だけなら誰も出ない
  assert.deepEqual(aggregate(t, ['s_2']), []);
  // 半荘をすべて削除した対局も同じ
  const deleted = tablesFrom(
    sessionChanges({ session, memberIds: ids }),
    hanchanChanges({ sessionId: 's_1', hanchanId: 'h_1', seq: 1, entries: ids.map((memberId, i) => ({ memberId, pt10: [500, 100, -100, -500][i] })) }),
    { hanchans: [{ id: 'h_1', deleted: true }] },
  );
  assert.deepEqual(aggregate(deleted, ['s_1']), []);
});
