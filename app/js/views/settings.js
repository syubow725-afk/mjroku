// 設定画面：自分の名前、GAS の URL、合言葉、グループ（役割・規定半荘数）、管理への入口、同期の状況
import { h, setChildren } from '../util.js';
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
      // 送信待ちは今の合言葉のグループの入力なので、合言葉を入れ替える前に送り切る。
      // 残したまま別のグループの合言葉にすると、GAS が「グループ外」として拒み、送信待ちが詰まる
      const changing = pass.value.trim() !== getConfig().passcode || url.value.trim() !== getConfig().gasUrl;
      if (changing && store.pendingCount() > 0) {
        message.className = 'result ng';
        message.textContent = `送信待ちが ${store.pendingCount()} 件あります。今の合言葉のまま「今すぐ同期」で送ってから入れ替えてください。`;
        return;
      }
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
  const roleArea = h('div', { class: 'stack' }); // 役割とグループで変わる部分（合言葉を入れ替えたら書き直す）

  // 同期の状況と、役割で変わる部分は、画面を作り直さずに最新にする（入力中の欄を消さないため）
  const update = () => {
    setChildren(roleArea, ...roleSections(store));
    const pending = store.pendingCount();
    setChildren(status,
      h('dt', null, 'グループ'), h('dd', null, store.group?.name || '—'),
      h('dt', null, '役割'), h('dd', null, store.group ? (store.isAdmin ? '管理者' : 'メンバー') : '—'),
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
      roleArea,
      h('section', { class: 'card' }, h('h2', null, '同期'), status, actions),
      h('p', { class: 'version' }, `麻雀録 v${ctx.version}`),
      versionCheck(ctx),
    ),
  };
}

// ルール・グループの設定・管理への入口（役割とグループで変わる）
function roleSections(store) {
  return [
    h('a', { class: 'list-item link', href: '#/rules' },
      h('span', { class: 'list-main' }, 'ルール',
        h('div', { class: 'list-sub' }, store.isAdmin ? 'プリセットの追加・編集・複製・削除' : 'プリセットの一覧（追加・編集は管理者）')),
      h('span', { class: 'muted' }, '›')),
    store.group
      ? h('section', { class: 'card' },
          h('h2', null, 'グループの設定'),
          h('dl', { class: 'kv' },
            h('dt', null, '規定半荘数'), h('dd', null, `${store.minGames} 半荘以上（トップ率・連対率・ラス回避率のランキング）`)),
          h('p', { class: 'muted small' }, store.isAdmin ? '「管理」で変えられます。' : 'グループの全員に共通の設定です。変更は管理者が行います。'))
      : null,
    store.isAdmin
      ? h('a', { class: 'list-item link', href: '#/admin' },
          h('span', { class: 'list-main' }, '管理', h('div', { class: 'list-sub' }, 'グループの追加・名前・規定半荘数・合言葉')),
          h('span', { class: 'muted' }, '›'))
      : null,
  ];
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
