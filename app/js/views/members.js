// メンバー画面：一覧・追加・名前の変更・削除
import { h, newId } from '../util.js';

export function membersView(ctx) {
  const { store } = ctx;
  const members = store.list('members').sort((a, b) => a.name.localeCompare(b.name, 'ja'));

  if (!store.group) {
    return {
      title: 'メンバー',
      body: h('p', { class: 'empty' }, 'まだ GAS と同期できていません。', h('a', { href: '#/settings' }, '設定'), 'を確認してください。'),
    };
  }

  const input = h('input', { type: 'text', placeholder: '名前', autocomplete: 'off' });
  const add = () => {
    const name = input.value.trim();
    if (!name) return;
    if (members.some((m) => m.name === name)) {
      alert(`「${name}」はもういます`);
      return;
    }
    addMember(store, name);
    ctx.refresh();
  };

  const rename = (m) => {
    const name = prompt('新しい名前', m.name)?.trim();
    if (!name || name === m.name) return;
    store.write({ members: [{ id: m.id, name }] });
    ctx.refresh();
  };

  // 論理削除。過去の対局には名前が残る
  const remove = (m) => {
    if (!confirm(`「${m.name}」を削除しますか？\n過去の対局の記録は残ります。`)) return;
    store.write({ members: [{ id: m.id, deleted: true }] });
    ctx.refresh();
  };

  return {
    title: 'メンバー',
    body: h('div', null,
      h('section', { class: 'card' },
        h('div', { class: 'inline-form' }, input, h('button', { type: 'button', onclick: add }, '追加'))),
      members.length
        ? h('ul', { class: 'list' }, members.map((m) => h('li', { class: 'list-item' },
            h('span', { class: 'list-main' }, m.name),
            h('button', { type: 'button', class: 'small secondary', onclick: () => rename(m) }, '名前'),
            h('button', { type: 'button', class: 'small danger', onclick: () => remove(m) }, '削除'))))
        : h('p', { class: 'empty' }, 'まだメンバーがいません'),
    ),
  };
}

// メンバーを作り、今のグループに所属させる。新しいメンバーの id を返す
export function addMember(store, name) {
  const id = newId('m');
  const groupId = store.group.id;
  store.write({
    members: [{ id, name, aliases: '' }],
    group_members: [{ id: `${groupId}:${id}`, group_id: groupId, member_id: id }],
  });
  return id;
}
