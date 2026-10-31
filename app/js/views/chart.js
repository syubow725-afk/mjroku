// 収支グラフ（ホームの年別グラフ）：棒＝期間ごとの収支、折れ線＝累計。縦軸は 1 本（どちらも同じ単位の P）
// 外部ライブラリは使わず SVG を組み立てる（オフラインでも動かすため）。色は CSS のトークン（--chart-*）で付ける
import { h, setChildren, formatMoney } from '../util.js';

const SVG = 'http://www.w3.org/2000/svg';
const W = 340;           // viewBox の幅。画面幅に合わせて伸び縮みする
const H = 200;
const PAD = { top: 12, right: 8, bottom: 22, left: 44 };
const BAR_MAX = 24;      // 棒の太さの上限
const RADIUS = 4;        // 棒の先（0 から遠い側）の角丸

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

// 目盛りの間隔を 1・2・5 × 10^n に丸める
function niceStep(range, count) {
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

// 目盛りの文字：1 万以上は「万」、1,000 以上は「千」
export function compactYen(v) {
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  if (abs >= 10000) return `${sign}${+(abs / 10000).toFixed(1)}万`;
  if (abs >= 1000) return `${sign}${+(abs / 1000).toFixed(1)}千`;
  return `${sign}${abs}`;
}

// 0 の線から上下に伸びる棒。0 から遠い側だけ角を丸め、0 の側は四角のまま
function barPath(x, w, y0, y1) {
  const r = Math.min(RADIUS, w / 2, Math.abs(y1 - y0));
  if (y1 < y0) { // 上向き（プラス）
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

// points：model.periodTotals の結果。unit：棒の 1 本が何か（'月ごと' など）
// 棒の列をタップすると、その期間の収支と累計を下の行に出す（最初は最後に対局した期間）
export function balanceChart(points, { unit }) {
  const values = points.flatMap((p) => [p.value, p.cumulative ?? 0]);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = 1000;
  const step = niceStep(max - min, 4);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v) => PAD.top + ((max - v) / (max - min)) * plotH;
  const band = plotW / points.length;
  const barW = Math.min(BAR_MAX, band * 0.6);
  const cx = (i) => PAD.left + band * (i + 0.5);
  // 横軸の文字は、多いときは間引く（月なら 1・3・5…月）
  const labelEvery = points.length > 8 ? 2 : 1;

  const grid = [];
  for (let v = min; v <= max + step / 2; v += step) {
    grid.push(svg('line', { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: v === 0 ? 'chart-zero' : 'chart-grid' }));
    grid.push(svg('text', { x: PAD.left - 6, y: y(v) + 3.5, class: 'chart-tick', 'text-anchor': 'end' }, document.createTextNode(compactYen(v))));
  }

  const bars = points.map((p, i) => (p.value
    ? svg('path', { d: barPath(cx(i) - barW / 2, barW, y(0), y(p.value)), class: `chart-bar ${p.value > 0 ? 'pos' : 'neg'}` })
    : null));
  const xLabels = points.map((p, i) => (i % labelEvery === 0
    ? svg('text', { x: cx(i), y: H - 6, class: 'chart-tick', 'text-anchor': 'middle' },
        document.createTextNode(p.label.replace(/[年月]$/, '')))
    : null));

  const linePts = points.map((p, i) => (p.cumulative == null ? null : `${cx(i)},${y(p.cumulative)}`)).filter(Boolean);
  const line = linePts.length > 1 ? svg('polyline', { points: linePts.join(' '), class: 'chart-line' }) : null;

  // 選んでいる期間の印（縦の細線と、累計の点）
  const cursor = svg('line', { y1: PAD.top, y2: H - PAD.bottom, class: 'chart-cursor' });
  const dot = svg('circle', { r: 4, class: 'chart-dot' });
  const readout = h('p', { class: 'chart-readout', 'aria-live': 'polite' });

  const select = (i) => {
    const p = points[i];
    cursor.setAttribute('x1', cx(i));
    cursor.setAttribute('x2', cx(i));
    dot.style.display = p.cumulative == null ? 'none' : ''; // SVG の要素には hidden が効かない
    if (p.cumulative != null) {
      dot.setAttribute('cx', cx(i));
      dot.setAttribute('cy', y(p.cumulative));
    }
    setChildren(readout,
      h('strong', null, p.label), '　収支 ', h('span', { class: 'num' }, formatMoney(p.value)),
      p.cumulative == null ? null : ['・累計 ', h('span', { class: 'num' }, formatMoney(p.cumulative))]);
  };

  // タップの当たり判定は棒より広く、列全体にする
  const hits = points.map((p, i) => svg('rect', {
    x: PAD.left + band * i, y: PAD.top, width: band, height: plotH, class: 'chart-hit',
  }));
  hits.forEach((rect, i) => {
    rect.addEventListener('click', () => select(i));
    rect.addEventListener('pointerenter', () => select(i));
  });

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `収支（${unit}）と累計のグラフ` },
    ...grid, ...bars, line, cursor, dot, ...xLabels, ...hits);

  const lastIndex = points.reduce((last, p, i) => (p.cumulative != null ? i : last), points.length - 1);
  select(lastIndex);

  // 色だけに頼らないよう、凡例と表も付ける
  const legend = h('div', { class: 'chart-legend' },
    h('span', null, h('i', { class: 'key-bar pos' }), h('i', { class: 'key-bar neg' }), `収支（${unit}）`),
    h('span', null, h('i', { class: 'key-line' }), '累計'));
  const table = h('details', { class: 'chart-table' },
    h('summary', null, '表で見る'),
    h('table', { class: 'score' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, '収支'), h('th', null, '累計'))),
      h('tbody', null, points.map((p) => h('tr', null,
        h('th', null, p.label),
        h('td', null, formatMoney(p.value)),
        h('td', null, p.cumulative == null ? '—' : formatMoney(p.cumulative)))))));

  return h('div', { class: 'chart-wrap' }, legend, chart, readout, table);
}
