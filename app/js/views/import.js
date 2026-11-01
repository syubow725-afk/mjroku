// 本家の過去対局の一括取り込み（管理者だけ）。ファイルの中身は importer.js が確かめ、ここは画面だけを受け持つ。
// 取り込むのは表示中のグループの分だけ（グループごとの送信待ちに入れるため）。別のグループの分は、切り替えてから取り込む。
// ファイルは端末の中で読むだけで、どこにも送らない（送るのは取り込んだ対局の行だけ）
import { h, newId, setChildren, formatDate } from '../util.js';
import { readImportFile, planImport, importChanges, verifyImported } from '../importer.js';

const STATUS = {
  import: ['取り込む', ''],
  imported: ['取り込み済み', 'muted'],
  duplicate: ['同じ日・同じ顔ぶれの対局が既にある', 'ng'],
  after: ['切替日以降（取り込まない）', 'muted'],
  error: ['本家の値と合わない', 'ng'],
};

export function importView(ctx) {
  const { store } = ctx;
  if (!store.isAdmin) {
    return { title: '過去対局の取り込み', back: '#/settings', body: h('p', { class: 'empty' }, '管理者の合言葉で接続したときだけ使えます。') };
  }
  if (!store.group) {
    return { title: '過去対局の取り込み', back: '#/admin', body: h('p', { class: 'empty' }, 'まだ GAS と同期できていません。') };
  }

  let data = null;
  let plan = null;
  const area = h('div');
  const fileMessage = h('p', { class: 'result' });
  const file = h('input', {
    type: 'file', accept: '.json,application/json',
    onchange: async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        data = readImportFile(await f.text());
        fileMessage.className = 'result';
        fileMessage.textContent = `${f.name} を読みました`;
      } catch (err) {
        data = null;
        fileMessage.className = 'result ng';
        fileMessage.textContent = `読めません：${err.message}`;
      }
      update();
    },
  });

  const run = () => {
    const targets = plan.items.filter((i) => i.status === 'import');
    const people = plan.newMembers.length ? `\n新しく登録するメンバー：${plan.newMembers.join('、')}` : '';
    if (!confirm(`「${store.group.name}」に ${targets.length} 件の対局を取り込みますか？${people}`)) return;
    store.write(importChanges(plan, { rule: store.get('rules', 'r_standard') || undefined }));
  };

  // 取り込み前は計画、取り込み後は検算の結果を出す。同期が進むたびに作り直す
  const update = () => {
    if (!data || !store.group) {
      setChildren(area);
      return;
    }
    plan = planImport(data, {
      tables: store.tables(), group: store.group, otherMembers: store.otherGroupMembers(), newId: () => newId('m'),
    });
    setChildren(area, planCard(plan, run), verifyCard(plan, verifyImported(plan, store.tables()), store));
  };

  return {
    title: '過去対局の取り込み',
    back: '#/admin',
    update,
    body: h('div', null,
      h('section', { class: 'card' },
        h('dl', { class: 'kv' }, h('dt', null, '取り込み先'), h('dd', null, store.group.name)),
        h('label', { class: 'field' }, h('span', null, '取り込みファイル（JSON）'), file),
        fileMessage,
        h('p', { class: 'muted small' },
          'ファイルは端末の中で読むだけです。取り込む前に、各半荘の合計 0 と、計・収支が本家と同じかを確かめます。',
          '同じ対局は 2 回取り込みません。')),
      area),
  };
}

function planCard(plan, run) {
  const count = (status) => plan.items.filter((i) => i.status === status).length;
  const n = count('import');
  if (!plan.items.length) {
    return h('section', { class: 'card' }, h('p', { class: 'empty' }, `このファイルに「${plan.group.name}」の対局はありません。`),
      plan.otherGroups.length ? h('p', { class: 'muted small' }, `ファイルにあるグループ：${plan.otherGroups.join('、')}`) : null);
  }
  return h('section', { class: 'card' },
    h('h2', null, `「${plan.group.name}」の対局 ${plan.items.length} 件`),
    h('ul', { class: 'list' }, plan.items.map((i) => {
      const s = i.source;
      const [label, cls] = STATUS[i.status];
      return h('li', { class: 'list-item' }, h('div', { class: 'list-main' },
        h('div', { class: 'card-head' },
          h('strong', null, formatDate(s.date)),
          h('span', { class: `tag ${cls}` }, label)),
        h('div', { class: 'list-sub' }, `${s.players.length} 人・${s.hanchans.length} 半荘・${s.players.join('、')}`),
        i.errors.length ? h('div', { class: 'list-sub ng' }, i.errors.join('／')) : null));
    })),
    plan.newMembers.length ? h('p', null, `新しく登録するメンバー：${plan.newMembers.join('、')}`) : null,
    plan.joinMembers.length ? h('p', null, `ほかのグループから加えるメンバー：${plan.joinMembers.join('、')}`) : null,
    plan.otherGroups.length
      ? h('p', { class: 'muted small' }, `「${plan.otherGroups.join('」「')}」の分は、上の欄でそのグループに切り替えてから取り込みます。`)
      : null,
    plan.pending ? h('p', { class: 'muted small' }, `保留の ${plan.pending} 件（3 麻など）は取り込みません。`) : null,
    n ? h('button', { type: 'button', class: 'block', onclick: run }, `${n} 件を取り込む`) : null);
}

// 取り込んだ対局を、本アプリに入った行から計算し直して本家の計・収支と比べる
function verifyCard(plan, results, store) {
  if (!results.length) return null;
  const ok = results.filter((r) => r.ok).length;
  const pending = store.pendingCount();
  return h('section', { class: 'card' },
    h('h2', null, '検算（取り込んだ対局の計・収支 と 本家）'),
    h('p', { class: ok === results.length ? 'result ok' : 'result ng' },
      ok === results.length ? `${results.length} 件すべて本家と一致しました` : `${results.length - ok} 件が本家と合いません`),
    h('ul', { class: 'list' }, results.filter((r) => !r.ok).map((r) => h('li', { class: 'list-item' }, h('div', { class: 'list-main' },
      h('strong', null, formatDate(r.item.source.date)),
      h('div', { class: 'list-sub ng' }, r.diffs.join('／')))))),
    h('p', { class: 'muted small' }, pending
      ? `送信待ち ${pending} 件。上の帯が「同期済」になれば取り込み完了です。`
      : 'スプレッドシートに保存済みです。'));
}
