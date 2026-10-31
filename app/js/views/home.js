// ホーム（個人成績。仕様書 8 章）：1 人分の通算成績。表示するメンバーと期間を切り替えられる
// 数字はすべて開いた時点のデータで計算する（model.aggregate）
import { h, formatMoney, signClass } from '../util.js';
import { formatPt } from '../calc.js';
import { getConfig } from '../config.js';
import { memberName, filterSessions, aggregate } from '../model.js';

// 表示するメンバーと期間。画面を移っても残す（アプリを閉じたら初期値に戻る）
//   memberId：null なら設定の「自分の名前」のメンバー
//   period  ：'all'＝全期間、'2026' などの年
const state = { memberId: null, period: 'all' };

export const formatRate = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const formatChips = (v) => (v > 0 ? `+${v}` : String(v));

// 設定の「自分の名前」と同じ名前のメンバー。いなければ最初のメンバー
function defaultMemberId(members) {
  const myName = getConfig().myName;
  return (members.find((m) => m.name === myName) || members[0])?.id || null;
}

export function homeView(ctx) {
  const { store } = ctx;
  const t = store.tables();
  const members = store.list('members').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!members.length) {
    return {
      title: 'ホーム',
      live: true,
      body: h('p', { class: 'empty' }, 'まだメンバーがいません。', h('a', { href: '#/members' }, 'メンバー'), 'から登録してください。'),
    };
  }
  if (!members.some((m) => m.id === state.memberId)) state.memberId = defaultMemberId(members);

  const all = store.list('sessions');
  const years = [...new Set(all.map((s) => s.date.slice(0, 4)))].sort().reverse();
  if (state.period !== 'all' && !years.includes(state.period)) state.period = 'all';
  const range = state.period === 'all' ? {} : { from: `${state.period}-01-01`, to: `${state.period}-12-31` };
  const sessions = filterSessions(all, range);
  const stats = aggregate(t, sessions.map((s) => s.id)).find((r) => r.memberId === state.memberId);

  const change = (key) => (e) => { state[key] = e.target.value; ctx.refresh(); };
  const memberSelect = h('select', { onchange: change('memberId'), 'aria-label': '表示するメンバー' },
    members.map((m) => h('option', { value: m.id, selected: m.id === state.memberId }, m.name)));
  const periodSelect = h('select', { onchange: change('period'), 'aria-label': '期間' },
    h('option', { value: 'all', selected: state.period === 'all' }, '全期間'),
    years.map((y) => h('option', { value: y, selected: state.period === y }, `${y}年`)));

  return {
    title: 'ホーム',
    live: true,
    body: h('div', null,
      h('div', { class: 'filter-row' }, memberSelect, periodSelect),
      stats ? statsBody(stats) : h('p', { class: 'empty' }, `${memberName(t, state.memberId)}さんの対局はまだありません`)),
  };
}

function statsBody(s) {
  const tile = (label, value, cls = '') => h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: `stat-value ${cls}` }, value));

  return h('div', { class: 'home' },
    h('section', { class: 'card hero' },
      h('div', { class: 'stat-label' }, '収支（ゲーム代込）'),
      h('div', { class: `hero-value ${signClass(s.balance)}` }, formatMoney(s.balance)),
      h('div', { class: 'muted small' }, 'ゲーム代別 ', h('span', { class: signClass(s.subtotal) }, formatMoney(s.subtotal)))),

    h('section', { class: 'stat-grid' },
      tile('総スコア', formatPt(s.pt10), signClass(s.pt10)),
      tile('総チップ', formatChips(s.chips), signClass(s.chips)),
      tile('平均着順', s.avgRank == null ? '—' : s.avgRank.toFixed(2)),
      tile('対局数', `${s.sessions} 日`),
      tile('半荘数', `${s.games} 回`),
      tile('飛び率', formatRate(s.tobiRate))),

    h('div', { class: 'table-wrap' }, h('table', { class: 'score ranks' },
      h('thead', null, h('tr', null, h('th', null, ''), ['1着', '2着', '3着', '4着'].map((c) => h('th', null, c)))),
      h('tbody', null,
        h('tr', null, h('th', null, '回数'), s.rankCounts.map((n) => h('td', null, n))),
        h('tr', null, h('th', null, '率'), s.rankRates.map((v) => h('td', null, formatRate(v))))))),

    h('section', { class: 'stat-grid' },
      tile('トップ率', formatRate(s.topRate)),
      tile('連対率', formatRate(s.rentaiRate)),
      tile('ラス回避率', formatRate(s.lastAvoidRate))),

    h('p', { class: 'muted small' },
      `飛び率は素点で入れた半荘（${s.scoredGames} 回）だけで数えます。素点がマイナスなら飛び（0 点ちょうどは数えません）。`));
}
