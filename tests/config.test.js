import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEntry, mergeKey, groupChoices } from '../app/js/config.js';

const A = { id: 'g_a', name: 'いつもの' };
const B = { id: 'g_b', name: '金曜の卓' };

test('keyEntry：メンバーの合言葉は自分のグループ、管理者の合言葉は全グループを開ける', () => {
  assert.deepEqual(keyEntry('pa', { role: 'member', group: { ...A, min_games: 10 }, groups: null }),
    { passcode: 'pa', role: 'member', groups: [A] });
  assert.deepEqual(keyEntry('adm', { role: 'admin', group: A, groups: [{ ...A, has_passcode: true }, B] }),
    { passcode: 'adm', role: 'admin', groups: [A, B] });
  // role を返さない古い GAS はメンバー扱い
  assert.deepEqual(keyEntry('pa', { group: A }), { passcode: 'pa', role: 'member', groups: [A] });
});

test('mergeKey：足す・同じ合言葉は書き直す', () => {
  let keys = mergeKey([], { passcode: 'pa', role: 'member', groups: [A] });
  keys = mergeKey(keys, { passcode: 'pb', role: 'member', groups: [B] });
  assert.deepEqual(keys.map((k) => k.passcode), ['pa', 'pb']);
  // v0.6.0 までの端末の合言葉（開けるグループがまだ分からない）は、接続できたら書き直す
  keys = mergeKey([{ passcode: 'adm', role: 'member', groups: [] }], { passcode: 'adm', role: 'admin', groups: [A, B] });
  assert.deepEqual(keys, [{ passcode: 'adm', role: 'admin', groups: [A, B] }]);
});

test('mergeKey：同じグループの別の合言葉は、付け替え前の古いものとして外す', () => {
  const keys = [
    { passcode: 'old', role: 'member', groups: [A] },
    { passcode: 'pb', role: 'member', groups: [B] },
    { passcode: 'adm', role: 'admin', groups: [A, B] },
  ];
  const renewed = mergeKey(keys, { passcode: 'new', role: 'member', groups: [A] });
  assert.deepEqual(renewed.map((k) => k.passcode), ['pb', 'adm', 'new'], 'いつものの古い合言葉だけ外れ、管理者の合言葉は残る');
  const admin = mergeKey(keys, { passcode: 'adm2', role: 'admin', groups: [A, B] });
  assert.deepEqual(admin.map((k) => k.passcode), ['old', 'pb', 'adm2'], '管理者の合言葉は 1 つだけ');
});

test('groupChoices：開けるグループの一覧。同じグループは管理者の合言葉を使う', () => {
  assert.deepEqual(groupChoices([{ passcode: 'pa', role: 'member', groups: [A] }]),
    [{ groupId: 'g_a', name: 'いつもの', passcode: 'pa', role: 'member' }], '合言葉 1 つ・1 グループなら 1 件（切り替えは出さない）');
  const both = groupChoices([
    { passcode: 'pa', role: 'member', groups: [A] },
    { passcode: 'adm', role: 'admin', groups: [A, B] },
  ]);
  assert.deepEqual(both.map((c) => [c.groupId, c.passcode]), [['g_a', 'adm'], ['g_b', 'adm']]);
  assert.deepEqual(groupChoices([{ passcode: 'x', role: 'member', groups: [] }]), [], 'まだ接続していない合言葉');
});
