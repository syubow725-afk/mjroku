// 端末のデータ置き場と同期。
//
// 考え方
//   server … 最後に GAS から読み込んだデータ（シートと同じ形の行を id で引ける形にしたもの）
//   outbox … 端末で変更して、まだ GAS に届いていない行（送信待ち）
//   画面に見せるのは server に outbox を重ねたもの。電波がなくても入力した内容がすぐ見える。
//
// 同期の順番：outbox を save で送る → 成功した行を outbox から外す → load で server を最新にする。
// 失敗したら outbox はそのまま残し、次の機会（電波の復帰、アプリを開き直したとき、一定間隔）に再送する。

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

const STORAGE_KEY = 'mjroku.store';

export class Store {
  // api：{ load(config), save(config, records) }、getConfig：() => 設定
  constructor({ api, getConfig }) {
    this.api = api;
    this.getConfig = getConfig;
    this.server = emptyTables();
    this.outbox = emptyTables();
    this.group = null;      // { id, name }
    this.lastSync = null;   // 最後に load できた時刻
    this.syncing = false;
    this.error = null;
    this.listeners = new Set();
    this.view = null;       // server ＋ outbox のキャッシュ
    this.restore();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) {
        this.server = { ...emptyTables(), ...saved.server };
        this.outbox = { ...emptyTables(), ...saved.outbox };
        this.group = saved.group || null;
        this.lastSync = saved.lastSync || null;
      }
    } catch { /* 読めなければ空から始める（GAS から読み直せる） */ }
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        server: this.server, outbox: this.outbox, group: this.group, lastSync: this.lastSync,
      }));
    } catch { /* 容量不足などで保存できなくても画面上のデータは生きている */ }
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

  pendingCount() {
    return countOutbox(this.outbox);
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

  // 送信待ちを捨てる（GAS が受け付けない行が詰まったときの最終手段）
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

  async syncOnce() {
    const config = this.getConfig();
    if (!config.gasUrl || !config.passcode) return;
    this.syncing = true;
    this.emit('status');
    let changed = false;
    try {
      if (this.pendingCount() > 0) {
        const sent = JSON.parse(JSON.stringify(this.outbox));
        const records = {};
        for (const sheet of SHEETS) {
          const rows = Object.values(sent[sheet] || {});
          if (rows.length) records[sheet] = rows;
        }
        await this.api.save(config, records);
        // 届いた行は server 側にも重ねておく（続く load が失敗しても画面から消えないように）
        this.server = overlay(this.server, sent);
        removeSent(this.outbox, sent);
        this.view = null;
        this.persist();
      }
      const res = await this.api.load(config);
      // 中身が前回と同じなら画面を作り直さない（タップ中のボタンを消さないため）
      const json = JSON.stringify([res.group, res.data]);
      changed = json !== this.loadedJson;
      this.loadedJson = json;
      this.server = indexRows(res.data);
      this.group = res.group;
      this.lastSync = new Date().toISOString();
      this.error = null;
      this.persist();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.syncing = false;
      this.emit(changed ? 'data' : 'status');
    }
  }
}
