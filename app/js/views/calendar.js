// 収支カレンダー（ホーム）：1 か月分を日曜始まりで並べ、対局した日にその日の収支（ゲーム代込）を出す。
// 月は ‹ › で、対局のある最初の月から最後の月まで動かせる。日をタップすると、その日の対局へのリンクを出す
import { h, setChildren, formatDate, formatMoney, signClass } from '../util.js';
import { monthGrid } from '../model.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// daily：model.memberDailyBalances の結果（日付順）。month："2026-10"、onMonth(month)：月を動かしたとき
export function balanceCalendar(daily, { month, onMonth }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const months = [...new Set(daily.map((d) => d.date.slice(0, 7)))];
  const first = months[0];
  const last = months[months.length - 1];
  const [year, mon] = month.split('-').map(Number);
  const shift = (n) => {
    const d = new Date(year, mon - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const inMonth = daily.filter((d) => d.date.startsWith(month));
  const total = inMonth.reduce((n, d) => n + d.balance, 0);
  const detail = h('div', { class: 'cal-detail', 'aria-live': 'polite' });

  // その日の収支と、対局（1 日に複数あれば全部）へのリンク
  const showDay = (d) => setChildren(detail,
    h('strong', null, formatDate(d.date)), '　',
    h('span', { class: signClass(d.balance) }, formatMoney(d.balance)), '　',
    d.sessionIds.map((id, i) => h('a', { href: `#/session/${id}` }, d.sessionIds.length > 1 ? `対局 ${i + 1}` : '対局を見る')));

  const weeks = monthGrid(year, mon).map((week) => h('tr', null, week.map((date) => {
    if (!date) return h('td', { class: 'cal-empty' });
    const d = byDate.get(date);
    const day = Number(date.slice(8));
    if (!d) return h('td', null, h('span', { class: 'cal-day' }, day));
    return h('td', { class: 'cal-played' },
      h('button', { type: 'button', class: 'cal-cell', onclick: () => showDay(d), 'aria-label': `${formatDate(date)} ${formatMoney(d.balance)}` },
        h('span', { class: 'cal-day' }, day),
        h('span', { class: `cal-value ${signClass(d.balance)}` }, formatMoney(d.balance))));
  })));

  if (inMonth.length) showDay(inMonth[inMonth.length - 1]);

  return h('div', { class: 'calendar' },
    h('div', { class: 'cal-head' },
      h('button', { type: 'button', class: 'small secondary', disabled: month <= first, onclick: () => onMonth(shift(-1)), 'aria-label': '前の月' }, '‹'),
      h('div', { class: 'cal-title' },
        h('strong', null, `${year}年${mon}月`),
        h('div', { class: 'muted small' }, inMonth.length
          ? ['収支 ', h('span', { class: signClass(total) }, formatMoney(total)), `・${inMonth.length} 日`]
          : '対局なし')),
      h('button', { type: 'button', class: 'small secondary', disabled: month >= last, onclick: () => onMonth(shift(1)), 'aria-label': '次の月' }, '›')),
    h('table', { class: 'cal-grid' },
      h('thead', null, h('tr', null, WEEKDAYS.map((w, i) => h('th', { class: i === 0 ? 'sun' : i === 6 ? 'sat' : '' }, w)))),
      h('tbody', null, weeks)),
    detail);
}
