// 画面まわりの小さな共通処理

// 端末で採番する ID。接頭辞 ＋ "_" ＋ 英小文字・数字 10 桁（docs/02_データ設計.md 2.2）
export function newId(prefix) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${prefix}_${Array.from(bytes, (b) => chars[b % 36]).join('')}`;
}

export function nowIso() {
  return new Date().toISOString();
}

// 端末の時刻での今日（"2026-10-23"）
export function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-10-23" → "10/23(金)"
export function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y) return dateStr;
  const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})`;
}

// 金額は 3 桁区切り、正には "+" を付ける
export function formatMoney(p) {
  if (p === 0) return '0';
  return (p > 0 ? '+' : '-') + Math.abs(p).toLocaleString('ja-JP');
}

// 正負で色を変えるための class 名
export function signClass(n) {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}

// DOM を組み立てる小さな関数。h('button', { class: 'x', onclick: fn }, '保存')
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

// 整数の入力欄の値を読む。空なら null、読めなければ NaN
export function readInt(input) {
  const s = String(input).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－ー‐]/g, '-');
  if (s === '') return null;
  return /^[+-]?\d+$/.test(s) ? Number(s) : NaN;
}

// 入力欄の符号を反転する（iPhone の数字キーボードにはマイナスがないため ± ボタンで切り替える）
export function toggleSign(input) {
  const v = input.value.trim();
  if (v.startsWith('-')) input.value = v.slice(1);
  else if (v.startsWith('+')) input.value = '-' + v.slice(1);
  else input.value = '-' + v;
  input.dispatchEvent(new Event('input'));
}
