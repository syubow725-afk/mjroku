// 設定画面：自分の名前、GAS の URL、合言葉（端末にいくつでも持てる）、グループ（役割・規定半荘数）、管理への入口、同期の状況
import { h, setChildren } from '../util.js';
import * as api from '../api.js';
import { getConfig, setConfig, getKeys, setKeys, keyEntry, mergeKey, groupChoices } from '../config.js';

export function settingsView(ctx) {
  const { store } = ctx;
  const config = getConfig();

  const name = h('input', { type: 'text', value: config.myName, placeholder: '対局の「作成者」に入る名前', autocomplete: 'off' });
  const url = h('input', {
    type: 'url', inputmode: 'url', value: config.gasUrl, autocomplete: 'off',
    placeholder: 'https://script.google.com/macros/s/…/exec',
  });
  // 合言葉の欄は、新しく足すとき・付け替えるときだけ入れる（持っている合言葉は下の一覧に出る）
  const pass = h('input', { type: 'password', autocomplete: 'off' });
  const passLabel = h('span');
  const message = h('p', { class: 'result' });
  const show = (cls, text) => { message.className = `result ${cls}`; message.textContent = text; };

  // 合言葉を GAS で確かめてから一覧に足し、そのグループを開く。
  // 同じグループの古い合言葉（付け替える前のもの）は mergeKey が外す
  const addPasscode = async (passcode) => {
    let res;
    try {
      res = await api.load({ gasUrl: getConfig().gasUrl, passcode });
    } catch (err) {
      show('ng', `接続できません：${err.message}`);
      return;
    }
    setKeys(mergeKey(getKeys(), keyEntry(passcode, res)));
    pass.value = '';
    await ctx.switchGroup(res.group.id);
    update();
    show('ok', `「${res.group.name}」に接続しました${res.role === 'admin' ? '（管理者の合言葉）' : ''}`);
  };

  const saveButton = h('button', {
    type: 'button',
    onclick: async () => {
      const before = getConfig();
      const gasUrl = url.value.trim();
      const passcode = pass.value.trim();
      // 送信待ちは今の URL の GAS に送るもの。URL を変える前に送り切る
      if (gasUrl !== before.gasUrl && store.totalPending() > 0) {
        show('ng', `送信待ちが ${store.totalPending()} 件あります。今の URL のまま「今すぐ同期」で送ってから変えてください。`);
        return;
      }
      setConfig({ myName: name.value.trim(), gasUrl });
      if (!gasUrl || (!passcode && !before.passcode)) {
        show('', '名前を保存しました（URL と合言葉がないと同期しません）');
        return;
      }
      saveButton.disabled = true;
      show('', '接続中…');
      try {
        if (passcode) {
          await addPasscode(passcode);
          return;
        }
        await store.sync();
        if (store.error) show('ng', `接続できません：${store.error}`);
        else show('ok', `「${store.group.name}」に接続しました`);
      } finally {
        saveButton.disabled = false;
      }
    },
  }, '保存して接続');

  const keyList = h('div'); // 持っている合言葉の一覧
  const status = h('dl', { class: 'kv' });
  const actions = h('div', { class: 'button-row' });
  const roleArea = h('div', { class: 'stack' }); // 役割とグループで変わる部分（グループを切り替えたら書き直す）

  // 同期の状況と、合言葉・役割で変わる部分は、画面を作り直さずに最新にする（入力中の欄を消さないため）
  const update = () => {
    const keys = getKeys();
    passLabel.textContent = keys.length ? '合言葉を足す・付け替える' : '合言葉';
    pass.placeholder = keys.length ? '別のグループの合言葉など' : '';
    setChildren(keyList, keys.length ? keyCard(ctx, keys, show, update) : null);
    setChildren(roleArea, ...roleSections(store));
    const pending = store.pendingCount();
    setChildren(status,
      h('dt', null, 'グループ'), h('dd', null, store.group?.name || '—'),
      h('dt', null, '役割'), h('dd', null, store.group ? (store.isAdmin ? '管理者' : 'メンバー') : '—'),
      h('dt', null, '最終同期'), h('dd', null, store.lastSync ? new Date(store.lastSync).toLocaleString('ja-JP') : '—'),
      h('dt', null, '送信待ち'), h('dd', null, `${pending} 件`,
        store.otherPending > 0 ? `（ほかのグループに ${store.otherPending} 件）` : null),
      store.error ? [h('dt', null, 'エラー'), h('dd', { class: 'ng' }, store.error)] : null,
      store.notice ? [h('dt', null, 'お知らせ'), h('dd', null, store.notice)] : null,
    );
    setChildren(actions,
      h('button', { type: 'button', class: 'secondary', disabled: store.syncing, onclick: () => store.sync() },
        store.syncing ? '同期中…' : '今すぐ同期'),
      pending > 0
        ? h('button', {
            type: 'button', class: 'danger',
            onclick: () => {
              if (confirm(`「${store.group?.name || 'このグループ'}」の送信待ちの ${pending} 件を捨てますか？\nこの端末で入力して、まだ届いていない内容が消えます。`)) store.discardOutbox();
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
        h('label', { class: 'field' }, passLabel, pass),
        saveButton,
        message),
      keyList,
      roleArea,
      h('section', { class: 'card' }, h('h2', null, '同期'), status, actions),
      h('p', { class: 'version' }, `麻雀録 v${ctx.version}`),
      versionCheck(ctx),
    ),
  };
}

// この端末の合言葉の一覧。合言葉そのものは出さず、開けるグループで見分ける
function keyCard(ctx, keys, show, update) {
  const { store } = ctx;
  const active = getConfig().passcode;
  const remove = async (key) => {
    const rest = keys.filter((k) => k !== key);
    // この合言葉を外すと、この端末で開けなくなるグループ
    const left = new Set(groupChoices(rest).map((c) => c.groupId));
    const lost = key.groups.filter((g) => !left.has(g.id));
    const pending = lost.filter((g) => store.pendingFor(g.id) > 0);
    if (pending.length) {
      show('ng', `「${pending.map((g) => g.name).join('」「')}」に送信待ちがあります。送ってから外してください。`);
      return;
    }
    const what = lost.length ? `\n外すと「${lost.map((g) => g.name).join('」「')}」はこの端末で見られなくなります。` : '';
    if (!confirm(`${keyLabel(key)}をこの端末から外しますか？${what}`)) return;
    setKeys(rest);
    if (key.passcode === active) {
      // 使っていた合言葉なら、残りの最初のグループに切り替える。残りがなければ未接続にする
      const next = groupChoices(rest)[0];
      if (next) {
        await ctx.switchGroup(next.groupId);
      } else {
        setConfig({ passcode: '', groupId: '' });
        await store.switchTo();
      }
    }
    // 見られなくなったグループのデータは端末から消す
    store.forgetGroups(lost.map((g) => g.id));
    update();
    show('ok', `${keyLabel(key)}を外しました`);
  };
  return h('section', { class: 'card' },
    h('h2', null, 'この端末の合言葉'),
    h('ul', { class: 'list' }, keys.map((k) => h('li', { class: 'list-item' },
      h('div', { class: 'list-main' },
        h('div', { class: 'card-head' },
          h('strong', null, keyLabel(k)),
          k.passcode === active ? h('span', { class: 'tag' }, '使用中') : null),
        h('div', { class: 'list-sub' }, keySub(store, k))),
      h('button', { type: 'button', class: 'small secondary', onclick: () => remove(k) }, '外す')))),
    groupChoices(keys).length > 1
      ? h('p', { class: 'muted small' }, '開けるグループが 2 つ以上あるので、画面上の欄でグループを切り替えられます。')
      : null);
}

function keyLabel(k) {
  if (k.role === 'admin') return '管理者の合言葉';
  return k.groups[0] ? `「${k.groups[0].name}」の合言葉` : '合言葉（未接続）';
}

function keySub(store, k) {
  const notes = [];
  if (k.role === 'admin') notes.push(`全グループ（${k.groups.map((g) => g.name).join('・') || '—'}）`);
  else if (!k.groups.length) notes.push('次の同期でグループが分かります');
  for (const g of k.groups) {
    const n = store.pendingFor(g.id);
    if (n > 0 && g.id !== store.slotId) notes.push(`「${g.name}」の送信待ち ${n} 件`);
    if (store.otherErrors[g.id]) notes.push(`「${g.name}」を送れません：${store.otherErrors[g.id]}`);
  }
  return notes.join('・') || 'メンバー';
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
