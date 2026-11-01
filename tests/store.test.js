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

// ---- グループごとの置き場と切り替え ----

// localStorage の代わり
function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}

const GROUPS = { g_a: { id: 'g_a', name: 'いつもの' }, g_b: { id: 'g_b', name: '金曜の卓' } };
const PASS = { pa: 'g_a', pb: 'g_b' };
const CHOICES = [
  { groupId: 'g_a', name: 'いつもの', passcode: 'pa', role: 'member' },
  { groupId: 'g_b', name: '金曜の卓', passcode: 'pb', role: 'member' },
];

// 2 グループの GAS。合言葉でグループが決まり、対局が 1 つずつある。offline にすると通信できない
function twoGroups({ config, storage = memoryStorage(), remember } = {}) {
  const gas = { calls: [], offline: false, hold: null };
  const api = {
    save: async (c, records) => {
      if (gas.offline) throw Object.assign(new Error('通信できません'), { network: true });
      gas.calls.push({ action: 'save', passcode: c.passcode, groupId: c.groupId, records });
      if (gas.hold) await gas.hold;
      return { ok: true };
    },
    load: async (c) => {
      if (gas.offline) throw Object.assign(new Error('通信できません'), { network: true });
      const id = PASS[c.passcode];
      gas.calls.push({ action: 'load', passcode: c.passcode });
      return { ok: true, role: 'member', group: GROUPS[id], groups: null, data: { ...emptyData, sessions: [{ id: `s_${id}`, group_id: id }] } };
    },
  };
  const store = new Store({ api, getConfig: () => config, choices: () => CHOICES, remember, storage });
  return { store, gas, storage };
}

const sessionIds = (s) => s.list('sessions').map((r) => r.id).sort();

test('Store：v0.6.0 までの置き場を、そのグループの置き場に移す（送信待ちも残す）', () => {
  const legacy = { server: { sessions: { s1: { id: 's1' } } }, outbox: { sessions: { s2: { id: 's2' } } }, group: GROUPS.g_a, role: 'admin', groups: null, lastSync: 't' };
  const storage = memoryStorage({ 'mjroku.store': JSON.stringify(legacy) });
  const { store } = twoGroups({ config: { gasUrl: 'u', passcode: 'pa', groupId: '' }, storage });
  assert.equal(store.slotId, 'g_a');
  assert.equal(storage.getItem('mjroku.store'), null);
  assert.ok(storage.getItem('mjroku.store.g_a'));
  assert.deepEqual(sessionIds(store), ['s1', 's2']);
  assert.equal(store.pendingCount(), 1);
  assert.equal(store.isAdmin, true);
});

test('Store：初めての接続（グループがまだ分からない）は、load で分かったグループの置き場に移る', async () => {
  const remembered = [];
  const { store, storage } = twoGroups({ config: { gasUrl: 'u', passcode: 'pb', groupId: '' }, remember: (c, res) => remembered.push([c.passcode, res.group.id]) });
  await store.sync();
  assert.equal(store.slotId, 'g_b');
  assert.ok(storage.getItem('mjroku.store.g_b'));
  assert.equal(storage.getItem('mjroku.store.'), null);
  assert.deepEqual(remembered, [['pb', 'g_b']], '合言葉で開けるグループを覚える');
});

test('Store：グループを切り替えると、データも送信待ちもグループごとに分かれる', async () => {
  const config = { gasUrl: 'u', passcode: 'pa', groupId: 'g_a' };
  const { store, gas } = twoGroups({ config });
  await store.sync();
  assert.deepEqual(sessionIds(store), ['s_g_a']);

  // 電波がない所で、いつものに対局を入れる
  gas.offline = true;
  store.write({ sessions: [{ id: 's_new', group_id: 'g_a' }] });
  await store.sync();
  assert.equal(store.pendingCount(), 1);

  // 金曜の卓に切り替える：前のグループのデータは見えない。送信待ちは全体の件数に残る
  Object.assign(config, { passcode: 'pb', groupId: 'g_b' });
  await store.switchTo();
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.totalPending(), 1);
  assert.deepEqual(sessionIds(store), [], '電波がないので金曜の卓はまだ空');

  // 電波が戻ると、いつものの送信待ちをいつものの合言葉で送り、金曜の卓を読み込む
  gas.offline = false;
  await store.sync();
  const save = gas.calls.find((c) => c.action === 'save');
  assert.deepEqual([save.passcode, save.groupId], ['pa', 'g_a']);
  assert.deepEqual(save.records.sessions.map((r) => r.id), ['s_new']);
  assert.equal(store.totalPending(), 0);
  assert.deepEqual(sessionIds(store), ['s_g_b']);
  assert.equal(store.group.id, 'g_b');

  // 戻すと、端末に置いたいつものデータがすぐ見える（送った行も入っている）
  Object.assign(config, { passcode: 'pa', groupId: 'g_a' });
  const back = store.switchTo();
  assert.deepEqual(sessionIds(store), ['s_g_a', 's_new']);
  await back;
});

test('Store：送っている間に切り替えても、送った行は元のグループの送信待ちから外れ、前のグループの load は捨てる', async () => {
  const config = { gasUrl: 'u', passcode: 'pa', groupId: 'g_a' };
  const { store, gas } = twoGroups({ config });
  await store.sync();
  let release;
  gas.hold = new Promise((r) => { release = r; });
  store.write({ sessions: [{ id: 's_new', group_id: 'g_a' }] });
  const first = store.syncPromise;
  await new Promise((r) => setTimeout(r, 0)); // save が GAS に届いた所で止まっている

  Object.assign(config, { passcode: 'pb', groupId: 'g_b' });
  store.switchTo();
  gas.hold = null;
  release();
  await first;

  assert.equal(store.group.id, 'g_b', '金曜の卓を表示している');
  assert.deepEqual(sessionIds(store), ['s_g_b']);
  assert.equal(store.pendingFor('g_a'), 0, 'いつものの送信待ちは送り済み');
  assert.equal(gas.calls.filter((c) => c.action === 'load' && c.passcode === 'pa').length, 1, '切り替え後に pa で読み直していない');
});

test('Store：表示中でないグループを送れなくても、表示中のグループの同期は続ける', async () => {
  const config = { gasUrl: 'u', passcode: 'pb', groupId: 'g_b' };
  const storage = memoryStorage({ 'mjroku.store.g_a': JSON.stringify({ outbox: { sessions: { s_x: { id: 's_x' } } } }) });
  const { store } = twoGroups({ config, storage });
  const save = store.api.save;
  store.api.save = async (c, r) => { if (c.passcode === 'pa') throw new Error('合言葉が違います'); return save(c, r); };
  await store.sync();
  assert.equal(store.error, null);
  assert.deepEqual(sessionIds(store), ['s_g_b']);
  assert.equal(store.otherErrors.g_a, '合言葉が違います');
  assert.equal(store.totalPending(), 1);
});

test('Store：送信待ちが多いときは分けて送る。途中で切れても届いた回の分は外れる', async () => {
  const config = { gasUrl: 'u', passcode: 'pa', groupId: 'g_a' };
  const { store, gas } = twoGroups({ config });
  await store.sync();
  // 対局 1 つ・半荘 1 つ＋成績 449 行（取り込みの大きさ）
  const results = Array.from({ length: 449 }, (_, i) => ({ id: `r_${i}`, hanchan_id: 'h_1' }));
  gas.offline = true;
  store.write({ results, hanchans: [{ id: 'h_1', session_id: 's_big' }], sessions: [{ id: 's_big', group_id: 'g_a' }] });
  await store.sync();
  assert.equal(store.pendingCount(), 451);
  // 2 回目の save で通信が切れる
  gas.offline = false;
  let saves = 0;
  const save = store.api.save;
  store.api.save = async (c, r) => { saves += 1; if (saves === 2) throw Object.assign(new Error('時間切れ'), { network: true }); return save(c, r); };
  await store.sync();
  const first = gas.calls.filter((c) => c.action === 'save')[0].records;
  assert.deepEqual(Object.keys(first), ['sessions', 'hanchans', 'results'], '親の対局・半荘が先');
  assert.equal(Object.values(first).flat().length, 200);
  assert.equal(store.pendingCount(), 251, '1 回目の 200 行は外れた');
  store.api.save = save;
  await store.sync();
  assert.equal(store.pendingCount(), 0);
  assert.deepEqual(gas.calls.filter((c) => c.action === 'save').map((c) => Object.values(c.records).flat().length), [200, 200, 51]);
});

test('Store：シートで行ごと消した対局は、同期で端末からも消える。消えた対局への送信待ちは外して、読み込みは止めない', async () => {
  const config = { gasUrl: 'u', passcode: 'pa', groupId: 'g_a' };
  const sheet = { sessions: [{ id: 's_test', group_id: 'g_a', date: '2026-10-29' }], participants: [{ id: 's_test:m_k', session_id: 's_test', member_id: 'm_k' }], members: [{ id: 'm_k', name: 'テスト' }] };
  const calls = [];
  const api = {
    load: async () => ({ ok: true, role: 'admin', group: { id: 'g_a', name: 'いつもの' }, groups: [], data: { ...emptyData, ...sheet } }),
    // 本物の GAS と同じく、シートに無い対局の参加者は「グループ外」として断る
    save: async (c, records) => {
      calls.push(records);
      const ids = new Set(sheet.sessions.map((s) => s.id).concat((records.sessions || []).map((s) => s.id)));
      if ((records.participants || []).some((p) => !ids.has(p.session_id ?? sheet.participants.find((x) => x.id === p.id)?.session_id))) {
        throw new Error('グループ外のデータ: participants');
      }
      return { ok: true };
    },
  };
  const store = new Store({ api, getConfig: () => config, storage: memoryStorage() });
  await store.sync();
  assert.deepEqual(store.list('sessions').map((s) => s.id), ['s_test']);

  // 端末でチップを直した（まだ送っていない）間に、シートで行ごと消された
  const gasSave = api.save;
  store.api.save = async () => { throw Object.assign(new Error('通信できません'), { network: true }); };
  store.write({ participants: [{ id: 's_test:m_k', chips: 5 }], members: [{ id: 'm_new', name: '新しい人' }] });
  await store.sync();
  assert.equal(store.pendingCount(), 2);
  sheet.sessions = [];
  sheet.participants = [];
  sheet.members = [];

  // 電波がない間は、端末のデータを残す（シートを読めていないので）
  await store.sync();
  assert.deepEqual(store.list('sessions').map((s) => s.id), ['s_test']);

  // 電波が戻る：消えた対局への変更は GAS に断られるが、読み込みはして、端末からも消す
  store.api.save = gasSave;
  await store.sync();
  assert.deepEqual(store.list('sessions'), [], '消した対局は端末にも無い');
  assert.deepEqual(store.list('participants'), []);
  assert.equal(store.pendingCount(), 0, '消えた対局への変更は外し、新しいメンバーは送った');
  assert.match(store.notice, /シートで消えた行への変更 1 件/);
  assert.equal(store.error, null);
  assert.deepEqual(calls.at(-1).members.map((m) => m.id), ['m_new']);
});

test('pruneOrphans：シートにある行への変更と、新しく作った行は残す', async () => {
  const { pruneOrphans } = await import('../app/js/store.js');
  const server = { ...Object.fromEntries(['members', 'group_members', 'rules', 'sessions', 'participants', 'hanchans', 'results', 'carryovers'].map((s) => [s, {}])),
    sessions: { s_1: { id: 's_1' } }, hanchans: { h_1: { id: 'h_1', session_id: 's_1' } } };
  const outbox = {
    sessions: { s_1: { id: 's_1', title: '直した' }, s_new: { id: 's_new', created_at: 't', group_id: 'g' }, s_gone: { id: 's_gone', title: 'x' } },
    participants: { 's_new:m': { id: 's_new:m', created_at: 't', session_id: 's_new' }, 's_gone2:m': { id: 's_gone2:m', created_at: 't', session_id: 's_gone2' } },
    hanchans: { h_1: { id: 'h_1', input_mode: 'pt' } },
    results: { 'h_1:m': { id: 'h_1:m', created_at: 't', hanchan_id: 'h_1' }, 'h_x:m': { id: 'h_x:m', created_at: 't', hanchan_id: 'h_x' } },
  };
  assert.equal(pruneOrphans(server, outbox), 3);
  assert.deepEqual(Object.keys(outbox.sessions), ['s_1', 's_new']);
  assert.deepEqual(Object.keys(outbox.participants), ['s_new:m']);
  assert.deepEqual(Object.keys(outbox.hanchans), ['h_1']);
  assert.deepEqual(Object.keys(outbox.results), ['h_1:m']);
});
