import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundScore, scoreToPt, parseUma, umaLabel, describeRule, normalizeRule, sum } from '../app/js/calc.js';

// 標準ルール（いつものルール）。端数は初期状態で丸めない（仕様書 6.1.1）
const standard = normalizeRule({ start_points: 25000, return_points: 30000, uma: '20,10,-10,-20', uma_oka: true, rounding: 'none' });

test('roundScore：仕様書 6.3 の表（3,400 点と 24,500 点）', () => {
  const cases = {
    none: [3400, 24500],
    round4: [3000, 25000],
    round5: [3000, 24000],
    floor: [3000, 24000],
    ceil: [4000, 25000],
  };
  for (const [mode, [a, b]] of Object.entries(cases)) {
    assert.equal(roundScore(3400, mode), a, `${mode} 3400`);
    assert.equal(roundScore(24500, mode), b, `${mode} 24500`);
  }
});

test('roundScore：マイナスの素点は絶対値で丸めて符号を戻す（仮決定）', () => {
  assert.equal(roundScore(-3400, 'round5'), -3000);
  assert.equal(roundScore(-3600, 'round5'), -4000);
  assert.equal(roundScore(-3500, 'round4'), -4000);
  assert.equal(roundScore(-3400, 'floor'), -3000);
  assert.equal(roundScore(-3400, 'ceil'), -4000);
  assert.equal(roundScore(-3400, 'none'), -3400);
  assert.equal(roundScore(-3000, 'ceil'), -3000);
});

test('scoreToPt：仕様書 6.4 例 1（丸めない）', () => {
  const r = scoreToPt([45000, 30000, 21600, 3400], standard);
  assert.deepEqual(r.ranks, [1, 2, 3, 4]);
  assert.deepEqual(r.pts10, [550, 100, -184, -466]);
});

test('scoreToPt：仕様書 6.4 例 2（五捨六入）', () => {
  const r = scoreToPt([45000, 30000, 21600, 3400], { ...standard, rounding: 'round5' });
  assert.deepEqual(r.pts10, [550, 100, -180, -470]);
});

test('scoreToPt：席順に関係なく素点の高い順に着順を付ける', () => {
  // 起家が 4 着、北家がトップ
  const r = scoreToPt([3400, 21600, 30000, 45000], { ...standard, rounding: 'round5' });
  assert.deepEqual(r.ranks, [4, 3, 2, 1]);
  assert.deepEqual(r.pts10, [-470, -180, 100, 550]);
});

test('scoreToPt：同点は上家（起家に近い席）が上位', () => {
  const r = scoreToPt([30000, 30000, 20000, 20000], standard);
  assert.deepEqual(r.ranks, [1, 2, 3, 4]);
  // 2 着 0＋10、3 着 −10−10、4 着 −10−20、トップは残り
  assert.deepEqual(r.pts10, [400, 100, -200, -300]);
});

test('scoreToPt：ウマ・オカなしは素点の差だけ（持ち点基準）', () => {
  const r = scoreToPt([40000, 30000, 20000, 10000], { ...standard, umaOka: false });
  assert.deepEqual(r.pts10, [150, 50, -50, -150]);
});

test('scoreToPt：飛び（マイナス素点）も合計 0', () => {
  const r = scoreToPt([62000, 31000, 9000, -2000], { ...standard, rounding: 'round4' });
  assert.deepEqual(r.ranks, [1, 2, 3, 4]);
  // 2 着 1＋10＝11、3 着 −21−10＝−31、4 着 −32−20＝−52、トップ 72
  assert.deepEqual(r.pts10, [720, 110, -310, -520]);
  assert.equal(sum(r.pts10), 0);
});

test('scoreToPt：ウマ 10-30・5-10 でも合計 0', () => {
  for (const uma of ['10-30', '5-10']) {
    const r = scoreToPt([45000, 30000, 21600, 3400], { ...standard, uma: parseUma(uma) });
    assert.equal(sum(r.pts10), 0, uma);
  }
  const r = scoreToPt([45000, 30000, 21600, 3400], { ...standard, uma: parseUma('10-30') });
  assert.deepEqual(r.pts10, [650, 100, -184, -566]);
});

test('parseUma：「10-20」形式と 4 つの値の形式', () => {
  assert.deepEqual(parseUma('10-20'), [200, 100, -100, -200]);
  assert.deepEqual(parseUma('10-30'), [300, 100, -100, -300]);
  assert.deepEqual(parseUma('5-10'), [100, 50, -50, -100]);
  assert.deepEqual(parseUma('20,10,-10,-20'), [200, 100, -100, -200]);
  assert.deepEqual(parseUma('30, 10, -10, -30'), [300, 100, -100, -300]);
  assert.equal(parseUma('20,10,-10'), null, '4 つない');
  assert.equal(parseUma('20,10,-10,-10'), null, '合計が 0 でない');
  assert.equal(parseUma('abc'), null);
});

test('umaLabel／describeRule：設定を 1 行で表す', () => {
  assert.equal(umaLabel([200, 100, -100, -200]), '10-20');
  assert.equal(umaLabel([300, 50, -50, -300]), '5-30');
  assert.equal(umaLabel([300, 100, -50, -350]), '30/10/-5/-35');
  assert.equal(describeRule(standard), '25,000 持ち 30,000 返し・ウマ 10-20・丸めなし');
  assert.equal(describeRule({ ...standard, rounding: 'round4' }), '25,000 持ち 30,000 返し・ウマ 10-20・四捨五入');
  assert.equal(describeRule({ ...standard, umaOka: false, rounding: 'round5' }), '25,000 持ち・ウマオカなし・五捨六入');
});

test('normalizeRule：シートの行（文字列や欠けた列）を計算用の形にする', () => {
  assert.deepEqual(normalizeRule({ start_points: 25000, return_points: 30000, uma: '20,10,-10,-20', rounding: 'round5' }),
    { start: 25000, ret: 30000, uma: [200, 100, -100, -200], umaOka: true, rounding: 'round5' });
  // uma_oka が FALSE ならウマ・オカなし。読めない rounding は丸めない
  assert.deepEqual(normalizeRule({ start_points: 25000, return_points: 30000, uma: '', uma_oka: false, rounding: 'x' }),
    { start: 25000, ret: 30000, uma: [0, 0, 0, 0], umaOka: false, rounding: 'none' });
});
