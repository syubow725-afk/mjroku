// 対局 1 日分の画面：入力表（半荘ごとの pt と精算）、半荘の入力、チップ・ゲーム代の入力、画像で共有
import { h, newId, formatDate, formatMoney, signClass, readInt, toggleSign } from '../util.js';
import { parsePt, formatPt, fillMissing, sum, allocateFees, describeRule } from '../calc.js';
import { buildSession, memberName, toPt10, hanchanChanges, sessionRule, scoreEntries } from '../model.js';
import { shareTable, drawTable } from '../share.js';

// ---------------------------------------------------------------------------
// 入力表
// ---------------------------------------------------------------------------

export function sessionView(ctx, sessionId) {
  const { store } = ctx;
  const t = store.tables();
  const model = buildSession(t, sessionId);
  if (!model) return ctx.notFound();
  const { session, participants, hanchans, summary } = model;

  const names = participants.map((p) => memberName(t, p.member_id));
  const cell = (text, cls) => h('td', { class: cls }, text);

  // 行＝半荘、列＝参加者。抜け番は「—」。合計が 0 でない半荘は印を付ける
  const rows = hanchans.map((hc, i) => {
    const pts = Object.values(hc.results).map((r) => toPt10(r.pt));
    const ok = sum(pts) === 0;
    return h('tr', { class: ok ? 'tap' : 'tap warn', onclick: () => ctx.go(`#/session/${sessionId}/hanchan/${hc.hanchan.id}`) },
      h('th', null, ok ? i + 1 : `${i + 1}!`),
      participants.map((p) => {
        const r = hc.results[p.member_id];
        if (!r) return cell('—', 'muted');
        const pt10 = toPt10(r.pt);
        return cell(formatPt(pt10), `${signClass(pt10)}${r.rank === 1 ? ' top' : ''}`);
      }));
  });

  const footRow = (label, values, format, cls = '') => h('tr', { class: cls },
    h('th', null, label),
    values.map((v) => cell(format(v), signClass(v))));

  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'score' },
    h('thead', null, h('tr', null, h('th', null, ''), names.map((n) => h('th', null, n)))),
    h('tbody', null, rows.length ? rows : h('tr', null, h('td', { class: 'muted', colspan: names.length + 1 }, '半荘はまだありません'))),
    h('tfoot', null,
      footRow('計', summary.map((s) => s.pt10), formatPt, 'total'),
      h('tr', null, h('th', null, '着順'), summary.map((s) => cell(s.rankCounts.join('-'), 'muted small'))),
      footRow('チップ', summary.map((s) => s.chips), (v) => (v > 0 ? `+${v}` : String(v))),
      footRow('小計', summary.map((s) => s.subtotal), formatMoney),
      h('tr', null, h('th', null, 'ゲーム代'), summary.map((s) => cell(`-${s.fee.toLocaleString('ja-JP')}`, 'muted'))),
      footRow('収支', summary.map((s) => s.balance), formatMoney, 'balance'))));

  return {
    title: formatDate(session.date),
    back: '#/sessions',
    live: true,
    body: h('div', null,
      h('div', { class: 'session-head' },
        session.title ? h('strong', null, session.title) : null,
        h('div', { class: 'head-row' },
          h('span', { class: 'muted small' },
            `${session.rule_name || 'ルール'}：${describeRule(sessionRule(session))}`, h('br'),
            `レート ${session.rate}・チップ ${session.chip_rate}・ゲーム代 ${Number(session.game_fee).toLocaleString('ja-JP')}P`),
          h('a', { class: 'small', href: `#/session/${sessionId}/edit` }, '対局情報')),
        session.memo ? h('div', { class: 'small' }, session.memo) : null),
      table,
      h('div', { class: 'button-row' },
        h('a', { class: 'button', href: `#/session/${sessionId}/hanchan/new` }, '＋ 半荘'),
        h('a', { class: 'button secondary', href: `#/session/${sessionId}/chips` }, 'チップ・ゲーム代')),
      hanchans.length
        ? h('a', { class: 'button secondary block', href: `#/session/${sessionId}/share` }, '画像で共有')
        : null,
      h('p', { class: 'muted small' }, '半荘の行をタップすると直せます。'),
    ),
  };
}

// ---------------------------------------------------------------------------
// 半荘の入力（pt 直接入力／素点入力。仕様書 5.3）
// ---------------------------------------------------------------------------

const SEAT_NAMES = ['東', '南', '西', '北']; // 0＝起家

export function hanchanView(ctx, sessionId, hanchanKey) {
  const { store } = ctx;
  const t = store.tables();
  const model = buildSession(t, sessionId);
  if (!model) return ctx.notFound();
  const isNew = hanchanKey === 'new';
  const index = isNew ? model.hanchans.length : model.hanchans.findIndex((hc) => hc.hanchan.id === hanchanKey);
  if (index < 0) return ctx.notFound();
  const target = isNew ? null : model.hanchans[index];
  const { participants } = model;
  const rule = sessionRule(model.session);
  const scoreTotalH = (rule.start * 4) / 100; // 4 人の素点の合計（100 点単位）。25,000 持ちなら 1,000

  // 入力方式：編集ならその半荘の方式、新規なら前の半荘と同じ方式
  let mode = target?.hanchan.input_mode || model.hanchans.at(-1)?.hanchan.input_mode || 'pt';

  // 対局する 4 人の初期値：編集なら入力済みの人、5 人以上の新規なら前の半荘と同じ顔ぶれ
  let playing;
  if (target) playing = new Set(Object.keys(target.results));
  else if (participants.length <= 4) playing = new Set(participants.map((p) => p.member_id));
  else {
    const prev = model.hanchans.at(-1);
    playing = new Set(prev ? Object.keys(prev.results) : participants.slice(0, 4).map((p) => p.member_id));
  }

  // 席（素点入力で使う）：編集なら入力済みの席、なければ列順に東南西北
  const seats = new Map();
  if (target) for (const r of Object.values(target.results)) if (r.seat != null) seats.set(r.member_id, r.seat);
  // 対局する人それぞれに重ならない席を割り当てる（抜け番を入れ替えたときもここで直す）
  function assignSeats() {
    for (const id of [...seats.keys()]) if (!playing.has(id)) seats.delete(id);
    const used = new Set(seats.values());
    for (const r of rows) {
      if (!playing.has(r.memberId) || seats.has(r.memberId)) continue;
      const free = [0, 1, 2, 3].find((s) => !used.has(s));
      if (free == null) continue;
      seats.set(r.memberId, free);
      used.add(free);
    }
  }

  const rows = participants.map((p) => {
    const r = target?.results[p.member_id];
    const isScore = target?.hanchan.input_mode === 'score';
    return {
      memberId: p.member_id,
      name: memberName(t, p.member_id),
      pt: h('input', {
        inputmode: 'decimal', autocomplete: 'off',
        value: r && !isScore ? formatPt(toPt10(r.pt)) : '', oninput: update,
      }),
      score: h('input', {
        inputmode: 'numeric', autocomplete: 'off',
        value: r && isScore && r.raw_score != null ? String(r.raw_score / 100) : '', oninput: update,
      }),
      seat: h('button', { type: 'button', class: 'small secondary seat' }),
      preview: h('span', { class: 'preview' }),
      row: null,
      toggle: null,
    };
  });
  assignSeats();

  const totalLine = h('p', { class: 'total-line' });
  const help = h('p', { class: 'muted small' });
  const modeButtons = {
    pt: h('button', { type: 'button', onclick: () => { mode = 'pt'; update(); } }, 'pt 入力'),
    score: h('button', { type: 'button', onclick: () => { mode = 'score'; update(); } }, '素点入力'),
  };

  const input = (r) => (mode === 'pt' ? r.pt : r.score);
  // 入力欄の値を読む。空は null、読めなければ NaN。pt は pt10、素点は 100 点単位
  const readValue = (r) => {
    const v = input(r).value.trim();
    if (v === '') return null;
    if (mode === 'pt') return parsePt(v) ?? NaN;
    return readInt(v);
  };

  // 対局する 4 人の値を、空が 1 つなら合計（pt は 0、素点は持ち点 × 4）に合わせて埋める
  function readActive() {
    const active = rows.filter((r) => playing.has(r.memberId));
    const values = active.map(readValue);
    const filled = values.some(Number.isNaN) ? null : fillMissing(values, mode === 'pt' ? 0 : scoreTotalH);
    return { active, values, filled };
  }

  // 素点入力の 4 人分から pt と着順を計算する（席順で計算し、列順で返す）
  const computeScore = (active, filledH) => scoreEntries(
    active.map((r, i) => ({ memberId: r.memberId, seat: seats.get(r.memberId), score: filledH[i] * 100 })), rule);

  // 入力のたびに：方式の表示切り替え、読めない欄に印、空が 1 つなら自動の値を薄く表示、合計と pt の見込みを表示
  function update() {
    for (const [m, b] of Object.entries(modeButtons)) b.classList.toggle('on', m === mode);
    help.textContent = mode === 'pt'
      ? '最終 pt を入れる（例：+20、-32）。マイナスは ± で切り替え。'
      : `素点を 100 点単位で入れる（45,000 点なら 450）。席は起家から東南西北、同点は上家が上。${describeRule(rule)}`;
    assignSeats();

    for (const r of rows) {
      const isActive = playing.has(r.memberId);
      r.pt.hidden = mode !== 'pt';
      r.score.hidden = mode !== 'score';
      r.unit.hidden = mode !== 'score';
      r.seat.hidden = mode !== 'score' || !isActive;
      r.seat.textContent = SEAT_NAMES[seats.get(r.memberId)] ?? '—';
      input(r).disabled = !isActive;
      r.row.classList.toggle('off', !isActive);
      if (r.toggle) r.toggle.textContent = isActive ? '対局' : '抜け';
      input(r).classList.toggle('invalid', isActive && Number.isNaN(readValue(r)));
      input(r).placeholder = '';
      r.preview.textContent = '';
    }

    const { active, values, filled } = readActive();
    const fail = (text, cls = 'ng') => {
      totalLine.textContent = text;
      totalLine.className = `total-line ${cls}`;
    };
    if (values.some(Number.isNaN)) return fail(mode === 'pt' ? '読めない値があります（例：+20、-32、-26.6）' : '素点は 100 点単位の整数で入れてください');
    if (active.length !== 4) return fail(`対局する人を 4 人にしてください（今 ${active.length} 人）`);
    if (!filled) return fail('3 人分入れると残り 1 人は自動で入ります', 'muted');
    const blank = values.indexOf(null);
    if (blank >= 0) {
      input(active[blank]).placeholder = mode === 'pt' ? `自動 ${formatPt(filled[blank])}` : `自動 ${filled[blank]}`;
    }

    if (mode === 'pt') {
      const total = sum(filled);
      return fail(total === 0 ? '合計 0（OK）' : `合計 ${formatPt(total)}（0 になりません）`, total === 0 ? 'ok' : 'ng');
    }
    const total = sum(filled) * 100;
    const expected = scoreTotalH * 100;
    const yen = (v) => v.toLocaleString('ja-JP');
    computeScore(active, filled).forEach((e, i) => {
      active[i].preview.textContent = `${formatPt(e.pt10)}（${e.rank}着）`;
      active[i].preview.className = `preview ${signClass(e.pt10)}`;
    });
    return fail(total === expected ? `合計 ${yen(total)}（OK）` : `合計 ${yen(total)}（${yen(expected)} になりません）`,
      total === expected ? 'ok' : 'ng');
  }

  const list = h('div', { class: 'entry-list' }, rows.map((r) => {
    r.toggle = participants.length > 4
      ? h('button', {
          type: 'button', class: 'small secondary',
          onclick: () => {
            if (playing.has(r.memberId)) playing.delete(r.memberId);
            else playing.add(r.memberId);
            update();
          },
        })
      : null;
    // 席ボタン：押すたびに東→南→西→北。その席にいた人とは席を入れ替える
    r.seat.addEventListener('click', () => {
      const from = seats.get(r.memberId);
      const to = (from + 1) % 4;
      const other = [...seats.entries()].find(([, s]) => s === to)?.[0];
      if (other) seats.set(other, from);
      seats.set(r.memberId, to);
      update();
    });
    r.unit = h('span', { class: 'unit' }, '00');
    r.row = h('div', { class: 'entry-wrap' },
      h('div', { class: 'entry' },
        h('span', { class: 'entry-name' }, r.name),
        r.toggle,
        r.seat,
        h('button', { type: 'button', class: 'small secondary sign', onclick: () => toggleSign(input(r)) }, '±'),
        r.pt,
        r.score,
        r.unit),
      r.preview);
    return r.row;
  }));

  const save = () => {
    const { active, values, filled } = readActive();
    if (active.length !== 4) {
      alert('対局する人を 4 人にしてください');
      return;
    }
    if (values.some(Number.isNaN)) {
      alert('読めない値があります');
      return;
    }
    if (!filled) {
      alert('少なくとも 3 人分を入れてください');
      return;
    }

    let entries;
    if (mode === 'pt') {
      const total = sum(filled);
      if (total !== 0 && !confirm(`合計が ${formatPt(total)} で 0 になりません。このまま保存しますか？`)) return;
      entries = active.map((r, i) => ({ memberId: r.memberId, pt10: filled[i] }));
    } else {
      const total = sum(filled) * 100;
      const expected = scoreTotalH * 100;
      if (total !== expected
        && !confirm(`素点の合計が ${total.toLocaleString('ja-JP')} で ${expected.toLocaleString('ja-JP')} になりません。このまま保存しますか？`)) return;
      entries = computeScore(active, filled);
    }

    const hanchanId = target?.hanchan.id || newId('h');
    const seq = target?.hanchan.seq ?? Math.max(0, ...model.hanchans.map((hc) => hc.hanchan.seq)) + 1;
    store.write(hanchanChanges({
      sessionId,
      hanchanId,
      seq,
      entries,
      inputMode: mode,
      existingResults: target ? Object.values(target.results) : [],
    }));
    ctx.replace(`#/session/${sessionId}`);
  };

  const remove = () => {
    if (!confirm(`${index + 1} 回目を削除しますか？`)) return;
    store.write({ hanchans: [{ id: target.hanchan.id, deleted: true }] });
    ctx.replace(`#/session/${sessionId}`);
  };

  const body = h('div', null,
    h('div', { class: 'segmented' }, modeButtons.pt, modeButtons.score),
    h('section', { class: 'card' }, help, list, totalLine),
    h('button', { type: 'button', class: 'block', onclick: save }, '保存'),
    target ? h('button', { type: 'button', class: 'block danger', onclick: remove }, 'この半荘を削除') : null);

  update();

  return { title: `${index + 1} 回目`, back: `#/session/${sessionId}`, body };
}

// ---------------------------------------------------------------------------
// チップ・ゲーム代（ゲーム代）の入力
// ---------------------------------------------------------------------------

export function chipsView(ctx, sessionId) {
  const { store } = ctx;
  const t = store.tables();
  const model = buildSession(t, sessionId);
  if (!model) return ctx.notFound();
  const { session, participants } = model;
  const gameFee = session.game_fee ?? 0;

  const rows = participants.map((p) => ({
    participant: p,
    name: memberName(t, p.member_id),
    chips: h('input', { inputmode: 'numeric', autocomplete: 'off', value: p.chips == null ? '' : String(p.chips), oninput: update }),
    fee: h('input', { inputmode: 'numeric', autocomplete: 'off', value: p.fee_share == null ? '' : String(p.fee_share), oninput: update }),
  }));

  const chipLine = h('p', { class: 'total-line' });
  const feeLine = h('p', { class: 'total-line' });

  // チップ：空が 1 つだけなら合計 0 になる値を自動で入れる。2 つ以上の空は 0 枚とみなす。
  // ゲーム代：空欄は自動（総額から手入力分を引いた残りを均等割り）
  function readChips() {
    const values = rows.map((r) => readInt(r.chips.value));
    const filled = values.filter((v) => v == null).length === 1 ? fillMissing(values, 0) : values.map((v) => v ?? 0);
    return { values, filled };
  }

  function update() {
    const { values, filled } = readChips();
    rows.forEach((r, i) => {
      r.chips.classList.toggle('invalid', Number.isNaN(values[i]));
      r.chips.placeholder = values[i] == null && values.filter((v) => v == null).length === 1 ? `自動 ${filled[i]}` : '';
    });
    if (values.some(Number.isNaN)) {
      chipLine.textContent = 'チップは整数で入れてください';
      chipLine.className = 'total-line ng';
    } else {
      const total = sum(filled);
      chipLine.textContent = total === 0 ? 'チップ合計 0（OK）' : `チップ合計 ${total}（0 になりません）`;
      chipLine.className = total === 0 ? 'total-line ok' : 'total-line ng';
    }

    const shares = rows.map((r) => readInt(r.fee.value));
    rows.forEach((r, i) => r.fee.classList.toggle('invalid', Number.isNaN(shares[i])));
    if (shares.some(Number.isNaN)) {
      feeLine.textContent = 'ゲーム代は整数で入れてください';
      feeLine.className = 'total-line ng';
      return;
    }
    const fees = allocateFees(gameFee, shares);
    rows.forEach((r, i) => { r.fee.placeholder = shares[i] == null ? `自動 ${fees[i]}` : ''; });
    const total = sum(fees);
    feeLine.textContent = total === gameFee
      ? `ゲーム代合計 ${total.toLocaleString('ja-JP')}P（OK）`
      : `ゲーム代合計 ${total.toLocaleString('ja-JP')}P（総額 ${gameFee.toLocaleString('ja-JP')}P と合いません）`;
    feeLine.className = total === gameFee ? 'total-line ok' : 'total-line ng';
  }

  const save = () => {
    const { values, filled } = readChips();
    const shares = rows.map((r) => readInt(r.fee.value));
    if (values.some(Number.isNaN) || shares.some(Number.isNaN)) {
      alert('整数で入れてください');
      return;
    }
    const chipTotal = sum(filled);
    if (chipTotal !== 0 && !confirm(`チップの合計が ${chipTotal} で 0 になりません。このまま保存しますか？`)) return;
    const feeTotal = sum(allocateFees(gameFee, shares));
    if (feeTotal !== gameFee && !confirm(`ゲーム代の合計が総額と合いません。このまま保存しますか？`)) return;
    store.write({
      participants: rows.map((r, i) => ({ id: r.participant.id, chips: filled[i], fee_share: shares[i] })),
    });
    ctx.replace(`#/session/${sessionId}`);
  };

  const signButton = (input) => h('button', { type: 'button', class: 'small secondary sign', onclick: () => toggleSign(input) }, '±');

  const body = h('div', null,
    h('section', { class: 'card' },
      h('h2', null, 'チップ（枚）'),
      h('div', { class: 'entry-list' }, rows.map((r) => h('div', { class: 'entry' },
        h('span', { class: 'entry-name' }, r.name), signButton(r.chips), r.chips))),
      chipLine),
    h('section', { class: 'card' },
      h('h2', null, `ゲーム代（総額 ${gameFee.toLocaleString('ja-JP')}P）`),
      h('p', { class: 'muted small' }, '空欄は自動で均等割り。人によって変えるときだけ入れる。'),
      h('div', { class: 'entry-list' }, rows.map((r) => h('div', { class: 'entry' },
        h('span', { class: 'entry-name' }, r.name), r.fee))),
      feeLine),
    h('button', { type: 'button', class: 'block', onclick: save }, '保存'));

  update();

  return { title: 'チップ・ゲーム代', back: `#/session/${sessionId}`, body };
}

// ---------------------------------------------------------------------------
// 画像で共有
// ---------------------------------------------------------------------------

// 画像を先に作ってプレビューを出し、ボタンで共有シートを開く。
// iPhone の共有シートはタップの直後に呼ばないと拒否されるため、画像の生成はボタンを押す前に済ませておく
export function shareView(ctx, sessionId) {
  const t = ctx.store.tables();
  const model = buildSession(t, sessionId);
  if (!model) return ctx.notFound();
  const names = model.participants.map((p) => memberName(t, p.member_id));
  const table = shareTable(model, names);

  const img = h('img', { class: 'share-image', alt: '成績表' });
  const button = h('button', { type: 'button', class: 'block', disabled: true }, '共有（LINE など）');
  const note = h('p', { class: 'muted small' }, '共有が使えないときは、画像を長押しして保存してください。');
  let file = null;

  drawTable(table).toBlob((blob) => {
    if (!blob) return;
    file = new File([blob], `mjroku_${model.session.date}.png`, { type: 'image/png' });
    img.src = URL.createObjectURL(blob);
    button.disabled = !navigator.canShare?.({ files: [file] });
  }, 'image/png');

  button.addEventListener('click', () => {
    navigator.share({ files: [file], title: table.title }).catch((err) => {
      if (err.name !== 'AbortError') alert(`共有できませんでした：${err.message}`);
    });
  });

  return {
    title: '画像で共有',
    back: `#/session/${sessionId}`,
    body: h('div', null, img, button, note),
  };
}
