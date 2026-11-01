import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlay, addToOutbox, emptyTables } from '../app/js/store.js';
import { sessionChanges, hanchanChanges, aggregate, effectiveCarryovers, carryBase, rankWithMinimum, CARRY_KEYS } from '../app/js/model.js';

// 本家からの繰り越し（仕様書 9 章）。
// 検算 1〜3 の 3 件だけが本家にあったとして、その「全件集計」を本家通算に入れ、
// 過去の対局を本アプリに 1 件ずつ手入力していくと繰り越しが減り、3 件そろうと 0 になることを確かめる。
// 公開リポジトリのため、実在メンバーの名前は使わない（a〜h に置き換える）

function tablesFrom(...changesList) {
  const outbox = emptyTables();
  for (const changes of changesList) {
    for (const [sheet, rows] of Object.entries(changes)) {
      for (const row of rows) addToOutbox(outbox, sheet, { created_at: '2026-11-01T10:00:00Z', ...row });
    }
  }
  return overlay(emptyTables(), outbox);
}

// 1 対局分の書き込み。pts は半荘ごとの pt（null は抜け番）
function sessionOf({ id, date, gameFee, members, pts, chips }) {
  const session = { id, group_id: 'g', date, rate: 50, chip_rate: 200, game_fee: gameFee };
  return [
    sessionChanges({ session, memberIds: members }),
    ...pts.map((row, i) => hanchanChanges({
      sessionId: id, hanchanId: `${id}_h${i + 1}`, seq: i + 1,
      entries: members.map((memberId, j) => ({ memberId, pt10: row[j] == null ? null : row[j] * 10 })).filter((e) => e.pt10 != null),
    })),
    { participants: members.map((m, i) => ({ id: `${id}:${m}`, chips: chips[i] })) },
  ];
}

// 検算 2：2026/9/26（a・b・e・d、ゲーム代 4,450）
const S0926 = sessionOf({
  id: 's_0926', date: '2026-09-26', gameFee: 4450, members: ['a', 'b', 'e', 'd'],
  pts: [[-48, -12, 12, 48], [-25, 7, 58, -40], [15, 55, -46, -24], [3, -19, -41, 57], [-32, -44, 0, 76]],
  chips: [-3, 0, 0, 3],
});

// 検算 3：2026/10/02（a・b・f・g・h の 5 人打ち、ゲーム代 10,000）
const S1002 = sessionOf({
  id: 's_1002', date: '2026-10-02', gameFee: 10000, members: ['a', 'b', 'f', 'g', 'h'],
  pts: [
    [-57, 8, -14, 63, null], [41, null, -18, -29, 6], [null, -21, 57, 7, -43], [-7, 45, -51, null, 13],
    [-38, -21, null, 56, 3], [-16, 9, -38, 45, null], [-51, null, -15, 8, 58], [null, 68, 10, -25, -53],
    [-52, -25, 67, null, 10], [16, 61, -21, -56, null], [8, -13, 42, -37, null], [46, -19, -36, 9, null],
  ],
  chips: [-15, -7, -2, 22, 2],
});

// 検算 1：2026/10/23（a・b・c・d、ゲーム代 9,000）
const S1023 = sessionOf({
  id: 's_1023', date: '2026-10-23', gameFee: 9000, members: ['a', 'b', 'c', 'd'],
  pts: [
    [-52, -23, 69, 6], [-24, 74, 8, -58], [46, -53, -7, 14], [11, 49, -43, -17], [-35, -18, 6, 47],
    [-18, 36, -21, 3], [-39, 4, 62, -27], [-17, 14, -41, 44], [47, 11, -43, -15], [49, -20, -36, 7],
  ],
  chips: [-11, 12, -6, 5],
});

// 本家の「全件集計」に出るはずの値（3 件の本家の表示値を手で足したもの。アプリの計算は使わない）
//   [スコア（pt）, チップ, 収支（ゲーム代別）, ゲーム代込収支, 半荘数, 日数]
//   9/26  a −87.0 −3 −4,950 −6,070 5／b −13 0 −650 −1,760 5／e −17 0 −850 −1,960 5／d +117 +3 +6,450 +5,340 5
//   10/02 a −110 −15 −8,500 −10,500 10／b +92 −7 +3,200 +1,200 10／f −17 −2 −1,250 −3,250 11／g +41 +22 +6,450 +4,450 10／h −6 +2 +100 −1,900 7
//   10/23 a −32 −11 −3,800 −6,050 10／b +74 +12 +6,100 +3,850 10／c −46 −6 −3,500 −5,750 10／d +4 +5 +1,200 −1,050 10
const HONKE = {
  a: [-229, -29, -17250, -22620, 25, 3],
  b: [153, 5, 8650, 3290, 25, 3],
  c: [-46, -6, -3500, -5750, 10, 1],
  d: [121, 8, 7650, 4290, 15, 2],
  e: [-17, 0, -850, -1960, 5, 1],
  f: [-17, -2, -1250, -3250, 11, 1],
  g: [41, 22, 6450, 4450, 10, 1],
  h: [-6, 2, 100, -1900, 7, 1],
};

const CUTOVER = '2026-11-01';

const carryRows = {
  carryovers: Object.entries(HONKE).map(([m, [pt, chips, subtotal, balance, games, days]]) => ({
    id: `g:${m}`, group_id: 'g', member_id: m, pt, chips, subtotal, balance, games, days,
  })),
};

const asObj = ([pt, chips, subtotal, balance, games, days]) => ({ pt10: pt * 10, chips, subtotal, balance, games, days });
const zero = Object.fromEntries(CARRY_KEYS.map((k) => [k, 0]));
const pick = (row) => Object.fromEntries(CARRY_KEYS.map((k) => [k, row[k]]));
const byMember = (list) => Object.fromEntries(list.map((x) => [x.memberId, x]));
const allSessionIds = (t) => Object.keys(t.sessions);

// 「繰り越し ＋ 本アプリの対局」が、どの段階でも本家通算と同じになる
function assertTotalsEqualHonke(t) {
  const carry = effectiveCarryovers(t, CUTOVER);
  const rows = byMember(aggregate(t, allSessionIds(t), carry));
  for (const [m, values] of Object.entries(HONKE)) {
    assert.deepEqual(pick(rows[m]), asObj(values), `${m} の通算`);
  }
  return byMember(carry);
}

test('carryBase：シートの値（スコアは pt の小数）を内部の整数にする', () => {
  assert.deepEqual(carryBase({ pt: -229, chips: -29, subtotal: -17250, balance: -22620, games: 25, days: 3 }),
    { pt10: -2290, chips: -29, subtotal: -17250, balance: -22620, games: 25, days: 3 });
  assert.deepEqual(carryBase({ pt: 12.3, chips: '', subtotal: null, balance: 0, games: '' }),
    { pt10: 123, chips: 0, subtotal: 0, balance: 0, games: 0, days: 0 });
});

test('繰り越し：過去の対局を 1 件も入れていなければ、本家通算がそのまま繰り越しになる', () => {
  const t = tablesFrom(carryRows);
  const carry = assertTotalsEqualHonke(t);
  for (const [m, values] of Object.entries(HONKE)) {
    assert.deepEqual(carry[m].carry, asObj(values));
    assert.deepEqual(carry[m].entered, zero);
  }
});

test('繰り越し：10/23 を手入力すると、その分だけ繰り越しが減り、通算は変わらない', () => {
  const t = tablesFrom(carryRows, ...S1023);
  const carry = assertTotalsEqualHonke(t);
  // a：本家通算 −229／−29／−17,250／−22,620／25 から、10/23 の −32／−11／−3,800／−6,050／10 を引く
  assert.deepEqual(carry.a.entered, { pt10: -320, chips: -11, subtotal: -3800, balance: -6050, games: 10, days: 1 });
  assert.deepEqual(carry.a.carry, { pt10: -1970, chips: -18, subtotal: -13450, balance: -16570, games: 15, days: 2 });
  // c は 10/23 にしか出ていないので 0 になる
  assert.deepEqual(carry.c.carry, zero);
  // 10/23 に出ていない人は減らない
  assert.deepEqual(carry.e.carry, asObj(HONKE.e));
});

test('繰り越し：9/26・10/02・10/23 の 3 件を全部入れ終えると、全員の繰り越しが 0 になる', () => {
  // 入れる順番によらない
  for (const order of [[S0926, S1002, S1023], [S1023, S0926, S1002]]) {
    const steps = [];
    for (const s of order) {
      const now = tablesFrom(carryRows, ...steps.flat(), ...s);
      steps.push(s);
      assertTotalsEqualHonke(now);
    }
    const done = tablesFrom(carryRows, ...steps.flat());
    const carry = assertTotalsEqualHonke(done);
    for (const m of Object.keys(HONKE)) assert.deepEqual(carry[m].carry, zero, `${m} の繰り越しが 0 でない`);
  }
});

test('繰り越し：入力漏れや誤りがあると 0 にならない（検算になる）', () => {
  // 10/02 の 12 回目の半荘を入れ忘れた
  const missing = sessionOf({
    id: 's_1002', date: '2026-10-02', gameFee: 10000, members: ['a', 'b', 'f', 'g', 'h'],
    pts: [
      [-57, 8, -14, 63, null], [41, null, -18, -29, 6], [null, -21, 57, 7, -43], [-7, 45, -51, null, 13],
      [-38, -21, null, 56, 3], [-16, 9, -38, 45, null], [-51, null, -15, 8, 58], [null, 68, 10, -25, -53],
      [-52, -25, 67, null, 10], [16, 61, -21, -56, null], [8, -13, 42, -37, null],
    ],
    chips: [-15, -7, -2, 22, 2],
  });
  const t = tablesFrom(carryRows, ...S0926, ...missing, ...S1023);
  const carry = byMember(effectiveCarryovers(t, CUTOVER));
  assert.deepEqual(carry.a.carry, { pt10: 460, chips: 0, subtotal: 2300, balance: 2300, games: 1, days: 0 }, '12 回目の a +46 が残る');
  assert.deepEqual(carry.e.carry, zero, '9/26 だけの e は 0');
});

test('繰り越し：切替日以降の対局は減らさない。切替日が空なら繰り越しは使わない', () => {
  const after = sessionOf({
    id: 's_1107', date: CUTOVER, gameFee: 0, members: ['a', 'b', 'c', 'd'], pts: [[30, 10, -10, -30]], chips: [0, 0, 0, 0],
  });
  const t = tablesFrom(carryRows, ...S0926, ...S1002, ...S1023, ...after);
  const carry = byMember(effectiveCarryovers(t, CUTOVER));
  assert.deepEqual(carry.a.carry, zero, '切替日当日の対局は本アプリの運用分');
  const rows = byMember(aggregate(t, allSessionIds(t), Object.values(carry)));
  assert.equal(rows.a.pt10, -2290 + 300);
  assert.equal(rows.a.games, 26);
  assert.deepEqual(effectiveCarryovers(t, ''), []);
});

test('繰り越し：削除した対局は引かない。繰り越しの行がない人（ゲスト等）の過去対局はそのまま数える', () => {
  const guest = sessionOf({
    id: 's_0901', date: '2026-09-01', gameFee: 0, members: ['a', 'b', 'c', 'x'], pts: [[30, 10, -10, -30]], chips: [0, 0, 0, 0],
  });
  const t = tablesFrom(carryRows, ...S1023, ...guest, { sessions: [{ id: 's_1023', deleted: true }] });
  const carry = byMember(effectiveCarryovers(t, CUTOVER));
  assert.equal(carry.x, undefined);
  assert.equal(carry.c.carry.pt10, -460 + 100, '削除した 10/23 は引かず、9/01 の −10 だけ引く');
  const rows = byMember(aggregate(t, allSessionIds(t), Object.values(carry)));
  assert.equal(rows.x.pt10, -300, 'ゲストの 9/01 は消えない');
  assert.deepEqual(effectiveCarryovers(tablesFrom(...S1023), CUTOVER), [], '繰り越しを入れていないグループ');
});

test('繰り越し：着順の率と規定半荘数は、本アプリに入れた半荘だけで数える', () => {
  // a は本家通算 25 半荘。本アプリには 9/26（5 半荘）だけ
  const t = tablesFrom(carryRows, ...S0926);
  const carry = effectiveCarryovers(t, CUTOVER);
  const rows = byMember(aggregate(t, allSessionIds(t), carry));
  assert.equal(rows.a.games, 25, '半荘数は本家通算');
  assert.equal(rows.a.ratedGames, 5);
  assert.equal(rows.a.days, 3, '日数は本アプリの 1 日＋繰り越しの 2 日');
  assert.equal(rows.a.topRate, 0, '9/26 の a はトップなし');
  assert.equal(rows.d.topRate, 3 / 5, '9/26 の d は 1・4・5 回目がトップ（分母は本家通算の 15 でなく 5）');
  assert.deepEqual(rows.a.carried, { pt10: -2290 + 870, chips: -26, subtotal: -12300, balance: -16550, games: 20, days: 2 });
  // 本アプリに入れていない c は、率が出ない（半荘 0）
  assert.equal(rows.c.ratedGames, 0);
  assert.equal(rows.c.topRate, null);
  // 規定 5 半荘：a は届く、c は本家通算 10 半荘でも届かない
  const { ranked, below } = rankWithMinimum(Object.values(rows), (r) => r.topRate, 5);
  assert.ok(ranked.some((x) => x.row.memberId === 'a'));
  assert.ok(below.some((x) => x.row.memberId === 'c'));
});

test('繰り越し：同じ日に 2 つ対局を入れても、日数は 1 日分だけ減らす', () => {
  const second = sessionOf({
    id: 's_1023b', date: '2026-10-23', gameFee: 0, members: ['a', 'b', 'c', 'd'], pts: [[30, 10, -10, -30]], chips: [0, 0, 0, 0],
  });
  const t = tablesFrom(carryRows, ...S1023, ...second);
  const carry = byMember(effectiveCarryovers(t, CUTOVER));
  assert.equal(carry.a.entered.days, 1);
  assert.equal(carry.a.entered.games, 11);
  assert.equal(carry.a.carry.days, 2);
});

test('繰り越しが空なら、集計は今までと同じ（切替日があっても、繰り越しの行を消してあっても）', () => {
  const t = tablesFrom(...S0926, ...S1002, ...S1023);
  const ids = allSessionIds(t);
  const plain = aggregate(t, ids);
  assert.deepEqual(effectiveCarryovers(t, CUTOVER), [], '繰り越しの行がない');
  assert.deepEqual(aggregate(t, ids, effectiveCarryovers(t, CUTOVER)), plain);
  assert.ok(plain.every((r) => r.carried === null && r.ratedGames === r.games), '繰り越しの印は付かない');
  const removed = tablesFrom(...S0926, ...S1002, ...S1023, carryRows, { carryovers: carryRows.carryovers.map((r) => ({ id: r.id, deleted: true })) });
  assert.deepEqual(effectiveCarryovers(removed, CUTOVER), [], '消した繰り越しは使わない');
  assert.deepEqual(aggregate(removed, ids, effectiveCarryovers(removed, CUTOVER)), plain);
  assert.deepEqual(effectiveCarryovers(t, undefined), [], '切替日のないグループ');
});
