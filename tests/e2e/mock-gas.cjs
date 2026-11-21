// 画面の通し確認（tests/e2e）の部品：gas/Code.gs を Node 上で動かす偽 GAS（SpreadsheetApp 等のモック）と、アプリ配信用の静的サーバー。
// 本物のスプレッドシート・GAS・合言葉には触れない。データはすべて作り物
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

class Range {
  constructor(sheet, r, c, nr, nc) {
    if (r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols || nr < 1 || nc < 1) throw new Error('range out of bounds');
    Object.assign(this, { sheet, r, c, nr, nc });
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v))); return this; }
  setNumberFormat(f) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sheet.fmt[`${this.r + i},${this.c + j}`] = f; return this; }
  setFontWeight() { return this; }
  insertCheckboxes() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = {}; this.fmt = {}; this.maxRows = 1000; this.maxCols = 26; }
  get(r, c) { const v = this.cells[`${r},${c}`]; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && this.fmt[`${r},${c}`] !== '@') v = new Date(v);
    else if (typeof v === 'string' && v.startsWith('=')) throw new Error('formula injected');
    this.cells[`${r},${c}`] = v;
  }
  getLastRow() { let m = 0; for (const k in this.cells) if (this.cells[k] !== '') m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k in this.cells) if (this.cells[k] !== '') m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; }
  insertColumnsAfter(_, n) { this.maxCols += n; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getDataRange() { return new Range(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  setFrozenRows() {}
  deleteRow(r) {
    const next = {};
    for (const [k, v] of Object.entries(this.cells)) {
      const [rr, cc] = k.split(',').map(Number);
      if (rr < r) next[k] = v; else if (rr > r) next[`${rr - 1},${cc}`] = v;
    }
    this.cells = next;
  }
}

function createGas(codePath, shared = {}) {
  const sheets = shared.sheets || [new Sheet('シート1')];
  const props = shared.props || {};
  const prompts = [];
  const alerts = [];
  const confirms = [];
  const ss = {
    getName: () => '麻雀録（偽）',
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
  const ui = {
    ButtonSet: { OK_CANCEL: 1, OK: 2 }, Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert: (...a) => { alerts.push(a.length > 1 ? `${a[0]}：${a[1]}` : String(a[0])); return a[2] === 1 ? (confirms.shift() || 'OK') : 'OK'; },
    prompt: () => { const t = prompts.shift(); return { getSelectedButton: () => 'OK', getResponseText: () => t }; },
    createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }),
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    Utilities: {
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      computeDigest: (_, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      formatDate: (d) => d.toISOString().slice(0, 10),
      sleep: () => {},
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), ctx);
  return { ctx, sheets, prompts, alerts, confirms, ss, props };
}

function serveGas(gas, port) {
  gas.offline = false;
  const server = http.createServer((req, res) => {
    if (gas.offline) { req.socket.destroy(); return; }
    const send = (out) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out.body);
    };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET') return send(gas.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => send(gas.ctx.doPost({ postData: { contents: body } })));
      return;
    }
    res.writeHead(405).end();
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function readSheet(gas, name) {
  return JSON.parse(JSON.stringify(gas.ctx.readTable_(name).rows));
}

module.exports = { createGas, serveGas, serveStatic, readSheet };
