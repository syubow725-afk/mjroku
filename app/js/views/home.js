// ホーム（個人成績。仕様書 8 章）：1 人分の通算成績。表示するメンバーと期間を切り替えられる
// 数字はすべて開いた時点のデータで計算する（model.aggregate）
import { h, formatMoney, signClass } from '../util.js';
import { formatPt } from '../calc.js';
import { getConfig } from '../config.js';
import { memberName, filterSessions, aggregate, memberDailyBalances, periodTotals, opponentStats } from '../model.js';
import { balanceChart } from './chart.js';
import { balanceCalendar } from './calendar.js';

// 表示するメンバーと期間。画面を移っても残す（アプリを閉じたら初期値に戻る）
//   memberId：null なら設定の「自分の名前」のメンバー
//   period  ：'all'＝全期間、'2026' などの年
//   month   ：カレンダーの月（"2026-10"）。期間の外や未設定なら、最後に対局した月
const state = { memberId: null, period: 'all', month: null };

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
  const sessionIds = sessions.map((s) => s.id);
  const daily = memberDailyBalances(t, sessionIds, state.memberId);
  // 年別グラフ：全期間なら年ごと、年を選んだらその年の月ごと
  const points = periodTotals(daily, state.period);
  // カレンダー：対局のある最初の月〜最後の月の範囲で動かす
  if (daily.length) {
    const [first, last] = [daily[0].date.slice(0, 7), daily[daily.length - 1].date.slice(0, 7)];
    if (!state.month || state.month < first || state.month > last) state.month = last;
  }
  const calendar = daily.length
    ? balanceCalendar(daily, { month: state.month, onMonth: (m) => { state.month = m; ctx.refresh(); } })
    : null;
  const opponents = opponentStats(t, sessionIds, state.memberId);

  // メンバーや期間を変えたら、カレンダーは最後に対局した月に戻す
  const change = (key) => (e) => { state[key] = e.target.value; state.month = null; ctx.refresh(); };
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
      stats ? statsBody(stats, { points, period: state.period, calendar, opponents, t }) : h('p', { class: 'empty' }, `${memberName(t, state.memberId)}さんの対局はまだありません`)),
  };
}

function statsBody(s, { points, period, calendar, opponents, t }) {
  const tile = (label, value, cls = '') => h('div', { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: `stat-value ${cls}` }, value));

  return h('div', { class: 'home' },
    h('section', { class: 'card hero' },
      h('div', { class: 'stat-label' }, '収支（ゲーム代込）'),
      h('div', { class: `hero-value ${signClass(s.balance)}` }, formatMoney(s.balance)),
      h('div', { class: 'muted small' }, 'ゲーム代別 ', h('span', { class: signClass(s.subtotal) }, formatMoney(s.subtotal)))),

    h('section', { class: 'card' },
      h('h2', null, period === 'all' ? '年ごとの収支' : `${period}年の収支`),
      balanceChart(points, { unit: period === 'all' ? '年ごと' : '月ごと' })),

    h('section', { class: 'stat-grid' },
      tile('総スコア', formatPt(s.pt10), signClass(s.pt10)),
      tile('総チップ', formatChips(s.chips), signClass(s.chips)),
      tile('平均着順', s.avgRank == null ? '—' : s.avgRank.toFixed(2)),
      tile('対局数', `${s.games} 半荘`),
      tile('日数', `${s.days} 日`),
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
      `飛び率は素点で入れた半荘（${s.scoredGames} 回）だけで数えます。素点がマイナスなら飛び（0 点ちょうどは数えません）。`),

    calendar ? h('section', { class: 'card' }, h('h2', null, 'カレンダー'), calendar) : null,

    opponents.length ? h('section', { class: 'card' },
      h('h2', null, '相手ごとの成績'),
      opponentList(opponents, t),
      h('p', { class: 'muted small' },
        'その相手と同じ半荘を打ったときの、自分の成績です。収支はゲーム代を含みません。',
        'チップは対局ごとの記録なので、その相手と 1 回でも同卓した対局の分を数えます。',
        '勝ち・負けは、その半荘の着順で相手より上か下か。平均着順は「自分 / 相手」。')) : null);
}

// 相手 1 人ずつのカード。本家の相手別と同じ 4 項目（対局数・スコア・収支・チップ）に、勝ち負けと平均着順を添える
function opponentList(rows, t) {
  const value = (label, text, cls = '') => h('div', { class: 'opp-value' },
    h('div', { class: 'stat-label' }, label), h('div', { class: `num ${cls}` }, text));
  return h('ul', { class: 'list opponents' }, rows.map((o) => h('li', { class: 'opp-item' },
    h('div', { class: 'card-head' },
      h('strong', { class: 'card-title' }, memberName(t, o.memberId)),
      h('span', { class: 'muted small' }, `${o.games} 半荘`)),
    h('div', { class: 'opp-values' },
      value('スコア', formatPt(o.myPt10), signClass(o.myPt10)),
      value('収支', formatMoney(o.money), signClass(o.money)),
      value('チップ', formatChips(o.chips), signClass(o.chips))),
    h('div', { class: 'list-sub' },
      `${o.wins} 勝 ${o.losses} 敗（${formatRate(o.winRate)}）・平均着順 ${o.myAvgRank.toFixed(2)} / ${o.theirAvgRank.toFixed(2)}`))));
}
