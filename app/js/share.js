// 対局の成績表を PNG 画像にする（グループ LINE に送るため。仕様書 7.3）
//   shareTable … 表の中身（文字と色の種類）を作る純粋関数
//   drawTable  … それを canvas に描く。外部ライブラリは使わない
import { formatPt } from './calc.js';
import { formatDate, formatMoney } from './util.js';
import { toPt10 } from './model.js';

const tone = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

// model は model.buildSession の結果、names は参加者の名前（列順）
export function shareTable(model, names) {
  const { session, participants, hanchans, summary } = model;
  const rows = hanchans.map((hc, i) => ({
    label: String(i + 1),
    cells: participants.map((p) => {
      const r = hc.results[p.member_id];
      if (!r) return { text: '—', tone: 'muted' };
      const pt10 = toPt10(r.pt);
      return { text: formatPt(pt10), tone: tone(pt10), bold: r.rank === 1 };
    }),
  }));
  const foot = [
    { label: '計', cells: summary.map((s) => ({ text: formatPt(s.pt10), tone: tone(s.pt10), bold: true })) },
    { label: 'チップ', cells: summary.map((s) => ({ text: s.chips > 0 ? `+${s.chips}` : String(s.chips), tone: tone(s.chips) })) },
    { label: '小計', cells: summary.map((s) => ({ text: formatMoney(s.subtotal), tone: tone(s.subtotal) })) },
    { label: 'ゲーム代', cells: summary.map((s) => ({ text: `-${s.fee.toLocaleString('ja-JP')}`, tone: 'muted' })) },
    { label: '収支', cells: summary.map((s) => ({ text: formatMoney(s.balance), tone: tone(s.balance), bold: true })) },
  ];
  return {
    title: formatDate(session.date) + (session.title ? `　${session.title}` : ''),
    subtitle: `レート ${session.rate}・チップ ${session.chip_rate}・ゲーム代 ${Number(session.game_fee).toLocaleString('ja-JP')}P`,
    header: names,
    rows,
    foot,
  };
}

// 画像は常に明るい配色にする（LINE のトーク画面で読みやすいように）
const COLORS = {
  bg: '#ffffff', band: '#14532d', bandText: '#ffffff', text: '#1c1c1c', muted: '#6b6b6b',
  line: '#ddd6c8', stripe: '#f7f5ef', pos: '#1d4ed8', neg: '#c2410c',
};
const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif';

// 幅に収まらない文字は末尾を「…」にする
function fit(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

export function drawTable(table, scale = 2) {
  const pad = 16;
  const labelW = 64;
  const bandH = 64;
  const headH = 36;
  const rowH = 32;
  const noteH = 30;

  // 列幅は名前と値の長さに合わせる（72〜120px）
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `bold 15px ${FONT}`;
  const texts = [...table.header, ...[...table.rows, ...table.foot].flatMap((r) => r.cells.map((c) => c.text))];
  const colW = Math.min(120, Math.max(72, ...texts.map((t) => probe.measureText(t).width + 18)));

  const n = table.header.length;
  const width = pad * 2 + labelW + colW * n;
  const lines = table.rows.length + table.foot.length;
  const height = bandH + headH + rowH * lines + noteH;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const g = canvas.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, width, height);

  // 上の帯：日付・タイトルとレート
  g.fillStyle = COLORS.band;
  g.fillRect(0, 0, width, bandH);
  g.fillStyle = COLORS.bandText;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `bold 18px ${FONT}`;
  g.fillText(fit(g, table.title, width - pad * 2), pad, 24);
  g.font = `13px ${FONT}`;
  g.fillText(fit(g, table.subtitle, width - pad * 2), pad, 47);

  const colX = (i) => pad + labelW + colW * i;
  let y = bandH;

  // 見出し：名前
  g.font = `bold 14px ${FONT}`;
  g.fillStyle = COLORS.text;
  g.textAlign = 'center';
  table.header.forEach((name, i) => g.fillText(fit(g, name, colW - 8), colX(i) + colW / 2, y + headH / 2));
  y += headH;
  g.fillStyle = COLORS.line;
  g.fillRect(pad, y - 1, width - pad * 2, 1);

  const drawRow = (row, index, { strong = false } = {}) => {
    if (index % 2 === 1 && !strong) {
      g.fillStyle = COLORS.stripe;
      g.fillRect(pad, y, width - pad * 2, rowH);
    }
    g.textAlign = 'center';
    g.fillStyle = COLORS.muted;
    g.font = `13px ${FONT}`;
    g.fillText(row.label, pad + labelW / 2, y + rowH / 2);
    g.textAlign = 'right';
    row.cells.forEach((c, i) => {
      g.fillStyle = COLORS[c.tone] || COLORS.text;
      g.font = `${c.bold ? 'bold ' : ''}${strong ? 16 : 15}px ${FONT}`;
      g.fillText(c.text, colX(i) + colW - 10, y + rowH / 2);
    });
    y += rowH;
  };

  table.rows.forEach((row, i) => drawRow(row, i));
  // 計から下は区切り線を入れ、最後の収支は少し大きく
  g.fillStyle = COLORS.text;
  g.fillRect(pad, y, width - pad * 2, 1.5);
  table.foot.forEach((row, i) => drawRow(row, i, { strong: i === table.foot.length - 1 }));

  g.fillStyle = COLORS.muted;
  g.font = `11px ${FONT}`;
  g.textAlign = 'right';
  g.fillText('麻雀録', width - pad, y + noteH / 2);
  return canvas;
}
