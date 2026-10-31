import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, DEFAULT_MIN_GAMES } from '../app/js/store.js';

// GAS の代わり。load の応答を差し替えられる
function fakeStore(loadResponse) {
  const api = {
    load: async () => loadResponse,
    save: async () => ({ ok: true }),
  };
  return new Store({ api, getConfig: () => ({ gasUrl: 'https://example.invalid/exec', passcode: 'x' }) });
}

const emptyData = { members: [], group_members: [], rules: [], sessions: [], participants: [], hanchans: [], results: [] };

test('Store：役割と規定半荘数を load の応答から読む', async () => {
  const member = fakeStore({ ok: true, role: 'member', groups: null, group: { id: 'g_itsumo', name: 'いつもの', min_games: null }, data: emptyData });
  await member.sync();
  assert.equal(member.isAdmin, false);
  assert.equal(member.groups, null);
  assert.equal(member.minGames, DEFAULT_MIN_GAMES, '未設定なら 10');

  const admin = fakeStore({
    ok: true, role: 'admin', group: { id: 'g_itsumo', name: 'いつもの', min_games: 12 },
    groups: [{ id: 'g_itsumo', name: 'いつもの', min_games: 12 }, { id: 'g_2', name: '別の卓', min_games: null }], data: emptyData,
  });
  await admin.sync();
  assert.equal(admin.isAdmin, true);
  assert.equal(admin.minGames, 12);
  assert.deepEqual(admin.groups.map((g) => g.name), ['いつもの', '別の卓']);
});

test('Store：今の版の GAS（role を返さない）ではメンバー扱い。0 半荘も規定にできる', async () => {
  const old = fakeStore({ ok: true, group: { id: 'g_itsumo', name: 'いつもの' }, data: emptyData });
  await old.sync();
  assert.equal(old.isAdmin, false);
  assert.equal(old.minGames, DEFAULT_MIN_GAMES);
  const zero = fakeStore({ ok: true, role: 'member', group: { id: 'g', name: 'x', min_games: 0 }, data: emptyData });
  await zero.sync();
  assert.equal(zero.minGames, 0);
});

test('Store.applyGroups：グループの管理の結果で、一覧と表示中のグループの設定を更新する', async () => {
  const s = fakeStore({ ok: true, role: 'admin', group: { id: 'g_itsumo', name: 'いつもの', min_games: null }, groups: [], data: emptyData });
  await s.sync();
  const kinds = [];
  s.subscribe((k) => kinds.push(k));
  s.applyGroups({ group: { id: 'g_itsumo', name: 'いつもの', min_games: 15 }, groups: [{ id: 'g_itsumo', name: 'いつもの', min_games: 15 }] });
  assert.equal(s.minGames, 15);
  assert.equal(s.groups.length, 1);
  assert.deepEqual(kinds, ['data'], '画面を作り直す');
  // 別のグループの変更では、表示中のグループは変わらない
  s.applyGroups({ group: { id: 'g_2', name: '別の卓', min_games: 3 }, groups: [] });
  assert.equal(s.minGames, 15);
});
