/**
 * 麻雀録 GAS 窓口
 *
 * スプレッドシートに紐づけ、ウェブアプリとして公開する。
 *   実行ユーザー：自分　／　アクセスできるユーザー：全員
 *
 * API（詳細は docs/02_データ設計.md の 4 章）
 *   GET  ?action=ping                         疎通確認（合言葉不要）
 *   POST { action: 'load', passcode }          合言葉のグループのデータを全部返す
 *   POST { action: 'save', passcode, records } { シート名: [行, …] } を id で上書き／追記する
 *
 * スプレッドシートのメニュー「麻雀録」
 *   シートを準備     … シートと見出しを作る（何度実行しても良い。足りない列だけ足す）
 *   合言葉を設定     … グループの合言葉を入れる。シートにはハッシュだけを保存する
 */

// ---------------------------------------------------------------------------
// シートの定義（docs/02_データ設計.md と揃える）
// 型：s＝文字列（シートの書式は「書式なしテキスト」）、n＝数値、b＝真偽
// ---------------------------------------------------------------------------

const TABLES = {
  groups: [['id', 's'], ['name', 's'], ['passcode_hash', 's']],
  members: [['id', 's'], ['name', 's'], ['aliases', 's']],
  group_members: [['id', 's'], ['group_id', 's'], ['member_id', 's']],
  rules: [
    ['id', 's'], ['name', 's'], ['group_id', 's'], ['players', 'n'],
    ['start_points', 'n'], ['return_points', 'n'], ['uma', 's'], ['uma_oka', 'b'],
    ['rounding', 's'], ['tie_break', 's'], ['note', 's'],
  ],
  sessions: [
    ['id', 's'], ['group_id', 's'], ['date', 's'], ['title', 's'],
    ['rule_name', 's'], ['rule_snapshot', 's'], ['rate', 'n'], ['chip_rate', 'n'],
    ['game_fee', 'n'], ['memo', 's'], ['created_by', 's'], ['event_id', 's'],
  ],
  participants: [
    ['id', 's'], ['session_id', 's'], ['member_id', 's'],
    ['col_order', 'n'], ['chips', 'n'], ['fee_share', 'n'],
  ],
  hanchans: [['id', 's'], ['session_id', 's'], ['seq', 'n'], ['input_mode', 's']],
  results: [
    ['id', 's'], ['hanchan_id', 's'], ['member_id', 's'], ['seat', 'n'],
    ['raw_score', 'n'], ['pt', 'n'], ['rank', 'n'],
  ],
};
const COMMON_COLUMNS = [['created_at', 's'], ['updated_at', 's'], ['deleted', 'b']];

// アプリから書き込めるシート（groups は合言葉を含むので書かせない）
const WRITABLE = ['members', 'group_members', 'rules', 'sessions', 'participants', 'hanchans', 'results'];

function columnsOf_(name) {
  return TABLES[name].concat(COMMON_COLUMNS);
}

function typesOf_(name) {
  const types = {};
  columnsOf_(name).forEach(([col, type]) => { types[col] = type; });
  return types;
}

// ---------------------------------------------------------------------------
// ウェブアプリの入口
// ---------------------------------------------------------------------------

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    return json_({
      ok: true,
      app: 'mjroku',
      // 紐づいたスプレッドシートを開けているかの確認を兼ねる
      spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName(),
      time: new Date().toISOString(),
    });
  }
  return json_({ ok: false, error: 'unknown action: ' + action });
}

// アプリは Content-Type: text/plain で JSON を送る
// （application/json だとブラウザが事前確認（CORS preflight）を送り、GAS が応答できないため）
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const auth = authenticate_(req.passcode);
    if (!auth) {
      Utilities.sleep(1000); // 総当たりを遅くする
      return json_({ ok: false, error: 'bad_passcode' });
    }
    if (req.action === 'load') {
      return json_(Object.assign({ ok: true }, load_(auth)));
    }
    if (req.action === 'save') {
      return json_({ ok: true, saved: save_(auth, req.records || {}), server_time: new Date().toISOString() });
    }
    return json_({ ok: false, error: 'unknown action: ' + req.action });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// 合言葉
// ---------------------------------------------------------------------------

// 合言葉はグループ ID と組み合わせてハッシュにする（同じ合言葉でもグループごとに別の値になる）
function hash_(groupId, passcode) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, groupId + ':' + passcode, Utilities.Charset.UTF_8);
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// 合言葉を照合し、{ group, role } を返す。一致しなければ null。
// role は今は 'member' だけ。段階4で「管理者用の合言葉」を足したら、ここで 'admin' を返す
// （方針は docs/05_次の作業メモ「権限の分け方」。判定は必ず GAS で行い、アプリの表示に頼らない）
function authenticate_(passcode) {
  const code = String(passcode || '').trim();
  if (!code) return null;
  const groups = readTable_('groups').rows;
  const group = groups.find((g) => !g.deleted && g.passcode_hash && g.passcode_hash === hash_(g.id, code));
  return group ? { group: group, role: 'member' } : null;
}

// 権限の判定。保存する 1 行ごとに呼ぶ（sheet：シート名、row：保存後の行、existing：上書きされる既存の行）。
// 今は合言葉が通れば全員同じ権限なので常に許可する。
// 段階4で管理者だけに絞る操作（ルールの追加・編集、削除した対局の復元など）は、ここに条件を足す
function authorize_(auth, sheet, row, existing) {
  return true;
}

// ---------------------------------------------------------------------------
// 読み込み：合言葉のグループ G に関係する行だけを返す
// ---------------------------------------------------------------------------

function load_(auth) {
  const group = auth.group;
  const G = group.id;
  const t = {};
  WRITABLE.forEach((name) => { t[name] = readTable_(name).rows; });

  const groupMembers = t.group_members.filter((r) => r.group_id === G);
  const memberIds = new Set(groupMembers.map((r) => r.member_id));
  const sessions = t.sessions.filter((r) => r.group_id === G);
  const sessionIds = new Set(sessions.map((r) => r.id));
  const hanchans = t.hanchans.filter((r) => sessionIds.has(r.session_id));
  const hanchanIds = new Set(hanchans.map((r) => r.id));

  return {
    group: { id: group.id, name: group.name }, // passcode_hash は返さない
    role: auth.role,
    data: {
      members: t.members.filter((r) => memberIds.has(r.id)),
      group_members: groupMembers,
      rules: t.rules.filter((r) => !r.group_id || r.group_id === G),
      sessions: sessions,
      participants: t.participants.filter((r) => sessionIds.has(r.session_id)),
      hanchans: hanchans,
      results: t.results.filter((r) => hanchanIds.has(r.hanchan_id)),
    },
    server_time: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 保存：全行を検査してから書く（1 行でもグループ外があれば何も書かない）
// ---------------------------------------------------------------------------

function save_(auth, records) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // 同時に保存が来ても行が重ならないよう 1 件ずつ処理する
  try {
    const names = Object.keys(records);
    names.forEach((name) => {
      if (WRITABLE.indexOf(name) < 0) throw new Error('書き込めないシート: ' + name);
      if (!Array.isArray(records[name])) throw new Error('行の配列ではありません: ' + name);
    });

    const tables = {};
    WRITABLE.forEach((name) => { tables[name] = readTable_(name); });

    // 一部の列だけ送られてくる（例：論理削除で id と deleted だけ）ことがあるので、
    // 既存の行に送られた値を重ねた「保存後の姿」で検査する
    const merged = {};
    names.forEach((name) => {
      merged[name] = records[name].map((row) => {
        if (!row || !row.id) throw new Error('id のない行: ' + name);
        return Object.assign({}, tables[name].byId[row.id] || {}, row);
      });
    });
    const belongs = ownership_(auth.group.id, tables, merged);

    // 保存後の行も、上書きされる既存の行も、どちらも G のものでなければならない。そのうえで権限を見る
    names.forEach((name) => {
      merged[name].forEach((row) => {
        if (!belongs(name, row)) throw new Error('グループ外のデータ: ' + name + ' ' + row.id);
        const existing = tables[name].byId[row.id];
        if (existing && !belongs(name, existing)) throw new Error('グループ外のデータ: ' + name + ' ' + row.id);
        if (!authorize_(auth, name, row, existing || null)) throw new Error('権限がありません: ' + name + ' ' + row.id);
      });
    });

    let count = 0;
    names.forEach((name) => { count += upsert_(tables[name], records[name]); });
    return count;
  } finally {
    lock.releaseLock();
  }
}

// 行がグループ G に属するかを判定する関数を返す。
// 対局 → 参加者・半荘 → 成績 と親をたどって判定する。親は既存の行と今回送られた行の両方から探す
// （新しい対局を参加者・半荘と一緒に送ってきたときのため）。
function ownership_(G, tables, records) {
  const incoming = (name) => records[name] || [];
  const all = (name) => tables[name].rows.concat(incoming(name));

  const sessionIds = new Set(all('sessions').filter((r) => r.group_id === G).map((r) => r.id));
  const hanchanIds = new Set(all('hanchans').filter((r) => sessionIds.has(r.session_id)).map((r) => r.id));
  const memberIds = new Set(all('group_members').filter((r) => r.group_id === G).map((r) => r.member_id));

  return function (name, row) {
    switch (name) {
      case 'sessions':
      case 'group_members':
        return row.group_id === G;
      case 'rules':
        // 全グループ共通（group_id が空）か、このグループ限定のルール
        return !row.group_id || row.group_id === G;
      case 'participants':
      case 'hanchans':
        return sessionIds.has(row.session_id);
      case 'results':
        return hanchanIds.has(row.hanchan_id);
      case 'members':
        return memberIds.has(row.id);
      default:
        return false;
    }
  };
}

// ---------------------------------------------------------------------------
// シートの読み書き
// ---------------------------------------------------------------------------

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

// シートを読み、見出しの名前で列を対応づけた行オブジェクトにする。
// 列の並びは見出しで判断するので、施主がシート上で列を入れ替えても壊れない。
function readTable_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('シート「' + name + '」がありません（メニュー「麻雀録 → シートを準備」を実行）');
  const values = sheet.getDataRange().getValues();
  const header = (values[0] || []).map(String);
  const types = typesOf_(name);
  const rows = [];
  const byId = {};
  const rowNumberById = {};
  const rawById = {};
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    header.forEach((col, c) => {
      if (types[col]) obj[col] = fromCell_(values[r][c], types[col]);
    });
    if (!obj.id) continue; // 空行
    rows.push(obj);
    byId[obj.id] = obj;
    rowNumberById[obj.id] = r + 1;
    rawById[obj.id] = values[r];
  }
  return { name, sheet, header, types, rows, byId, rowNumberById, rawById };
}

function fromCell_(v, type) {
  if (type === 'n') return v === '' || v === null ? null : Number(v);
  if (type === 'b') return v === true || String(v).toUpperCase() === 'TRUE';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null ? '' : String(v);
}

function toCell_(v, type) {
  if (type === 'n') {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) throw new Error('数値ではありません: ' + v);
    return n;
  }
  if (type === 'b') return v === true;
  const s = v === null || v === undefined ? '' : String(v);
  // "=" で始まる文字列は数式として実行されてしまうため、先頭に ' を付けて文字として保存する
  return s.charAt(0) === '=' ? "'" + s : s;
}

// rows を id で上書き／追記する。送られてこなかった列は既存の値を残す。
// シートに施主が手で足した列（定義にない列）も消さずに残す。
function upsert_(table, rows) {
  const now = new Date().toISOString();
  const { sheet, header, types } = table;

  // 同じ id が 1 回の送信に複数あれば最後のものを使う
  const latest = {};
  rows.forEach((row) => { latest[row.id] = row; });

  const appends = [];
  Object.keys(latest).forEach((id) => {
    const row = latest[id];
    const existing = table.byId[id];
    const merged = Object.assign({}, existing || {}, row);
    merged.created_at = (existing && existing.created_at) || row.created_at || now;
    merged.updated_at = row.updated_at || now;
    merged.deleted = merged.deleted === true;

    const raw = table.rawById[id];
    const cells = header.map((col, c) => (types[col] ? toCell_(merged[col], types[col]) : (raw ? raw[c] : '')));
    if (existing) {
      sheet.getRange(table.rowNumberById[id], 1, 1, header.length).setValues([cells]);
    } else {
      appends.push(cells);
    }
  });

  if (appends.length) {
    const start = sheet.getLastRow() + 1;
    const needed = start + appends.length - 1 - sheet.getMaxRows();
    if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    // 書式を先に「書式なしテキスト」にしてから値を入れる（日付や ID が勝手に変換されないように）
    header.forEach((col, c) => {
      if (types[col] === 's') sheet.getRange(start, c + 1, appends.length, 1).setNumberFormat('@');
    });
    sheet.getRange(start, 1, appends.length, header.length).setValues(appends);
  }
  return Object.keys(latest).length;
}

// ---------------------------------------------------------------------------
// スプレッドシートのメニュー
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('麻雀録')
    .addItem('シートを準備', 'setupSheets')
    .addItem('合言葉を設定', 'setPasscode')
    .addToUi();
}

// シートと見出しを作る。既にあれば足りない列だけ末尾に足す（既存の列とデータには触らない）
function setupSheets() {
  const ss = ss_();
  Object.keys(TABLES).forEach((name) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const lastCol = sheet.getLastColumn();
    const header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    columnsOf_(name).forEach(([col]) => { if (header.indexOf(col) < 0) header.push(col); });

    if (header.length > sheet.getMaxColumns()) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), header.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);

    const types = typesOf_(name);
    const bodyRows = sheet.getMaxRows() - 1;
    if (bodyRows > 0) {
      header.forEach((col, c) => {
        if (types[col] === 's') sheet.getRange(2, c + 1, bodyRows, 1).setNumberFormat('@');
      });
    }
  });

  // 最初からある空のシートを消す
  ['シート1', 'Sheet1'].forEach((n) => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  // 初期データ：グループ「いつもの」と「いつものルール」
  const groups = readTable_('groups');
  if (!groups.byId.g_itsumo) upsert_(groups, [{ id: 'g_itsumo', name: 'いつもの', passcode_hash: '' }]);
  const rules = readTable_('rules');
  if (!rules.byId.r_standard) {
    upsert_(rules, [{
      id: 'r_standard', name: 'いつものルール', group_id: '', players: 4,
      start_points: 25000, return_points: 30000, uma: '20,10,-10,-20', uma_oka: true,
      rounding: 'round4', tie_break: 'seat', note: '標準。オカ +20 はトップ',
    }]);
  }

  const done = runMigrations_();
  SpreadsheetApp.getUi().alert('シートを準備しました。' + (done.length ? '\n\n' + done.join('\n') : ''));
}

// ---------------------------------------------------------------------------
// 一度だけ行うデータの移行
// 済んだものはスクリプトのプロパティに記録し、「シートを準備」を何度実行しても 2 回目以降は何もしない
// （施主があとで手で値を変えても、上書きしないため）
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  ['2026-10-31_rules_uma_oka', function () {
    const rules = readTable_('rules');
    const col = rules.header.indexOf('uma_oka');
    const changes = [];
    rules.rows.forEach((r) => {
      const change = {};
      // 段階2で足した uma_oka 列。既存の行は空欄なので「あり」にする
      if (col >= 0 && rules.rawById[r.id][col] === '') change.uma_oka = true;
      // 仕様変更（2026-10-31）：「いつものルール」の端数処理は四捨五入
      if (r.id === 'r_standard' && r.rounding !== 'round4') change.rounding = 'round4';
      if (Object.keys(change).length) changes.push(Object.assign({ id: r.id }, change));
    });
    if (changes.length) upsert_(rules, changes);
    return '「いつものルール」を「四捨五入・ウマオカあり」にしました。';
  }],
  // 公式ルールのプリセット（2026-10-31 施主確認済み）。全グループ共通。
  // 同じ id か同じ名前のルールが既にあれば入れない（施主が先に作っていた場合に重ねない）
  ['2026-10-31_presets_mj_mleague', function () {
    const presets = [
      {
        id: 'r_mj_net', name: 'MJ（ネット）', group_id: '', players: 4,
        start_points: 25000, return_points: 30000, uma: '20,10,-10,-20', uma_oka: true,
        rounding: 'none', tie_break: 'seat',
        note: 'セガNET麻雀 MJ の四麻ルール（プレイヤーズサイト）。小数第 1 位まで、同点は起家に近い方が上',
      },
      {
        id: 'r_mleague', name: 'Mリーグ', group_id: '', players: 4,
        start_points: 25000, return_points: 30000, uma: '30,10,-10,-30', uma_oka: true,
        rounding: 'none', tie_break: 'split',
        note: '順位点 +50／+10／−10／−30（オカ込み）。同点は順位点を等分し、端数は起家に近い方',
      },
    ];
    const rules = readTable_('rules');
    const names = rules.rows.filter((r) => !r.deleted).map((r) => r.name);
    const adding = presets.filter((p) => !rules.byId[p.id] && names.indexOf(p.name) < 0);
    if (adding.length) upsert_(rules, adding);
    return adding.length
      ? 'ルール「' + adding.map((p) => p.name).join('」「') + '」を全グループ共通で入れました。'
      : 'ルール「MJ（ネット）」「Mリーグ」は既にあるので入れませんでした。';
  }],
];

// 未実行の移行を順に行い、行ったものの説明を返す
function runMigrations_() {
  const props = PropertiesService.getScriptProperties();
  const done = [];
  MIGRATIONS.forEach(([key, fn]) => {
    if (props.getProperty('migration:' + key)) return;
    done.push(fn());
    props.setProperty('migration:' + key, new Date().toISOString());
  });
  return done;
}

// 合言葉を設定する。シートには SHA-256 のハッシュだけを保存し、平文はどこにも残さない
function setPasscode() {
  const ui = SpreadsheetApp.getUi();
  const groups = readTable_('groups');
  const active = groups.rows.filter((g) => !g.deleted);
  if (!active.length) {
    ui.alert('グループがありません。先に「シートを準備」を実行してください。');
    return;
  }

  let group = active[0];
  if (active.length > 1) {
    const list = active.map((g) => g.id + '（' + g.name + '）').join('\n');
    const r1 = ui.prompt('合言葉を設定', '対象のグループ ID を入力してください。\n' + list, ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    group = active.find((g) => g.id === r1.getResponseText().trim());
    if (!group) {
      ui.alert('そのグループ ID は見つかりません。');
      return;
    }
  }

  const r2 = ui.prompt('合言葉を設定', '「' + group.name + '」の新しい合言葉（4 文字以上）', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const passcode = r2.getResponseText().trim();
  if (passcode.length < 4) {
    ui.alert('4 文字以上にしてください。');
    return;
  }
  // 他のグループと同じ合言葉だと、どちらのグループか判別できなくなる
  const clash = active.some((g) => g.id !== group.id && g.passcode_hash === hash_(g.id, passcode));
  if (clash) {
    ui.alert('他のグループと同じ合言葉は使えません。');
    return;
  }

  upsert_(groups, [{ id: group.id, passcode_hash: hash_(group.id, passcode) }]);
  ui.alert('「' + group.name + '」の合言葉を設定しました。前の合言葉はもう使えません。');
}
