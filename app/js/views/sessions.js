// 対局の一覧と、対局の作成・編集画面
import { h, newId, todayStr, formatDate, readInt } from '../util.js';
import { getConfig, isConfigured } from '../config.js';
import { buildSession, memberName, sessionChanges, ruleSnapshot } from '../model.js';
import { addMember } from './members.js';

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
  const sessions = store.list('sessions')
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));

  const items = sessions.map((s) => {
    const model = buildSession(t, s.id);
    const names = model.participants.map((p) => memberName(t, p.member_id)).join('・');
    return h('li', null, h('a', { class: 'list-item link', href: `#/session/${s.id}` },
      h('div', { class: 'list-main' },
        h('strong', null, formatDate(s.date)), s.title ? `　${s.title}` : '',
        h('div', { class: 'list-sub' }, `${names}　${model.hanchans.length} 半荘`))));
  });

  return {
    title: '対局',
    live: true,
    body: h('div', null,
      h('a', { class: 'button block', href: '#/sessions/new' }, '＋ 新しい対局'),
      items.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'empty' }, 'まだ対局がありません')),
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

  const rules = store.list('rules');
  const ruleSelect = h('select', null, rules.map((r) => h('option', { value: r.id, selected: r.name === base.rule_name }, r.name)));

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
    picker.replaceChildren(...members.map((m) => {
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
    const rule = rules.find((r) => r.id === ruleSelect.value);
    const id = existing?.id || newId('s');
    const session = {
      id,
      group_id: existing?.group_id || store.group.id,
      date: date.value,
      title: title.value.trim(),
      rule_name: rule?.name || '',
      rule_snapshot: ruleSnapshot(rule),
      ...values,
      memo: memo.value.trim(),
      ...(existing ? {} : { created_by: getConfig().myName, event_id: '' }),
    };
    store.write(sessionChanges({ session, memberIds: selected, existing: allParticipants }));
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
        h('label', { class: 'field' }, h('span', null, 'ルール'), ruleSelect),
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
