import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePt, formatPt, sum, fillMissing, rankByPt,
  splitEvenly, allocateFees, ptToMoney, settle, summarizeSession,
} from '../app/js/calc.js';

test('parsePt：現場の書き方を pt10 に変換する', () => {
  assert.equal(parsePt('+20'), 200);
  assert.equal(parsePt('-32'), -320);
  assert.equal(parsePt('55'), 550);
  assert.equal(parsePt('-26.6'), -266);
  assert.equal(parsePt('0'), 0);
  assert.equal(parsePt(' −１８ '), -180); // 全角マイナス・全角数字
  assert.equal(parsePt('＋5.5'), 55);
});

test('parsePt：読めない入力は null', () => {
  for (const s of ['', '+', 'abc', '1.25', '--3', '3-', null, undefined]) {
    assert.equal(parsePt(s), null, String(s));
  }
});

test('formatPt：符号付き、小数 0 は省く', () => {
  assert.equal(formatPt(550), '+55');
  assert.equal(formatPt(-266), '-26.6');
  assert.equal(formatPt(0), '0');
  assert.equal(formatPt(5), '+0.5');
  assert.equal(formatPt(-5), '-0.5');
});

test('fillMissing：3 人入れたら 4 人目を補完する（仕様書 6.4 の pt）', () => {
  assert.deepEqual(fillMissing([550, 100, -180, null]), [550, 100, -180, -470]);
  assert.deepEqual(fillMissing([null, 100, -180, -470]), [550, 100, -180, -470]);
});

test('fillMissing：素点なら合計 100,000 に合わせる', () => {
  assert.deepEqual(fillMissing([45000, 30000, null, 3400], 100000), [45000, 30000, 21600, 3400]);
});

test('fillMissing：空が 2 つ以上なら補完しない、0 なら写しを返す', () => {
  assert.equal(fillMissing([550, null, null, -470]), null);
  const full = [550, 100, -180, -470];
  const out = fillMissing(full);
  assert.deepEqual(out, full);
  assert.notEqual(out, full);
});

test('rankByPt：pt の高い順、同 pt は列順が前の人が上', () => {
  assert.deepEqual(rankByPt([100, 550, -180, -470]), [2, 1, 3, 4]);
  assert.deepEqual(rankByPt([0, 0, 0, 0]), [1, 2, 3, 4]);
  assert.deepEqual(rankByPt([-100, 200, 200, -300]), [3, 1, 2, 4]);
});

test('splitEvenly：10P 単位に切り捨て、余りは先頭（仕様書 7.2 の例）', () => {
  assert.deepEqual(splitEvenly(4450, 4), [1120, 1110, 1110, 1110]);
  assert.deepEqual(splitEvenly(9000, 4), [2250, 2250, 2250, 2250]);
  assert.deepEqual(splitEvenly(10000, 3), [3340, 3330, 3330]);
  assert.deepEqual(splitEvenly(0, 4), [0, 0, 0, 0]);
  assert.deepEqual(splitEvenly(9000, 0), []);
});

test('allocateFees：手入力分を引いた残りを自動の人で割る', () => {
  assert.deepEqual(allocateFees(9000, [null, null, null, null]), [2250, 2250, 2250, 2250]);
  assert.deepEqual(allocateFees(9000, [3000, null, null, null]), [3000, 2000, 2000, 2000]);
  // 余りは「自動の人」の先頭に寄せる（手入力の人には足さない）
  assert.deepEqual(allocateFees(4450, [1000, null, null, null]), [1000, 1150, 1150, 1150]);
  assert.deepEqual(allocateFees(4460, [1000, null, null, null]), [1000, 1160, 1150, 1150]);
  assert.deepEqual(allocateFees(9000, [3000, 2000, 2000, 2000]), [3000, 2000, 2000, 2000]);
});

test('ptToMoney：小数 pt でも誤差なく金額にする', () => {
  assert.equal(ptToMoney(-320, 50), -1600);
  assert.equal(ptToMoney(-266, 50), -1330);
  assert.equal(ptToMoney(5, 50), 25);
  assert.equal(ptToMoney(-5, 25), -13); // -12.5 は 0 から遠い側へ
  assert.equal(ptToMoney(5, 25), 13);
});

// 公開リポジトリのため、テストでは実在メンバーの名前を使わない（A〜D で表す）
test('settle：仕様書 7.1 の例', () => {
  // −32 × 50 ＋ (−11) × 200 ＝ −3,800、ゲーム代 9,000 ÷ 4 ＝ 2,250 を引いて −6,050
  assert.deepEqual(
    settle({ pt10: -320, chips: -11, rate: 50, chipRate: 200, fee: 2250 }),
    { ptMoney: -1600, chipMoney: -2200, subtotal: -3800, balance: -6050 },
  );
});

test('settle：2026/10/23 の 4 人分が本家の表示と一致する', () => {
  // 本家の画面：計 / チップ / 収支（小計） / 収支（ゲーム代 9,000、レート 50、チップ 200）
  const cases = [
    { pt: -32, chips: -11, subtotal: -3800, balance: -6050 },
    { pt: 74, chips: 12, subtotal: 6100, balance: 3850 },
    { pt: -46, chips: -6, subtotal: -3500, balance: -5750 },
    { pt: 4, chips: 5, subtotal: 1200, balance: -1050 },
  ];
  const fees = allocateFees(9000, [null, null, null, null]);
  cases.forEach((c, i) => {
    const r = settle({ pt10: c.pt * 10, chips: c.chips, rate: 50, chipRate: 200, fee: fees[i] });
    assert.equal(r.subtotal, c.subtotal, `${i}: subtotal`);
    assert.equal(r.balance, c.balance, `${i}: balance`);
  });
});

// 入力表 1 行分（列順の pt）から、着順付きの半荘を作る
function hanchan(memberIds, pts) {
  const present = memberIds.filter((_, i) => pts[i] != null);
  const ptsPresent = pts.filter((p) => p != null).map((p) => p * 10);
  const ranks = rankByPt(ptsPresent);
  return { results: present.map((memberId, i) => ({ memberId, pt10: ptsPresent[i], rank: ranks[i] })) };
}

test('summarizeSession：pt −32・チップ −11 の人は収支 −6,050', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const result = summarizeSession({
    session: { rate: 50, chipRate: 200, gameFee: 9000 },
    participants: [
      { memberId: 'a', chips: -11, feeShare: null },
      { memberId: 'b', chips: 5, feeShare: null },
      { memberId: 'c', chips: 3, feeShare: null },
      { memberId: 'd', chips: 3, feeShare: null },
    ],
    hanchans: [
      hanchan(ids, [-47, 55, 10, -18]),
      hanchan(ids, [25, -30, 40, -35]),
      hanchan(ids, [-10, 30, -5, -15]),
    ],
  });

  const oku = result[0];
  assert.equal(oku.games, 3);
  assert.equal(oku.pt10, -320);
  assert.deepEqual(oku.rankCounts, [0, 1, 1, 1]);
  assert.equal(oku.fee, 2250);
  assert.equal(oku.subtotal, -3800);
  assert.equal(oku.balance, -6050);

  // 全員の収支（小計）の合計は 0、収支の合計はゲーム代の分だけマイナス
  assert.equal(sum(result.map((r) => r.subtotal)), 0);
  assert.equal(sum(result.map((r) => r.balance)), -9000);
  assert.deepEqual(result.map((r) => r.games), [3, 3, 3, 3]);
});

test('summarizeSession：5 人なら抜け番の半荘は数えない', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const result = summarizeSession({
    session: { rate: 50, chipRate: 200, gameFee: 10000 },
    participants: ids.map((memberId) => ({ memberId, chips: 0, feeShare: null })),
    hanchans: [
      hanchan(ids, [30, 10, -15, -25, null]),
      hanchan(ids, [null, 20, 5, -5, -20]),
    ],
  });
  assert.deepEqual(result.map((r) => r.games), [1, 2, 2, 2, 1]);
  assert.deepEqual(result.map((r) => r.pt10), [300, 300, -100, -300, -200]);
  assert.deepEqual(result.map((r) => r.fee), [2000, 2000, 2000, 2000, 2000]);
  assert.deepEqual(result[4].rankCounts, [0, 0, 0, 1]);
});
