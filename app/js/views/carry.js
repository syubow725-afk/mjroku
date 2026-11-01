// 本家からの繰り越し（管理者だけ。仕様書 9 章）：表示中のグループのメンバーごとに、切替日時点の本家通算を入れる。
// 切替日より前の対局を手入力すると、その分を自動で減らす（model.effectiveCarryovers）。
// 過去の対局を全部入れ終えると繰り越しは 0 になるので、一覧で 0 になっていない人が入力漏れの手がかりになる。
// 書き込みは送信待ち経由（電波がなくても入れられる）。権限の判定は GAS が行う
import { h, formatMoney } from '../util.js';
import { formatPt, parsePt } from '../calc.js';
import { effectiveCarryovers, carryBase, CARRY_KEYS } from '../model.js';

// [キー, 見出し, 表示, 入力欄の単位]
const ITEMS = [
  ['pt10', 'スコア', formatPt, 'pt'],
  ['chips', 'チップ', (n) => `${n > 0 ? '+' : ''}${n}`, '枚'],
  ['subtotal', '収支', formatMoney, 'P'],
  ['balance', 'ゲーム代込収支', formatMoney, 'P'],
  ['games', '半荘数', String, '半荘'],
  ['days', '日数', String, '日'],
];

function guard(ctx) {
  const { store } = ctx;
  if (!store.isAdmin) {
    return { title: '本家からの繰り越し', back: '#/settings', body: h('p', { class: 'empty' }, '管理者の合言葉で接続したときだけ使えます。') };
  }
  if (!store.group) {
    return { title: '本家からの繰り越し', back: '#/admin', body: h('p', { class: 'empty' }, 'まだ GAS と同期できていません。') };
  }
  return null;
}

const isZero = (carry) => CARRY_KEYS.every((k) => carry[k] === 0);

// 繰り越しの行と、その人の計算結果（切替日がなければ手入力済みは数えない）
function carryInfo(store) {
  const t = store.tables();
  const cutover = store.group.cutover_date || '';
  const rows = Object.fromEntries(store.list('carryovers').map((r) => [r.member_id, r]));
  const effective = Object.fromEntries(effectiveCarryovers(t, cutover).map((c) => [c.memberId, c]));
  return { cutover, rows, effective };
}

export function carryListView(ctx) {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const { store } = ctx;
  const { cutover, rows, effective } = carryInfo(store);
  const members = store.list('members').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const entered = members.filter((m) => rows[m.id]);
  const left = entered.filter((m) => effective[m.id] && !isZero(effective[m.id].carry));

  let summary;
  if (!cutover) summary = h('p', { class: 'result ng' }, '切替日が未設定です。グループの設定で切替日を入れると、繰り越しが成績に入り、切替日より前の対局の分が自動で減ります。');
  else if (!entered.length) summary = h('p', { class: 'muted' }, 'まだ誰も入れていません。');
  else if (!left.length) summary = h('p', { class: 'result ok' }, `全員の繰り越しが 0 です（切替日より前の対局をすべて入れ終えています）。`);
  else summary = h('p', { class: 'muted' }, `繰り越しが残っている人：${left.length} 人。過去の対局をすべて入れ終えたら 0 になります。`);

  return {
    title: '本家からの繰り越し',
    back: '#/admin',
    live: true,
    body: h('div', null,
      h('section', { class: 'card' },
        h('dl', { class: 'kv' },
          h('dt', null, 'グループ'), h('dd', null, store.group.name),
          h('dt', null, '切替日'), h('dd', null, cutover || '未設定')),
        summary),
      h('ul', { class: 'list' }, members.map((m) => {
        const row = rows[m.id];
        const eff = effective[m.id];
        let sub = '未入力';
        let tag = null;
        if (row) {
          const base = carryBase(row);
          sub = `本家通算 ${formatMoney(base.balance)}・${base.games} 半荘`;
          if (eff) {
            sub += ` ／ 繰り越し ${formatMoney(eff.carry.balance)}・${eff.carry.games} 半荘`;
            tag = isZero(eff.carry) ? h('span', { class: 'tag' }, '0') : null;
          }
        }
        return h('li', null, h('a', { class: 'list-item link', href: `#/admin/carry/${m.id}` },
          h('div', { class: 'list-main' },
            h('div', { class: 'card-head' }, h('strong', null, m.name), tag),
            h('div', { class: 'list-sub' }, sub)),
          h('span', { class: 'muted' }, '›')));
      })),
      h('p', { class: 'muted small' },
        '本家の「全件集計」を、このグループの対局だけに絞った値を入れます。',
        '繰り越しは期間が全期間のときだけ成績に足します。着順の率は本アプリに入れた分だけで数えます。')),
  };
}

// 入力欄の文字を整数にする（全角・カンマ・「−」も受ける）。読めなければ undefined、空なら 0
function parseInt10(text, { pt = false, min = -Infinity } = {}) {
  const s = String(text).replace(/[,，\s]/g, '');
  if (s === '') return 0;
  const v = parsePt(s); // 小数第 1 位までの 10 倍の整数
  if (v == null) return undefined;
  if (!pt && v % 10 !== 0) return undefined;
  const n = pt ? v : v / 10;
  return n < min ? undefined : n;
}

export function carryEditView(ctx, memberId) {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const { store } = ctx;
  const member = store.get('members', memberId);
  if (!member || member.deleted) return ctx.notFound();
  const { cutover, rows, effective } = carryInfo(store);
  const row = rows[memberId];
  const base = row ? carryBase(row) : null;
  const eff = effective[memberId];

  const inputs = Object.fromEntries(ITEMS.map(([key, , , unit]) => {
    const value = base ? (key === 'pt10' ? formatPt(base[key]).replace(/^\+/, '') : String(base[key])) : '';
    return [key, h('input', { inputmode: key === 'games' || key === 'days' ? 'numeric' : 'text', class: 'narrow', value, autocomplete: 'off', 'aria-label': unit })];
  }));
  const message = h('p', { class: 'result' });

  const save = () => {
    const values = {};
    for (const [key, label] of ITEMS) {
      const v = parseInt10(inputs[key].value, { pt: key === 'pt10', min: key === 'games' || key === 'days' ? 0 : -Infinity });
      if (v === undefined) {
        message.className = 'result ng';
        message.textContent = `${label}が読めません（${key === 'pt10' ? '小数第 1 位まで' : '整数'}${key === 'games' || key === 'days' ? '・0 以上' : ''}）`;
        return;
      }
      values[key] = v;
    }
    store.write({
      carryovers: [{
        id: `${store.group.id}:${memberId}`, group_id: store.group.id, member_id: memberId,
        pt: values.pt10 / 10, chips: values.chips, subtotal: values.subtotal, balance: values.balance, games: values.games, days: values.days,
        deleted: false,
      }],
    });
    ctx.replace('#/admin/carry');
  };

  const remove = () => {
    if (!confirm(`${member.name}さんの繰り越しを消しますか？\n成績には本アプリに入れた対局だけが残ります。`)) return;
    store.write({ carryovers: [{ id: row.id, deleted: true }] });
    ctx.replace('#/admin/carry');
  };

  return {
    title: member.name,
    back: '#/admin/carry',
    body: h('div', null,
      h('section', { class: 'card' },
        h('h2', null, '本家通算（切替日時点の全件集計）'),
        h('div', { class: 'carry-fields' }, ITEMS.map(([key, label, , unit]) => h('label', { class: 'field' }, h('span', null, label),
          h('div', { class: 'inline' }, inputs[key], h('span', null, unit))))),
        h('p', { class: 'muted small' }, '収支はゲーム代を引く前、ゲーム代込収支は引いた後の値です。マイナスは「-」か「−」で入れます。'),
        h('button', { type: 'button', onclick: save }, '保存'),
        row ? h('button', { type: 'button', class: 'block danger', onclick: remove }, '繰り越しを消す') : null,
        message),
      row
        ? h('section', { class: 'card' },
            h('h2', null, '差し引き'),
            cutover
              ? h('div', { class: 'table-wrap' }, h('table', { class: 'carry-table' },
                  h('thead', null, h('tr', null, h('th'), h('th', null, '本家通算'), h('th', null, '入力済'), h('th', null, '繰り越し'))),
                  h('tbody', null, ITEMS.map(([key, label, fmt]) => h('tr', null,
                    h('th', null, label),
                    h('td', null, fmt(eff.base[key])),
                    h('td', null, fmt(eff.entered[key])),
                    h('td', { class: eff.carry[key] === 0 ? '' : 'left' }, fmt(eff.carry[key])))))))
              : h('p', { class: 'muted' }, '切替日が未設定なので、まだ差し引きしません。'),
            cutover ? h('p', { class: 'muted small' }, `入力済は、切替日 ${cutover} より前の対局を本アプリに入れた分。繰り越し ＝ 本家通算 − 入力済で、過去の対局を全部入れると 0 になります。`) : null)
        : null),
  };
}
