// 設定画面：自分の名前、GAS の URL、合言葉、同期の状況
import { h } from '../util.js';
import { getConfig, setConfig } from '../config.js';

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

  const status = h('dl', { class: 'kv' });
  const actions = h('div', { class: 'button-row' });

  // 同期の状況だけは、画面を作り直さずに最新にする（入力中の欄を消さないため）
  const update = () => {
    const pending = store.pendingCount();
    status.replaceChildren(
      h('dt', null, 'グループ'), h('dd', null, store.group?.name || '—'),
      h('dt', null, '最終同期'), h('dd', null, store.lastSync ? new Date(store.lastSync).toLocaleString('ja-JP') : '—'),
      h('dt', null, '送信待ち'), h('dd', null, `${pending} 件`),
      store.error ? [h('dt', null, 'エラー'), h('dd', { class: 'ng' }, store.error)] : null,
    );
    actions.replaceChildren(
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
      h('section', { class: 'card' }, h('h2', null, '同期'), status, actions),
      h('p', { class: 'version' }, `麻雀録 v${ctx.version}`),
    ),
  };
}
