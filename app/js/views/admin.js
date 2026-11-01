// 管理（管理者だけ）：グループの一覧・追加、グループの名前・規定半荘数・切替日・合言葉の設定。
// どれも GAS に直接送る（送信待ちには入れない）。電波がないときはその場でエラーを出す。
// 権限の判定は GAS が行う（ここで画面を出さないのは、メンバーに使えないボタンを見せないため）
import { h } from '../util.js';
import * as api from '../api.js';
import { getConfig } from '../config.js';
import { DEFAULT_MIN_GAMES } from '../store.js';

function notAdmin() {
  return { title: '管理', back: '#/settings', body: h('p', { class: 'empty' }, '管理者の合言葉で接続したときだけ使えます。') };
}

const minGamesLabel = (g) => (g.min_games == null ? `${DEFAULT_MIN_GAMES}（初期値）` : String(g.min_games));

export function adminView(ctx) {
  const { store } = ctx;
  if (!store.isAdmin) return notAdmin();
  const groups = store.groups || [];
  const message = h('p', { class: 'result' });

  const add = async () => {
    const name = prompt('新しいグループの名前（例：金曜の卓）')?.trim();
    if (!name) return;
    message.className = 'result';
    message.textContent = '追加中…';
    try {
      const res = await api.saveGroup(getConfig(), { name });
      store.applyGroups(res);
      ctx.go(`#/admin/group/${res.group.id}`);
    } catch (err) {
      message.className = 'result ng';
      message.textContent = `追加できません：${err.message}`;
    }
  };

  return {
    title: '管理',
    back: '#/settings',
    live: true,
    body: h('div', null,
      h('section', { class: 'card' },
        h('h2', null, 'グループ'),
        h('ul', { class: 'list' }, groups.map((g) => h('li', null, h('a', { class: 'list-item link', href: `#/admin/group/${g.id}` },
          h('div', { class: 'list-main' },
            h('div', { class: 'card-head' },
              h('strong', null, g.name),
              g.id === store.group?.id ? h('span', { class: 'tag' }, '表示中') : null),
            h('div', { class: 'list-sub' },
              `合言葉：${g.has_passcode ? '設定済み' : '未設定'}・規定半荘数：${minGamesLabel(g)}`)),
          h('span', { class: 'muted' }, '›'))))),
        h('button', { type: 'button', class: 'block secondary', onclick: add }, '＋ グループを追加'),
        message),
      store.group
        ? h('section', { class: 'card' },
            h('h2', null, `本家からの移行（${store.group.name}）`),
            h('a', { class: 'list-item link', href: '#/admin/import' },
              h('span', { class: 'list-main' }, '過去対局の取り込み', h('div', { class: 'list-sub' }, '本家の対局をファイルから一括で入れる')),
              h('span', { class: 'muted' }, '›')),
            h('a', { class: 'list-item link', href: '#/admin/carry' },
              h('span', { class: 'list-main' }, '本家からの繰り越し', h('div', { class: 'list-sub' }, 'メンバーごとの本家通算と、残りの繰り越し')),
              h('span', { class: 'muted' }, '›')),
            h('p', { class: 'muted small' }, '表示中のグループに入れます。別のグループは、上の欄で切り替えてから。'))
        : null,
      h('p', { class: 'muted small' },
        'グループのデータは、そのグループの合言葉を持つ人と管理者にしか届きません。',
        '管理者の合言葉は、スプレッドシートのメニュー「麻雀録 → 管理者の合言葉を設定」でだけ変えられます。')),
  };
}

export function adminGroupView(ctx, groupId) {
  const { store } = ctx;
  if (!store.isAdmin) return notAdmin();
  const group = (store.groups || []).find((g) => g.id === groupId);
  if (!group) return ctx.notFound();

  const name = h('input', { type: 'text', value: group.name, autocomplete: 'off' });
  const minGames = h('input', {
    inputmode: 'numeric', class: 'narrow', autocomplete: 'off',
    value: group.min_games == null ? '' : String(group.min_games), placeholder: String(DEFAULT_MIN_GAMES),
  });
  const cutover = h('input', { type: 'date', value: group.cutover_date || '' });
  const settingsMessage = h('p', { class: 'result' });
  const pass1 = h('input', { type: 'password', autocomplete: 'new-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const passMessage = h('p', { class: 'result' });

  const show = (el, cls, text) => { el.className = `result ${cls}`; el.textContent = text; };
  const passHint = h('p', { class: 'muted small' });
  const setPassHint = (hasPasscode) => {
    passHint.textContent = hasPasscode ? '設定済み。新しく入れると付け替えます。' : 'まだありません。設定すると、このグループの人が使えるようになります。';
  };
  setPassHint(group.has_passcode);

  const saveSettings = async (button) => {
    const value = minGames.value.trim();
    if (value !== '' && !/^\d+$/.test(value)) {
      show(settingsMessage, 'ng', '規定半荘数は 0 以上の整数で入れてください（空なら初期値の 10）');
      return;
    }
    if (!name.value.trim()) {
      show(settingsMessage, 'ng', '名前を入れてください');
      return;
    }
    button.disabled = true;
    show(settingsMessage, '', '保存中…');
    try {
      const res = await api.saveGroup(getConfig(), {
        id: group.id, name: name.value.trim(), min_games: value === '' ? null : Number(value), cutover_date: cutover.value,
      });
      store.applyGroups(res);
      show(settingsMessage, 'ok', '保存しました');
    } catch (err) {
      show(settingsMessage, 'ng', `保存できません：${err.message}`);
    } finally {
      button.disabled = false;
    }
  };

  const savePasscode = async (button) => {
    const p = pass1.value.trim();
    if (p.length < 4) {
      show(passMessage, 'ng', '合言葉は 4 文字以上にしてください');
      return;
    }
    if (p !== pass2.value.trim()) {
      show(passMessage, 'ng', '2 回の入力が一致しません');
      return;
    }
    const warn = group.has_passcode ? '\n前の合言葉はもう使えなくなります。このグループの全員に新しい合言葉を伝えてください。' : '';
    if (!confirm(`「${group.name}」の合言葉を設定しますか？${warn}`)) return;
    button.disabled = true;
    show(passMessage, '', '設定中…');
    try {
      const res = await api.setGroupPasscode(getConfig(), group.id, p);
      store.applyGroups(res);
      group.has_passcode = true;
      setPassHint(true);
      pass1.value = '';
      pass2.value = '';
      show(passMessage, 'ok', '合言葉を設定しました');
    } catch (err) {
      show(passMessage, 'ng', `設定できません：${err.message}`);
    } finally {
      button.disabled = false;
    }
  };

  return {
    title: group.name,
    back: '#/admin',
    body: h('div', null,
      h('section', { class: 'card' },
        h('h2', null, '名前と設定'),
        h('label', { class: 'field' }, h('span', null, '名前'), name),
        h('label', { class: 'field' }, h('span', null, '率の規定半荘数（トップ率・連対率・ラス回避率）'),
          h('div', { class: 'inline' }, minGames, h('span', null, '半荘以上'))),
        h('p', { class: 'muted small' }, `空なら初期値の ${DEFAULT_MIN_GAMES}。このグループの全員に共通です。`),
        h('label', { class: 'field' }, h('span', null, '本家からの切替日'), cutover),
        h('p', { class: 'muted small' }, 'この日から本アプリで記録する日。空なら本家からの繰り越しを使いません。この日より前の対局を入れると、その分を繰り越しから減らします。'),
        h('button', { type: 'button', onclick: (e) => saveSettings(e.currentTarget) }, '保存'),
        settingsMessage),
      h('section', { class: 'card' },
        h('h2', null, '本家からの繰り越し'),
        group.id === store.group?.id
          ? h('a', { class: 'list-item link', href: '#/admin/carry' },
              h('span', { class: 'list-main' }, 'メンバーごとの本家通算', h('div', { class: 'list-sub' }, '入力と、切替日より前の対局を入れた後の残り')),
              h('span', { class: 'muted' }, '›'))
          : h('p', { class: 'muted small' }, '上の欄でこのグループに切り替えると入れられます。')),
      h('section', { class: 'card' },
        h('h2', null, '合言葉'),
        passHint,
        h('label', { class: 'field' }, h('span', null, '新しい合言葉（4 文字以上）'), pass1),
        h('label', { class: 'field' }, h('span', null, 'もう一度'), pass2),
        h('button', { type: 'button', onclick: (e) => savePasscode(e.currentTarget) }, '合言葉を設定'),
        passMessage,
        h('p', { class: 'muted small' }, '合言葉は GAS でハッシュにして保存し、元の文字はどこにも残しません。忘れたら付け替えてください。'))),
  };
}
