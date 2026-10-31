// ランキング（仕様書 8 章）：項目と期間を選び、メンバーを高い順に並べる。
// 本家は毎朝の集計だが、本アプリは開いた時点のデータで計算する
import { h, signClass } from '../util.js';
import { formatPt } from '../calc.js';
import { getConfig, getMinGames } from '../config.js';
import { memberName, filterSessions, aggregate, rankBy, rankWithMinimum } from '../model.js';
import { formatRate, formatChips } from './home.js';

// [キー, 表示名, 値の取り出し, 表示の形, 色を付けるか, 率か（規定半荘数を当てる）]
// 対局数は本家に合わせて半荘の数（日数は各行の添え書きに出す）
const METRICS = [
  ['pt10', '総スコア', (r) => r.pt10, formatPt, true, false],
  ['chips', '総チップ', (r) => r.chips, formatChips, true, false],
  ['games', '対局数', (r) => r.games, (v) => `${v} 半荘`, false, false],
  ['topRate', 'トップ率', (r) => r.topRate, formatRate, false, true],
  ['rentaiRate', '連対率', (r) => r.rentaiRate, formatRate, false, true],
  ['lastAvoidRate', 'ラス回避率', (r) => r.lastAvoidRate, formatRate, false, true],
];

// 選んでいる項目と期間。画面を移っても残す
const state = { metric: 'pt10', period: 'all' };

export function rankingView(ctx) {
  const { store } = ctx;
  const t = store.tables();
  const all = store.list('sessions');
  const years = [...new Set(all.map((s) => s.date.slice(0, 4)))].sort().reverse();
  if (state.period !== 'all' && !years.includes(state.period)) state.period = 'all';
  const range = state.period === 'all' ? {} : { from: `${state.period}-01-01`, to: `${state.period}-12-31` };
  const rows = aggregate(t, filterSessions(all, range).map((s) => s.id));

  const [, label, value, format, colored, isRate] = METRICS.find(([key]) => key === state.metric);
  const minGames = getMinGames();
  const { ranked, below } = isRate ? rankWithMinimum(rows, value, minGames) : { ranked: rankBy(rows, value), below: [] };
  const myName = getConfig().myName;

  const change = (key) => (e) => { state[key] = e.target.value; ctx.refresh(); };
  const metricSelect = h('select', { onchange: change('metric'), 'aria-label': '項目' },
    METRICS.map(([key, name]) => h('option', { value: key, selected: key === state.metric }, name)));
  const periodSelect = h('select', { onchange: change('period'), 'aria-label': '期間' },
    h('option', { value: 'all', selected: state.period === 'all' }, '全期間'),
    years.map((y) => h('option', { value: y, selected: state.period === y }, `${y}年`)));

  // place が null の行は規定未満（順位なし・灰色）
  const item = ({ row, value: v, place = null }) => {
    const name = memberName(t, row.memberId);
    return h('li', { class: `rank-item${name === myName ? ' me' : ''}${place == null ? ' below' : ''}` },
      h('span', { class: `place place-${place}` }, place ?? '—'),
      h('div', { class: 'list-main' },
        h('div', { class: 'rank-name' }, name),
        h('div', { class: 'list-sub' }, `${row.games} 半荘・${row.days} 日`)),
      h('span', { class: `rank-value ${colored ? signClass(v) : ''}` }, v == null ? '—' : format(v)));
  };
  const items = ranked.map(item);

  return {
    title: 'ランキング',
    live: true,
    body: h('div', null,
      h('div', { class: 'filter-row' }, metricSelect, periodSelect),
      items.length
        ? h('ol', { class: 'list ranking', 'aria-label': `${label}のランキング` }, items)
        : h('p', { class: 'empty' }, rows.length ? `${minGames} 半荘以上打った人はまだいません` : 'この期間の対局はありません'),
      below.length
        ? h('section', { class: 'below-section' },
            h('h2', { class: 'below-head' }, `規定未満（${minGames} 半荘未満）`),
            h('ul', { class: 'list ranking' }, below.map(item)))
        : null,
      isRate
        ? h('p', { class: 'muted small' }, `率は打った半荘の数で割っています。順位は ${minGames} 半荘以上の人だけに付けます（`, h('a', { href: '#/settings' }, '設定'), 'で変えられます）。')
        : null),
  };
}
