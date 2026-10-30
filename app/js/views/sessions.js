// 対局の一覧（履歴・絞り込み・集計）と、対局の作成・編集画面
import { h, setChildren, newId, todayStr, formatDate, formatMoney, signClass, readInt } from '../util.js';
import { formatPt } from '../calc.js';
import { getConfig, isConfigured } from '../config.js';
import {
  buildSession, memberName, sessionChanges, ruleSnapshot, filterSessions, aggregate, sessionRule, recomputeScoreResults,
} from '../model.js';
import { addMember } from './members.js';
import { ruleSettings } from './rule-settings.js';

// ルールのシートがまだ読めていないときの標準ルール（GAS の「シートを準備」で入るものと同じ）
const FALLBACK_PRESET = {
  id: 'r_standard', name: 'いつものルール', group_id: '', players: 4, start_points: 25000, return_points: 30000,
  uma: '20,10,-10,-20', uma_oka: true, rounding: 'round4', tie_break: 'seat',
};

// 絞り込みの状態。画面を移っても残す（アプリを閉じたら全期間に戻る）
//   period：'all'＝全期間、'2026' などの年、'custom'＝from〜to を指定
const filter = { period: 'all', from: '', to: '', rule: '' };

function effectiveFilter() {
  if (filter.period === 'all') return { rule: filter.rule };
  if (filter.period === 'custom') return { from: filter.from, to: filter.to, rule: filter.rule };
  return { from: `${filter.period}-01-01`, to: `${filter.period}-12-31`, rule: filter.rule };
}

function filteredSessions(store) {
  return filterSessions(store.list('sessions'), effectiveFilter())
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));
}

function describeFilter() {
  const parts = [];
  if (filter.period === 'all') parts.push('全期間');
  else if (filter.period === 'custom') parts.push(`${filter.from || '最初'} 〜 ${filter.to || '最後'}`);
  else parts.push(`${filter.period}年`);
  if (filter.rule) parts.push(filter.rule);
  return parts.join('・');
}

export function sessionsView(ctx) {
  const { store } = ctx;
  if (!isConfigured()) {
    return {
      title: '対局',
      live: true,
      body: h('p', { class: 'empty' }, '最初に', h('a', { href: '#/settings' }, '設定'), 'で GAS の URL と合言葉を入れてください。'),
    };
  }

  const t = store.tables();
  const all = store.list('sessions');
  const sessions = filteredSessions(store);

  // 絞り込み：期間（全期間・年・指定）とルール（2 種類以上あるときだけ出す）
  const years = [...new Set(all.map((s) => s.date.slice(0, 4)))].sort().reverse();
  const change = (key) => (e) => { filter[key] = e.target.value; ctx.refresh(); };
  const periodSelect = h('select', { onchange: change('period') },
    h('option', { value: 'all', selected: filter.period === 'all' }, '全期間'),
    years.map((y) => h('option', { value: y, selected: filter.period === y }, `${y}年`)),
    h('option', { value: 'custom', selected: filter.period === 'custom' }, '期間を指定'));
  const rules = [...new Set(all.map((s) => s.rule_name).filter(Boolean))];
  const ruleSelect = rules.length > 1 || filter.rule
    ? h('select', { onchange: change('rule') },
        h('option', { value: '', selected: !filter.rule }, 'すべてのルール'),
        rules.map((r) => h('option', { value: r, selected: filter.rule === r }, r)))
    : null;
  const range = filter.period === 'custom'
    ? h('div', { class: 'range' },
        h('input', { type: 'date', value: filter.from, onchange: change('from') }), '〜',
        h('input', { type: 'date', value: filter.to, onchange: change('to') }))
    : null;

  // 対局カード：日付・タイトル・半荘数と、参加者ごとの収支
  const items = sessions.map((s) => {
    const model = buildSession(t, s.id);
    return h('li', null, h('a', { class: 'list-item link', href: `#/session/${s.id}` },
      h('div', { class: 'list-main' },
        h('div', { class: 'card-head' },
          h('strong', null, formatDate(s.date)),
          h('span', { class: 'card-title' }, s.title || ''),
          h('span', { class: 'muted small' }, `${model.hanchans.length} 半荘`)),
        h('div', { class: 'balances' }, model.summary.map((r) => h('span', null,
          h('span', { class: 'muted' }, memberName(t, r.memberId)), ' ',
          h('span', { class: signClass(r.balance) }, formatMoney(r.balance))))))));
  });

  return {
    title: '対局',
    live: true,
    body: h('div', null,
      h('a', { class: 'button block', href: '#/sessions/new' }, '＋ 新しい対局'),
      all.length
        ? h('div', { class: 'filter' },
            h('div', { class: 'filter-row' }, periodSelect, ruleSelect),
            range,
            h('a', { class: 'button secondary block', href: '#/summary' }, `集計（${sessions.length} 対局）`))
        : null,
      items.length
        ? h('ul', { class: 'list' }, items)
        : h('p', { class: 'empty' }, all.length ? 'この条件の対局はありません' : 'まだ対局がありません')),
  };
}

// 集計：絞り込んだ対局をメンバーごとに合算する（絞り込みなしなら全件集計）
export function summaryView(ctx) {
  const { store } = ctx;
  const t = store.tables();
  const sessions = filteredSessions(store);
  const rows = aggregate(t, sessions.map((s) => s.id));

  const num = (v, format = String) => h('td', { class: signClass(v) }, format(v));
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'score summary' },
    h('thead', null, h('tr', null,
      ['', '収支', '小計', 'pt', 'チップ', '日数', '半荘', '1着', '2着', '3着', '4着', 'トップ率', '平均'].map((c) => h('th', null, c)))),
    h('tbody', null, rows.map((r) => h('tr', null,
      h('th', null, memberName(t, r.memberId)),
      num(r.balance, formatMoney),
      num(r.subtotal, formatMoney),
      num(r.pt10, formatPt),
      num(r.chips, (v) => (v > 0 ? `+${v}` : String(v))),
      h('td', null, r.sessions),
      h('td', null, r.games),
      r.rankCounts.map((n) => h('td', null, n)),
      h('td', null, pct(r.rankCounts[0], r.games)),
      h('td', null, r.avgRank == null ? '—' : r.avgRank.toFixed(2)))))));

  return {
    title: '集計',
    back: '#/sessions',
    live: true,
    body: h('div', null,
      h('p', { class: 'muted small' }, `${describeFilter()}・${sessions.length} 対局。収支はゲーム代込、小計はゲーム代別。`),
      rows.length ? table : h('p', { class: 'empty' }, '対局がありません')),
  };
}

// 対局の作成（sessionId が null）と編集
export function sessionFormView(ctx, sessionId) {
  const { store } = ctx;
  const t = store.tables();
  const existing = sessionId ? t.sessions[sessionId] : null;
  if (sessionId && (!existing || existing.deleted)) return ctx.notFound();
  if (!store.group) {
    return {
      title: '新しい対局',
      back: '#/sessions',
      body: h('p', { class: 'empty' }, 'まだ GAS と同期できていません。', h('a', { href: '#/settings' }, '設定'), 'を確認してください。'),
    };
  }

  // 新規の初期値は直近の対局から引き継ぐ（レート等は毎回ほぼ同じため）
  const latest = store.list('sessions').sort((a, b) => b.date.localeCompare(a.date))[0];
  const base = existing || {
    date: todayStr(), title: '', memo: '',
    rate: latest?.rate ?? 50, chip_rate: latest?.chip_rate ?? 200, game_fee: latest?.game_fee ?? 0,
    rule_name: latest?.rule_name,
  };

  // ルール：プリセットを選び、端数処理とウマ・オカを切り替える。編集時は対局に保存したルールから始める
  const presets = store.list('rules');
  if (!presets.length) presets.push(FALLBACK_PRESET);
  const snapshotId = (() => {
    try { return JSON.parse(base.rule_snapshot || '{}').id; } catch { return undefined; }
  })();
  const initialPreset = presets.find((p) => p.id === snapshotId) || presets.find((p) => p.name === base.rule_name) || presets[0];
  const rules = ruleSettings({
    presets,
    initialPresetId: initialPreset.id,
    initialRule: existing ? sessionRule(existing) : null,
  });

  const date = h('input', { type: 'date', value: base.date });
  const title = h('input', { type: 'text', value: base.title, placeholder: '任意', autocomplete: 'off' });
  const rate = h('input', { inputmode: 'numeric', value: String(base.rate ?? '') });
  const chipRate = h('input', { inputmode: 'numeric', value: String(base.chip_rate ?? '') });
  const gameFee = h('input', { inputmode: 'numeric', value: String(base.game_fee ?? '') });
  const memo = h('textarea', { rows: 2 }, base.memo || '');

  // 参加者：タップした順が入力表の列順になる
  const allParticipants = sessionId
    ? Object.values(t.participants).filter((p) => p.session_id === sessionId)
    : [];
  const selected = allParticipants.filter((p) => !p.deleted)
    .sort((a, b) => a.col_order - b.col_order).map((p) => p.member_id);
  // 成績が入っている人は外せない（外すと半荘の合計が合わなくなる）
  const played = new Set(Object.values(t.results)
    .filter((r) => !r.deleted && t.hanchans[r.hanchan_id] && !t.hanchans[r.hanchan_id].deleted
      && t.hanchans[r.hanchan_id].session_id === sessionId)
    .map((r) => r.member_id));

  const picker = h('div', { class: 'picker' });
  const renderPicker = () => {
    const members = store.list('members').sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    setChildren(picker, members.map((m) => {
      const index = selected.indexOf(m.id);
      return h('button', {
        type: 'button',
        class: index >= 0 ? 'chip on' : 'chip',
        onclick: () => {
          if (index >= 0) {
            if (played.has(m.id)) {
              alert(`${m.name} はこの対局の成績があるので外せません。先に半荘を直してください。`);
              return;
            }
            selected.splice(index, 1);
          } else {
            selected.push(m.id);
          }
          renderPicker();
        },
      }, index >= 0 ? h('span', { class: 'badge' }, index + 1) : null, m.name);
    }));
  };
  renderPicker();

  const newName = h('input', { type: 'text', placeholder: '新しいメンバー', autocomplete: 'off' });
  const addNew = () => {
    const name = newName.value.trim();
    if (!name) return;
    if (store.list('members').some((m) => m.name === name)) {
      alert(`「${name}」はもういます`);
      return;
    }
    selected.push(addMember(store, name));
    newName.value = '';
    renderPicker();
  };

  const save = () => {
    const values = { rate: readInt(rate.value), chip_rate: readInt(chipRate.value), game_fee: readInt(gameFee.value) };
    for (const [key, label] of [['rate', 'レート'], ['chip_rate', 'チップレート'], ['game_fee', 'ゲーム代']]) {
      if (values[key] == null || Number.isNaN(values[key]) || values[key] < 0) {
        alert(`${label}を 0 以上の整数で入れてください`);
        return;
      }
    }
    if (!date.value) {
      alert('対局日を入れてください');
      return;
    }
    if (selected.length < 4) {
      alert('参加者を 4 人以上選んでください');
      return;
    }
    const chosen = rules.read();
    if (chosen.error) {
      alert(chosen.error);
      return;
    }
    const id = existing?.id || newId('s');
    const session = {
      id,
      group_id: existing?.group_id || store.group.id,
      date: date.value,
      title: title.value.trim(),
      rule_name: chosen.preset.name || '',
      rule_snapshot: ruleSnapshot(chosen.preset, chosen.settings),
      ...values,
      memo: memo.value.trim(),
      ...(existing ? {} : { created_by: getConfig().myName, event_id: '' }),
    };
    const changes = sessionChanges({ session, memberIds: selected, existing: allParticipants });
    // ルールを変えたら、素点で入れた半荘の pt を新しいルールで計算し直す
    const recomputed = existing ? recomputeScoreResults(t, id, sessionRule(session)) : [];
    if (recomputed.length) changes.results = recomputed;
    store.write(changes);
    if (recomputed.length) alert('ルールが変わったので、素点で入れた半荘の pt を計算し直しました');
    ctx.replace(`#/session/${id}`);
  };

  const remove = () => {
    if (!confirm('この対局を削除しますか？')) return;
    store.write({ sessions: [{ id: existing.id, deleted: true }] });
    ctx.replace('#/sessions');
  };

  return {
    title: existing ? '対局情報' : '新しい対局',
    back: existing ? `#/session/${existing.id}` : '#/sessions',
    body: h('div', null,
      h('section', { class: 'card' },
        h('label', { class: 'field' }, h('span', null, '対局日'), date),
        h('label', { class: 'field' }, h('span', null, 'タイトル'), title),
        rules.el,
        h('div', { class: 'grid3' },
          h('label', { class: 'field' }, h('span', null, 'レート P/千点'), rate),
          h('label', { class: 'field' }, h('span', null, 'チップ P/枚'), chipRate),
          h('label', { class: 'field' }, h('span', null, 'ゲーム代 P'), gameFee)),
        h('label', { class: 'field' }, h('span', null, 'メモ'), memo)),
      h('section', { class: 'card' },
        h('h2', null, '参加者（タップした順に並ぶ）'),
        picker,
        h('div', { class: 'inline-form' }, newName, h('button', { type: 'button', class: 'secondary', onclick: addNew }, '追加'))),
      h('button', { type: 'button', class: 'block', onclick: save }, existing ? '保存' : '作成して入力へ'),
      existing ? h('button', { type: 'button', class: 'block danger', onclick: remove }, 'この対局を削除') : null,
    ),
  };
}
