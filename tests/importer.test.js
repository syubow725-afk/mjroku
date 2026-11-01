import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlay, addToOutbox, emptyTables } from '../app/js/store.js';
import { readImportFile, checkSession, planImport, importChanges, verifyImported, importIds, stableCode } from '../app/js/importer.js';
import { sessionChanges, effectiveCarryovers } from '../app/js/model.js';

// 本家からの一括取り込み。実データ（移行データ/）は公開しないので、検算 1・2 を作り物の名前で使う

// 検算 2：2026/9/26（ゲーム代 4,450 → 本家の負担 1,120／1,110／1,110／1,110）
const K2 = {
  date: '2026-09-26', creator: 'A', rate: 50, chip_rate: 200, game_fee: 4450,
  players: ['A', 'B', 'E', 'D'],
  hanchans: [[-48, -12, 12, 48], [-25, 7, 58, -40], [15, 55, -46, -24], [3, -19, -41, 57], [-32, -44, 0, 76]],
  chips: [-3, 0, 0, 3],
  fee_shares: [1120, 1110, 1110, 1110],
  check: { total: [-87, -13, -17, 117], balance: [-6070, -1760, -1960, 5340] },
  source_file: '005.mhtml',
};

// 検算 1：2026/10/23
const K1 = {
  date: '2026-10-23', creator: 'A', rate: 50, chip_rate: 200, game_fee: 9000,
  players: ['A', 'B', 'C', 'D'],
  hanchans: [
    [-52, -23, 69, 6], [-24, 74, 8, -58], [46, -53, -7, 14], [11, 49, -43, -17], [-35, -18, 6, 47],
    [-18, 36, -21, 3], [-39, 4, 62, -27], [-17, 14, -41, 44], [47, 11, -43, -15], [49, -20, -36, 7],
  ],
  chips: [-11, 12, -6, 5],
  fee_shares: [2250, 2250, 2250, 2250],
  check: { total: [-32, 74, -46, 4], balance: [-6050, 3850, -5750, -1050] },
  source_file: '01.mhtml',
};

// 別のグループの対局（5 人打ち・抜け番あり。検算 3 の前半 4 半荘を使い、計と収支はこの 4 半荘の値）
const OTHER = {
  date: '2026-04-03', creator: 'A', rate: 50, chip_rate: 100, game_fee: 0,
  players: ['A', 'F', 'G', 'H', 'X'],
  hanchans: [[-57, 8, -14, 63, null], [41, null, -18, -29, 6], [null, -21, 57, 7, -43], [-7, 45, -51, null, 13]],
  chips: [0, 0, 0, 0, 0],
  fee_shares: [0, 0, 0, 0, 0],
  check: { total: [-23, 32, -26, 41, -24], balance: [-1150, 1600, -1300, 2050, -1200] },
  source_file: '017.mhtml',
};

const FILE = JSON.stringify({
  version: 1,
  groups: { 'いつもの': [K2, K1], '別の卓': [OTHER] },
  pending_3ma: [{ date: '2026-09-27', players: ['A', 'B', 'D'] }],
  members: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'],
});

const ITSUMO = { id: 'g_itsumo', name: 'いつもの', cutover_date: '2026-11-07' };

function counter() {
  let n = 0;
  return () => `m_new${String(++n).padStart(5, '0')}`;
}

function apply(tables, changes) {
  const outbox = emptyTables();
  for (const [sheet, rows] of Object.entries(changes)) {
    for (const row of rows) addToOutbox(outbox, sheet, { created_at: 't', deleted: false, ...row });
  }
  return overlay(tables, outbox);
}

// いつもののメンバー A・B が既にいる状態
function itsumoTables() {
  return apply(emptyTables(), {
    members: [{ id: 'm_a', name: 'A', aliases: '' }, { id: 'm_b', name: 'Bさん', aliases: 'B' }],
    group_members: [{ id: 'g_itsumo:m_a', group_id: 'g_itsumo', member_id: 'm_a' }, { id: 'g_itsumo:m_b', group_id: 'g_itsumo', member_id: 'm_b' }],
  });
}

test('readImportFile：取り込み用でないファイルは断る', () => {
  assert.throws(() => readImportFile('{'), /JSON として読めません/);
  assert.throws(() => readImportFile('{"version":2,"groups":{}}'), /取り込み用のファイルではありません/);
  assert.equal(readImportFile(FILE).groups['いつもの'].length, 2);
});

test('checkSession：検算 1・2 は本家の計と収支に一致する。合わないものは理由を返す', () => {
  assert.deepEqual(checkSession(K1), []);
  assert.deepEqual(checkSession(K2), []);
  assert.deepEqual(checkSession(OTHER), [], '5 人打ち・抜け番あり');
  // fee_shares がなければ自動の割り方（本家と同じ）で 4,450 → 1,120／1,110／1,110／1,110
  assert.deepEqual(checkSession({ ...K2, fee_shares: null }), []);
  const bad = (patch) => checkSession({ ...K2, ...patch });
  assert.ok(bad({ hanchans: [[-48, -12, 12, 47], ...K2.hanchans.slice(1)] }).some((e) => e.includes('1 回目：合計が 0 でない')));
  assert.ok(bad({ hanchans: [[-48, -12, 12, null], ...K2.hanchans.slice(1)] }).some((e) => e.includes('4 人でない')));
  assert.ok(bad({ check: { total: [-86, -13, -17, 117], balance: K2.check.balance } }).some((e) => e.includes('A：計が本家（-86）と違う')));
  assert.ok(bad({ check: { total: K2.check.total, balance: [-6080, -1760, -1960, 5340] } }).some((e) => e.includes('A：収支 -6070 が本家（-6080）と違う')));
  assert.ok(bad({ fee_shares: [1110, 1110, 1110, 1110] }).some((e) => e.includes('合計がゲーム代と違う')));
  assert.ok(bad({ chips: [0, 0, 0] }).some((e) => e.includes('chips の人数')));
  assert.ok(bad({ date: '9/26' }).some((e) => e.includes('日付')));
});

test('planImport：表示中のグループの分だけを取り込む。名前は既存のメンバー（別名も）を使い、いなければ作る', () => {
  const plan = planImport(readImportFile(FILE), { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  assert.deepEqual(plan.items.map((i) => [i.source.date, i.status]), [['2026-09-26', 'import'], ['2026-10-23', 'import']]);
  assert.equal(plan.members.get('A').id, 'm_a');
  assert.equal(plan.members.get('B').id, 'm_b', '別名で見つける');
  assert.deepEqual(plan.newMembers, ['E', 'D', 'C']);
  assert.deepEqual(plan.otherGroups, ['別の卓']);
  assert.equal(plan.pending, 1, '3 麻は取り込まない');
});

test('importChanges → verifyImported：取り込んだ行から計算し直して、全対局の計と収支が本家と一致する', () => {
  const data = readImportFile(FILE);
  const plan = planImport(data, { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  const changes = importChanges(plan);
  assert.deepEqual(changes.members.map((m) => m.name), ['E', 'D', 'C']);
  assert.deepEqual(changes.group_members.map((g) => g.group_id), ['g_itsumo', 'g_itsumo', 'g_itsumo']);
  assert.equal(changes.sessions.length, 2);
  assert.equal(changes.hanchans.length, 15);
  assert.equal(changes.results.length, 60);
  const s = changes.sessions.find((x) => x.date === '2026-09-26');
  assert.equal(s.group_id, 'g_itsumo');
  assert.equal(s.created_by, 'A（本家から取り込み）');
  assert.equal(s.rule_name, 'いつものルール');
  assert.deepEqual(changes.participants.filter((p) => p.session_id === s.id).map((p) => p.fee_share), [1120, 1110, 1110, 1110]);

  const tables = apply(itsumoTables(), changes);
  const result = verifyImported(plan, tables);
  assert.deepEqual(result.map((r) => [r.item.source.date, r.ok, r.diffs]), [['2026-09-26', true, []], ['2026-10-23', true, []]]);

  // 取り込んだ後に半荘を 1 つ消すと、検算で分かる
  const broken = apply(tables, { hanchans: [{ id: importIds('g_itsumo', K1).hanchanId(10), deleted: true }] });
  const after = verifyImported(plan, broken).find((r) => r.item.source.date === '2026-10-23');
  assert.equal(after.ok, false);
  assert.ok(after.diffs.includes('半荘の数 9（本家 10）'));
});

test('同じ対局を 2 回取り込まない：取り込み済みは飛ばし、新しいメンバーも作らない', () => {
  const data = readImportFile(FILE);
  const plan = planImport(data, { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  const tables = apply(itsumoTables(), importChanges(plan));
  const again = planImport(data, { tables, group: ITSUMO, newId: counter() });
  assert.deepEqual(again.items.map((i) => i.status), ['imported', 'imported']);
  assert.deepEqual(again.newMembers, []);
  assert.deepEqual(importChanges(again), { members: [], group_members: [], sessions: [], participants: [], hanchans: [], results: [] });
  assert.ok(verifyImported(again, tables).every((r) => r.ok), '取り込み済みの分も検算できる');
  // 削除した後でも、もう一度は入れない（復元は管理者が対局の画面で行う）
  const deleted = apply(tables, { sessions: [{ id: importIds('g_itsumo', K2).sessionId, deleted: true }] });
  assert.equal(planImport(data, { tables: deleted, group: ITSUMO, newId: counter() }).items[0].status, 'imported');
  // ID は元ファイル名とグループで決まる
  assert.equal(importIds('g_itsumo', K2).sessionId, importIds('g_itsumo', { ...K2, hanchans: [] }).sessionId);
  assert.notEqual(importIds('g_itsumo', K2).sessionId, importIds('g_other', K2).sessionId);
  assert.match(importIds('g_itsumo', K2).sessionId, /^s_[a-z0-9]{10}$/);
  assert.match(stableCode(''), /^[a-z0-9]{10}$/);
});

test('同じ日・同じ顔ぶれの対局が手入力で入っていれば取り込まない。切替日以降も取り込まない', () => {
  const data = readImportFile(FILE);
  // 10/23 を A・B・C・D で手入力済み（C・D は既存メンバー）
  const manual = apply(itsumoTables(), {
    members: [{ id: 'm_c', name: 'C' }, { id: 'm_d', name: 'D' }],
    group_members: [{ id: 'g_itsumo:m_c', group_id: 'g_itsumo', member_id: 'm_c' }, { id: 'g_itsumo:m_d', group_id: 'g_itsumo', member_id: 'm_d' }],
    ...sessionChanges({ session: { id: 's_manual0001', group_id: 'g_itsumo', date: '2026-10-23' }, memberIds: ['m_a', 'm_b', 'm_c', 'm_d'] }),
  });
  let plan = planImport(data, { tables: manual, group: ITSUMO, newId: counter() });
  assert.deepEqual(plan.items.map((i) => i.status), ['import', 'duplicate']);
  assert.deepEqual(plan.newMembers, ['E'], '取り込まない対局にしか出ない人は作らない');
  plan = planImport(data, { tables: itsumoTables(), group: { ...ITSUMO, cutover_date: '2026-10-01' }, newId: counter() });
  assert.deepEqual(plan.items.map((i) => i.status), ['import', 'after']);
  // 中身が合わない対局は error
  const wrong = JSON.parse(FILE);
  wrong.groups['いつもの'][0].check.balance[0] = 0;
  plan = planImport(wrong, { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  assert.equal(plan.items[0].status, 'error');
  assert.equal(importChanges(plan).sessions.length, 1);
});

test('別のグループ：ほかのグループの同じ名前のメンバーを使い、そのグループに所属させる', () => {
  const data = readImportFile(FILE);
  const other = { id: 'g_other', name: '別の卓', cutover_date: '' };
  const plan = planImport(data, {
    tables: emptyTables(), group: other, newId: counter(),
    otherMembers: [{ id: 'm_a', name: 'A', aliases: '' }],
  });
  assert.deepEqual(plan.joinMembers, ['A']);
  assert.deepEqual(plan.newMembers, ['F', 'G', 'H', 'X']);
  const changes = importChanges(plan);
  assert.ok(!changes.members.some((m) => m.id === 'm_a'), '既存のメンバーの行は送らない');
  assert.ok(changes.group_members.some((g) => g.id === 'g_other:m_a'));
  const tables = apply(apply(emptyTables(), { members: [{ id: 'm_a', name: 'A' }] }), changes);
  assert.ok(verifyImported(plan, tables).every((r) => r.ok));
  // ファイルにないグループ
  assert.deepEqual(planImport(data, { tables: emptyTables(), group: { id: 'g_x', name: 'ない卓' }, newId: counter() }).items, []);
});

test('取り込み後の繰り越し：本家通算が取り込んだ対局の合計と同じなら、全員 0 になる', () => {
  const data = readImportFile(FILE);
  const plan = planImport(data, { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  let tables = apply(itsumoTables(), importChanges(plan));
  // 本家通算（9/26 と 10/23 の本家の計・収支・半荘数・日数の和。収支はゲーム代を引く前も入れる）
  const id = (name) => plan.members.get(name).id;
  const honke = {
    A: [-119, -14, -8750, -12120, 15, 2], B: [61, 12, 5450, 2090, 15, 2], C: [-46, -6, -3500, -5750, 10, 1],
    D: [121, 8, 7650, 4290, 15, 2], E: [-17, 0, -850, -1960, 5, 1],
  };
  tables = apply(tables, {
    carryovers: Object.entries(honke).map(([name, [pt, chips, subtotal, balance, games, days]]) => ({
      id: `g_itsumo:${id(name)}`, group_id: 'g_itsumo', member_id: id(name), pt, chips, subtotal, balance, games, days,
    })),
  });
  for (const c of effectiveCarryovers(tables, ITSUMO.cutover_date)) {
    assert.ok(Object.values(c.carry).every((v) => v === 0), `${c.memberId}：${JSON.stringify(c.carry)}`);
  }
});

test('取り込んだ成績にも着順が付く：取り込んだ成績にも着順が付く', () => {
  const plan = planImport(readImportFile(FILE), { tables: itsumoTables(), group: ITSUMO, newId: counter() });
  const changes = importChanges(plan);
  const first = changes.results.filter((r) => r.hanchan_id === importIds('g_itsumo', K2).hanchanId(1));
  assert.deepEqual(first.map((r) => [r.member_id, r.pt, r.rank]), [['m_a', -48, 4], ['m_b', -12, 3], [plan.members.get('E').id, 12, 2], [plan.members.get('D').id, 48, 1]]);
});
