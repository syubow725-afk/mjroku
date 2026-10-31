// 端末のデータ置き場と同期。
//
// 考え方
//   server … 最後に GAS から読み込んだデータ（シートと同じ形の行を id で引ける形にしたもの）
//   outbox … 端末で変更して、まだ GAS に届いていない行（送信待ち）
//   画面に見せるのは server に outbox を重ねたもの。電波がなくても入力した内容がすぐ見える。
//
// 同期の順番：outbox を save で送る → 成功した行を outbox から外す → load で server を最新にする。
// 失敗したら outbox はそのまま残し、次の機会（電波の復帰、アプリを開き直したとき、一定間隔）に再送する。
//
// server と outbox はグループごとに分けて端末に置く。グループを切り替えても入力が混ざらず、
// 表示中でないグループの送信待ちも、同期のたびにそのグループの合言葉で送る。

// 率のランキングの規定半荘数の初期値（グループの設定が空のとき）
export const DEFAULT_MIN_GAMES = 10;

export const SHEETS = ['members', 'group_members', 'rules', 'sessions', 'participants', 'hanchans', 'results'];

export function emptyTables() {
  return Object.fromEntries(SHEETS.map((s) => [s, {}]));
}

// GAS の load の data（シートごとの行の配列）を、シートごとに id → 行 の形にする
export function indexRows(data) {
  const out = emptyTables();
  for (const sheet of SHEETS) {
    for (const row of data[sheet] || []) out[sheet][row.id] = row;
  }
  return out;
}

// server に outbox を重ねた表を作る（元のオブジェクトは変えない）
export function overlay(server, outbox) {
  const out = emptyTables();
  for (const sheet of SHEETS) {
    out[sheet] = { ...server[sheet] };
    for (const [id, row] of Object.entries(outbox[sheet] || {})) {
      out[sheet][id] = { ...(out[sheet][id] || {}), ...row };
    }
  }
  return out;
}

// outbox に行を積む。同じ id がまだ送られていなければ、変更を重ねて 1 行にまとめる
export function addToOutbox(outbox, sheet, row) {
  outbox[sheet] = outbox[sheet] || {};
  outbox[sheet][row.id] = { ...(outbox[sheet][row.id] || {}), ...row };
}

export function countOutbox(outbox) {
  return SHEETS.reduce((n, s) => n + Object.keys(outbox[s] || {}).length, 0);
}

// 送信に成功した行を outbox から外す。
// 送信中にさらに変更された行（updated_at が送ったものと違う）は、次回また送るため残す
export function removeSent(outbox, sent) {
  for (const sheet of SHEETS) {
    for (const [id, row] of Object.entries(sent[sheet] || {})) {
      const now = outbox[sheet]?.[id];
      if (now && now.updated_at === row.updated_at) delete outbox[sheet][id];
    }
  }
}

function recordsOf(outbox) {
  const records = {};
  for (const sheet of SHEETS) {
    const rows = Object.values(outbox[sheet] || {});
    if (rows.length) records[sheet] = rows;
  }
  return records;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// グループごとの置き場。キーは 'mjroku.store.' ＋グループ ID（初めての接続でグループがまだ分からない間は空）。
// 中身は { server, outbox, group, role, groups, lastSync }
const SLOT_PREFIX = 'mjroku.store.';
const LEGACY_KEY = 'mjroku.store'; // v0.6.0 までの置き場（グループは 1 つだけだった）

function emptySlot() {
  return { server: emptyTables(), outbox: emptyTables(), group: null, role: 'member', groups: null, lastSync: null };
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export class Store {
  // api：{ load(config), save(config, records) }、getConfig：() => 設定（gasUrl, passcode, groupId）
  // choices：() => 端末の合言葉で開けるグループの一覧（config.js の groupChoices の形）。表示中でないグループの送信待ちを送るのに使う
  // remember：(config, res) => void。接続できたとき、合言葉で開けるグループと表示中のグループを覚えておく
  // storage：localStorage（テストでは差し替える）
  constructor({ api, getConfig, choices = () => [], remember = () => {}, storage = defaultStorage() }) {
    this.api = api;
    this.getConfig = getConfig;
    this.choices = choices;
    this.remember = remember;
    this.storage = storage;
    this.slotId = '';       // 表示中のグループ（置き場のキー）
    this.server = emptyTables();
    this.outbox = emptyTables();
    this.group = null;      // { id, name, min_games, has_passcode }
    this.role = 'member';   // 'member'／'admin'（GAS が合言葉から決める。表示の切り替えにだけ使い、権限の判定は GAS が行う）
    this.groups = null;     // 管理者のときだけ、全グループの一覧
    this.lastSync = null;   // 最後に load できた時刻
    this.syncing = false;
    this.error = null;
    this.otherPending = 0;  // 表示中でないグループの送信待ちの件数
    this.otherErrors = {};  // 表示中でないグループの送信待ちを送れなかった理由（グループ ID → 文言）
    this.seq = 0;           // グループを切り替えるたびに増やす。切り替え前に始めた同期の結果を捨てるため
    this.listeners = new Set();
    this.view = null;       // server ＋ outbox のキャッシュ
    this.restore();
  }

  readSlot(id) {
    try {
      const saved = JSON.parse(this.storage?.getItem(SLOT_PREFIX + id) || 'null');
      if (!saved) return null;
      return { ...emptySlot(), ...saved, server: { ...emptyTables(), ...saved.server }, outbox: { ...emptyTables(), ...saved.outbox } };
    } catch { return null; } // 読めなければ空から始める（GAS から読み直せる）
  }

  writeSlot(id, slot) {
    try {
      this.storage?.setItem(SLOT_PREFIX + id, JSON.stringify(slot));
    } catch { /* 容量不足などで保存できなくても画面上のデータは生きている */ }
  }

  removeSlot(id) {
    try { this.storage?.removeItem(SLOT_PREFIX + id); } catch { /* 消せなくても害はない */ }
  }

  useSlot(slot) {
    ({ server: this.server, outbox: this.outbox, group: this.group, role: this.role, groups: this.groups, lastSync: this.lastSync } = slot);
    this.view = null;
  }

  // v0.6.0 までの置き場を、そのグループの置き場に移す。移した先のグループ ID を返す
  migrateLegacy() {
    try {
      const raw = this.storage?.getItem(LEGACY_KEY);
      if (!raw) return null;
      const id = JSON.parse(raw).group?.id || '';
      if (!this.storage.getItem(SLOT_PREFIX + id)) this.storage.setItem(SLOT_PREFIX + id, raw);
      this.storage.removeItem(LEGACY_KEY);
      return id;
    } catch { return null; }
  }

  restore() {
    const legacy = this.migrateLegacy();
    this.slotId = this.getConfig().groupId || legacy || '';
    this.useSlot(this.readSlot(this.slotId) || emptySlot());
    this.refreshOtherPending();
  }

  persist() {
    this.writeSlot(this.slotId, {
      server: this.server, outbox: this.outbox, group: this.group, role: this.role, groups: this.groups, lastSync: this.lastSync,
    });
  }

  // 設定の passcode・groupId を切り替えたあとに呼ぶ。そのグループの置き場に入れ替えて同期する
  switchTo() {
    this.persist();
    this.seq += 1;
    this.slotId = this.getConfig().groupId || '';
    this.useSlot(this.readSlot(this.slotId) || emptySlot());
    this.loadedJson = null;
    this.error = null;
    this.refreshOtherPending();
    this.emit('data');
    return this.sync();
  }

  // 合言葉を外したとき、もう開けないグループの置き場を消す（送信待ちがないことは呼ぶ側で確かめる）
  forgetGroups(ids) {
    for (const id of ids) if (id !== this.slotId) this.removeSlot(id);
    this.refreshOtherPending();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // kind：'data'＝表示するデータが変わった、'status'＝同期の状況だけが変わった
  emit(kind) {
    if (kind === 'data') this.view = null;
    for (const fn of this.listeners) fn(kind);
  }

  tables() {
    if (!this.view) this.view = overlay(this.server, this.outbox);
    return this.view;
  }

  get(sheet, id) {
    return this.tables()[sheet][id] || null;
  }

  // 論理削除されていない行。filter で絞り込める
  list(sheet, filter = () => true) {
    return Object.values(this.tables()[sheet]).filter((r) => !r.deleted && filter(r));
  }

  get isAdmin() {
    return this.role === 'admin';
  }

  // グループ共通の設定「率のランキングの規定半荘数」。未設定なら 10
  get minGames() {
    const n = this.group?.min_games;
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MIN_GAMES;
  }

  // グループの管理（管理者だけ）の結果を反映する。res：save_group／set_group_passcode の応答
  applyGroups(res) {
    this.groups = res.groups;
    if (this.group && res.group.id === this.group.id) this.group = res.group;
    this.persist();
    // 足したグループに切り替えられるよう、合言葉で開けるグループも書き直す
    if (this.group) this.remember(this.getConfig(), { role: this.role, group: this.group, groups: this.groups });
    this.emit('data');
  }

  // 表示中のグループの送信待ち
  pendingCount() {
    return countOutbox(this.outbox);
  }

  // 全グループの送信待ち
  totalPending() {
    return this.pendingCount() + this.otherPending;
  }

  pendingFor(groupId) {
    if (groupId === this.slotId) return this.pendingCount();
    return countOutbox(this.readSlot(groupId)?.outbox || {});
  }

  refreshOtherPending() {
    this.otherPending = this.choices()
      .filter((c) => c.groupId !== this.slotId)
      .reduce((n, c) => n + this.pendingFor(c.groupId), 0);
  }

  // 変更を書く。changes：{ シート名: [行（id 必須。変える列だけでも良い）, …] }
  write(changes) {
    const now = new Date().toISOString();
    for (const [sheet, rows] of Object.entries(changes)) {
      for (const row of rows) {
        const isNew = !this.get(sheet, row.id);
        addToOutbox(this.outbox, sheet, {
          ...(isNew ? { created_at: now, deleted: false } : {}),
          ...row,
          updated_at: now,
        });
      }
    }
    this.persist();
    this.emit('data');
    this.sync();
  }

  // 表示中のグループの送信待ちを捨てる（GAS が受け付けない行が詰まったときの最終手段）
  discardOutbox() {
    this.outbox = emptyTables();
    this.persist();
    this.emit('data');
  }

  // 同期する。同期中に呼ばれたら、今の同期が終わってからもう一度行う。
  // 戻り値の Promise は、その追加の同期まで終わってから解決する
  sync() {
    if (this.syncPromise) {
      this.again = true;
    } else {
      this.syncPromise = this.syncLoop().finally(() => { this.syncPromise = null; });
    }
    return this.syncPromise;
  }

  async syncLoop() {
    do {
      this.again = false;
      await this.syncOnce();
    } while (this.again);
  }

  // 送信に成功した行を、そのグループの置き場の送信待ちから外す。
  // 送っている間にグループを切り替えていたら、置き場は localStorage の方にある
  markSent(groupId, sent) {
    // 届いた行は server 側にも重ねておく（続く load が失敗しても画面から消えないように）
    if (groupId === this.slotId) {
      this.server = overlay(this.server, sent);
      removeSent(this.outbox, sent);
      this.view = null;
      this.persist();
      return;
    }
    const slot = this.readSlot(groupId);
    if (!slot) return;
    slot.server = overlay(slot.server, sent);
    removeSent(slot.outbox, sent);
    this.writeSlot(groupId, slot);
  }

  // 表示中でないグループの送信待ちを、そのグループを開く合言葉で送る。
  // 1 つのグループで失敗しても、ほかのグループと表示中のグループの同期は止めない
  async flushOthers(config) {
    for (const c of this.choices()) {
      if (c.groupId === this.slotId) continue;
      const slot = this.readSlot(c.groupId);
      if (!slot || countOutbox(slot.outbox) === 0) continue;
      const sent = clone(slot.outbox);
      try {
        await this.api.save({ ...config, passcode: c.passcode, groupId: c.groupId }, recordsOf(sent));
        this.markSent(c.groupId, sent);
        delete this.otherErrors[c.groupId];
      } catch (err) {
        this.otherErrors[c.groupId] = err.message;
      }
    }
    this.refreshOtherPending();
  }

  // load で分かったグループが今の置き場と違う（初めての接続で、まだグループが分からなかったとき）。
  // そのグループの置き場に移る。そちらに送信待ちが残っていれば引き継いで、続けて送る
  adopt(groupId) {
    const stored = this.readSlot(groupId);
    if (this.slotId === '') this.removeSlot('');
    this.slotId = groupId;
    if (stored && countOutbox(stored.outbox) > 0) {
      this.outbox = overlay(stored.outbox, this.outbox);
      this.again = true;
    }
  }

  async syncOnce() {
    const config = this.getConfig();
    if (!config.gasUrl || !config.passcode) return;
    const seq = this.seq;
    const slotId = this.slotId;
    this.syncing = true;
    this.emit('status');
    let changed = false;
    try {
      await this.flushOthers(config);
      // 途中でグループを切り替えたら、ここでやめる（切り替えた先は switchTo が続けて同期する）
      if (seq !== this.seq) return;
      if (this.pendingCount() > 0) {
        const sent = clone(this.outbox);
        await this.api.save(config, recordsOf(sent));
        this.markSent(slotId, sent);
        if (seq !== this.seq) return;
      }
      const res = await this.api.load(config);
      if (seq !== this.seq) return; // 前のグループのデータなので捨てる
      if (res.group.id !== this.slotId) this.adopt(res.group.id);
      // 中身が前回と同じなら画面を作り直さない（タップ中のボタンを消さないため）
      const json = JSON.stringify([res.group, res.role, res.groups, res.data]);
      changed = json !== this.loadedJson;
      this.loadedJson = json;
      this.server = indexRows(res.data);
      this.group = res.group;
      this.role = res.role === 'admin' ? 'admin' : 'member';
      this.groups = res.groups || null;
      this.lastSync = new Date().toISOString();
      this.error = null;
      this.persist();
      this.remember(config, res);
    } catch (err) {
      if (seq === this.seq) this.error = err.message;
    } finally {
      this.syncing = false;
      this.emit(changed ? 'data' : 'status');
    }
  }
}
