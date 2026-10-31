// ルール画面（設定タブ）：プリセットの一覧・追加・編集（名前変更を含む）・複製・削除（仕様書 6.1）
// 対局には作成時のルールの中身を丸ごと保存しているので、ここで変えても過去の対局の成績は変わらない
import { h, newId, readInt } from '../util.js';
import { normalizeRule, describeRule } from '../calc.js';
import { STANDARD_PRESET, presetRow, sortPresets, copyName } from '../model.js';
import { ruleOptions } from './rule-settings.js';

// 共通か、どのグループ限定か
function scopeLabel(rule, group) {
  return rule.group_id ? `「${group?.name || rule.group_id}」だけ` : '全グループ共通';
}

export function rulesView(ctx) {
  const { store } = ctx;
  const rules = sortPresets(store.list('rules'));
  return {
    title: 'ルール',
    back: '#/settings',
    live: true,
    body: h('div', null,
      h('a', { class: 'button block', href: '#/rule/new' }, '＋ ルールを追加'),
      rules.length
        ? h('ul', { class: 'list' }, rules.map((r) => h('li', null, h('a', { class: 'list-item link', href: `#/rule/${r.id}` },
            h('div', { class: 'list-main' },
              h('div', { class: 'card-head' },
                h('strong', null, r.name),
                h('span', { class: 'tag' }, scopeLabel(r, store.group))),
              h('div', { class: 'list-sub' }, describeRule(normalizeRule(r))),
              r.note ? h('div', { class: 'list-sub' }, r.note) : null)))))
        : h('p', { class: 'empty' }, 'ルールがありません'),
      h('p', { class: 'muted small' }, 'ルールを変えても、過去の対局の成績は変わりません（対局ごとに作成時の設定を保存しているため）。')),
  };
}

// ルールの追加（ruleId が 'new'）と編集
export function ruleEditView(ctx, ruleId) {
  const { store } = ctx;
  const isNew = ruleId === 'new';
  const existing = isNew ? null : store.get('rules', ruleId);
  if (!isNew && (!existing || existing.deleted)) return ctx.notFound();
  if (!store.group) {
    return { title: 'ルール', back: '#/rules', body: h('p', { class: 'empty' }, 'まだ GAS と同期できていません。') };
  }
  const source = existing || { ...STANDARD_PRESET, name: '', note: '' };
  const rule = normalizeRule(source);

  const name = h('input', { type: 'text', value: source.name, placeholder: '例：Mリーグ', autocomplete: 'off' });
  const scope = h('select', null,
    h('option', { value: '', selected: !source.group_id }, '全グループ共通'),
    h('option', { value: store.group.id, selected: Boolean(source.group_id) }, `「${store.group.name}」だけ`));
  const start = h('input', { inputmode: 'numeric', value: String(rule.start) });
  const ret = h('input', { inputmode: 'numeric', value: String(rule.ret) });
  const note = h('textarea', { rows: 2 }, source.note || '');

  // 持ち点・返しを変えたら 1 行表示も変える
  const base = () => ({ start: readInt(start.value) || 0, ret: readInt(ret.value) || 0 });
  const options = ruleOptions({ initial: rule, base });
  start.addEventListener('input', () => options.update());
  ret.addEventListener('input', () => options.update());

  const others = () => store.list('rules').filter((r) => r.id !== existing?.id);

  const save = () => {
    const nameValue = name.value.trim();
    if (!nameValue) {
      alert('名前を入れてください');
      return;
    }
    if (others().some((r) => r.name === nameValue)) {
      alert(`「${nameValue}」はもうあります`);
      return;
    }
    const points = { start: readInt(start.value), ret: readInt(ret.value) };
    for (const [key, label] of [['start', '持ち点'], ['ret', '返し']]) {
      const v = points[key];
      if (v == null || Number.isNaN(v) || v <= 0 || v % 100 !== 0) {
        alert(`${label}は 100 点単位の正の数で入れてください`);
        return;
      }
    }
    const r = options.read();
    if (r.error) {
      alert(r.error);
      return;
    }
    store.write({
      rules: [presetRow({
        id: existing?.id || newId('r'),
        name: nameValue,
        groupId: scope.value,
        start: points.start,
        ret: points.ret,
        umaOka: r.settings.umaOka,
        uma: r.umaChoice,
        rounding: r.settings.rounding,
        tieBreak: r.settings.tieBreak,
        note: note.value.trim(),
      })],
    });
    ctx.replace('#/rules');
  };

  // 保存済みの中身を写して新しいルールを作り、その編集画面を開く
  const duplicate = () => {
    const id = newId('r');
    const { created_at, updated_at, ...copy } = existing;
    store.write({ rules: [{ ...copy, id, name: copyName(existing.name, store.list('rules').map((r) => r.name)) }] });
    ctx.replace(`#/rule/${id}`);
  };

  const remove = () => {
    if (!confirm(`「${existing.name}」を削除しますか？\n過去の対局の成績は変わりません。`)) return;
    store.write({ rules: [{ id: existing.id, deleted: true }] });
    ctx.replace('#/rules');
  };

  return {
    title: isNew ? 'ルールを追加' : 'ルールを編集',
    back: '#/rules',
    body: h('div', null,
      h('section', { class: 'card' },
        h('label', { class: 'field' }, h('span', null, '名前'), name),
        h('label', { class: 'field' }, h('span', null, '使えるグループ'), scope),
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, h('span', null, '持ち点'), start),
          h('label', { class: 'field' }, h('span', null, '返し'), ret)),
        options.el,
        h('p', { class: 'muted small' }, 'オカは（返し − 持ち点）× 4 をトップが受け取る。同点の着順は上家（起家に近い席）を上にする。「等分」では、同点の人たちでその順位のウマ・オカを等分する（Mリーグ方式。0.1pt の端数は起家に近い人へ）。'),
        h('label', { class: 'field' }, h('span', null, '説明'), note)),
      h('button', { type: 'button', class: 'block', onclick: save }, '保存'),
      existing ? h('div', { class: 'button-row' },
        h('button', { type: 'button', class: 'secondary', onclick: duplicate }, '複製'),
        h('button', { type: 'button', class: 'danger', onclick: remove }, '削除')) : null),
  };
}
