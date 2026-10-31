// 設定画面：自分の名前、GAS の URL、合言葉、ランキングの規定半荘数、同期の状況
import { h, setChildren, readInt } from '../util.js';
import { getConfig, setConfig, getMinGames } from '../config.js';

export function settingsView(ctx) {
  const { store } = ctx;
  const config = getConfig();

  const name = h('input', { type: 'text', value: config.myName, placeholder: '対局の「作成者」に入る名前', autocomplete: 'off' });
  const url = h('input', {
    type: 'url', inputmode: 'url', value: config.gasUrl, autocomplete: 'off',
    placeholder: 'https://script.google.com/macros/s/…/exec',
  });
  const pass = h('input', { type: 'password', value: config.passcode, autocomplete: 'off' });
  const message = h('p', { class: 'result' });

  const saveButton = h('button', {
    type: 'button',
    onclick: async () => {
      setConfig({ myName: name.value.trim(), gasUrl: url.value.trim(), passcode: pass.value.trim() });
      if (!url.value.trim() || !pass.value.trim()) {
        message.className = 'result';
        message.textContent = '名前を保存しました（URL と合言葉がないと同期しません）';
        return;
      }
      saveButton.disabled = true;
      message.className = 'result';
      message.textContent = '接続中…';
      await store.sync();
      saveButton.disabled = false;
      if (store.error) {
        message.className = 'result ng';
        message.textContent = `接続できません：${store.error}`;
      } else {
        message.className = 'result ok';
        message.textContent = `「${store.group.name}」に接続しました`;
      }
    },
  }, '保存して接続');

  // 率のランキングの規定半荘数。この端末だけの設定で、入れたらすぐ保存する
  const minMessage = h('p', { class: 'result' });
  const minGames = h('input', {
    inputmode: 'numeric', value: String(getMinGames(config)), class: 'narrow',
    onchange: (e) => {
      const n = readInt(e.target.value);
      if (n == null || Number.isNaN(n) || n < 0) {
        minMessage.className = 'result ng';
        minMessage.textContent = '0 以上の整数で入れてください';
        return;
      }
      setConfig({ minGames: String(n) });
      minMessage.className = 'result ok';
      minMessage.textContent = `${n} 半荘以上の人に順位を付けます`;
    },
  });

  const status = h('dl', { class: 'kv' });
  const actions = h('div', { class: 'button-row' });

  // 同期の状況だけは、画面を作り直さずに最新にする（入力中の欄を消さないため）
  const update = () => {
    const pending = store.pendingCount();
    setChildren(status,
      h('dt', null, 'グループ'), h('dd', null, store.group?.name || '—'),
      h('dt', null, '最終同期'), h('dd', null, store.lastSync ? new Date(store.lastSync).toLocaleString('ja-JP') : '—'),
      h('dt', null, '送信待ち'), h('dd', null, `${pending} 件`),
      store.error ? [h('dt', null, 'エラー'), h('dd', { class: 'ng' }, store.error)] : null,
    );
    setChildren(actions,
      h('button', { type: 'button', class: 'secondary', disabled: store.syncing, onclick: () => store.sync() },
        store.syncing ? '同期中…' : '今すぐ同期'),
      pending > 0
        ? h('button', {
            type: 'button', class: 'danger',
            onclick: () => {
              if (confirm(`送信待ちの ${pending} 件を捨てますか？\nこの端末で入力して、まだ届いていない内容が消えます。`)) store.discardOutbox();
            },
          }, '送信待ちを捨てる')
        : null,
    );
  };
  update();

  return {
    title: '設定',
    update,
    body: h('div', null,
      h('section', { class: 'card' },
        h('label', { class: 'field' }, h('span', null, '自分の名前'), name),
        h('label', { class: 'field' }, h('span', null, 'GAS ウェブアプリ URL'), url),
        h('label', { class: 'field' }, h('span', null, '合言葉'), pass),
        saveButton,
        message),
      h('a', { class: 'list-item link', href: '#/rules' },
        h('span', { class: 'list-main' }, 'ルール', h('div', { class: 'list-sub' }, 'プリセットの追加・編集・複製・削除')),
        h('span', { class: 'muted' }, '›')),
      h('section', { class: 'card' },
        h('h2', null, 'ランキング'),
        h('label', { class: 'field' }, h('span', null, '率の規定半荘数（トップ率・連対率・ラス回避率）'),
          h('div', { class: 'inline' }, minGames, h('span', null, '半荘以上'))),
        h('p', { class: 'muted small' }, '届かない人は「規定未満」として下にまとめて出します。この端末だけの設定です。'),
        minMessage),
      h('section', { class: 'card' }, h('h2', null, '同期'), status, actions),
      h('p', { class: 'version' }, `麻雀録 v${ctx.version}`),
      versionCheck(ctx),
    ),
  };
}

// 「最新の版を確認」。新しい版があれば画面下に「更新」の帯が出る
function versionCheck(ctx) {
  const result = h('p', { class: 'version' });
  const button = h('button', {
    type: 'button', class: 'small secondary',
    onclick: async () => {
      button.disabled = true;
      result.textContent = '確認中…';
      const { current, latest } = await ctx.checkUpdate();
      button.disabled = false;
      if (!latest) result.textContent = '確認できませんでした（通信を確かめてください）';
      else if (latest === current) result.textContent = `最新です（v${current}）`;
      else result.textContent = `新しい版 v${latest} があります。画面下の「更新」を押してください`;
    },
  }, '最新の版を確認');
  return h('div', { class: 'version-check' }, button, result);
}
