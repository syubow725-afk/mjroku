// ルールの設定欄（仕様書 6.1.1）
//   ruleOptions  … ☑ 端数を丸める（初期は四捨五入）、☑ ウマ・オカあり（10-20／10-30／5-10／自由入力）、
//                  同点（上家優先／等分）と 1 行表示。
//                  対局作成画面とルール編集画面の両方で使う
//   ruleSettings … 対局作成画面用。プリセットの選択と「この設定をルールとして保存」を足したもの
import { h } from '../util.js';
import { normalizeRule, parseUma, umaLabel, describeRule, ROUNDING_LABELS, TIE_BREAK_LABELS } from '../calc.js';
import { umaToString } from '../model.js';

const UMA_CHOICES = ['10-20', '10-30', '5-10'];
const ROUNDING_CHOICES = ['round4', 'round5', 'floor', 'ceil'];
const DEFAULT_UMA = [200, 100, -100, -200];

// initial：最初に表示するルール（計算用の形）、base()：今の持ち点と返し { start, ret }
// read() は { settings, rule, umaChoice } か、入力に誤りがあれば { error }
//   settings  … { umaOka, uma, rounding, tieBreak }（ウマ・オカなしなら uma は 0）
//   umaChoice … ウマ・オカなしでも、選んでいるウマ（プリセットに保存して、あとで戻せるように）
export function ruleOptions({ initial, base, onChange = () => {} }) {
  const roundCheck = h('input', { type: 'checkbox' });
  const roundSelect = h('select', null, ROUNDING_CHOICES.map((m) => h('option', { value: m }, ROUNDING_LABELS[m])));
  const umaCheck = h('input', { type: 'checkbox' });
  const umaSelect = h('select', null,
    UMA_CHOICES.map((u) => h('option', { value: u }, u)),
    h('option', { value: 'custom' }, '自由入力'));
  const umaCustom = h('input', { type: 'text', class: 'uma-custom', autocomplete: 'off', placeholder: '例：10-20 または 30,10,-10,-30' });
  // 同点の扱いはウマ・オカがあるときだけ意味を持つ（なしなら素点の差だけで同点は同じ pt）
  const tieSelect = h('select', null, Object.entries(TIE_BREAK_LABELS).map(([v, label]) => h('option', { value: v }, label)));
  const tieRow = h('div', { class: 'check-row' }, h('span', { class: 'check' }, '同点のウマ・オカ'), tieSelect);
  const summary = h('p', { class: 'rule-line' });

  // ルール（計算用の形）を画面の状態に反映する
  function apply(rule) {
    roundCheck.checked = rule.rounding !== 'none';
    roundSelect.value = rule.rounding !== 'none' ? rule.rounding : 'round4';
    umaCheck.checked = rule.umaOka;
    tieSelect.value = rule.tieBreak || 'seat';
    const uma = rule.uma.every((v) => v === 0) ? DEFAULT_UMA : rule.uma;
    const label = umaLabel(uma);
    if (UMA_CHOICES.includes(label)) {
      umaSelect.value = label;
      umaCustom.value = '';
    } else {
      umaSelect.value = 'custom';
      umaCustom.value = label.includes('/') ? umaToString(uma) : label;
    }
    update();
  }

  function read() {
    const umaChoice = parseUma(umaSelect.value === 'custom' ? umaCustom.value : umaSelect.value);
    if (umaCheck.checked && !umaChoice) return { error: 'ウマを「10-20」か「30,10,-10,-30」の形で入れてください（合計 0）' };
    const settings = {
      umaOka: umaCheck.checked,
      uma: umaCheck.checked ? umaChoice : [0, 0, 0, 0],
      rounding: roundCheck.checked ? roundSelect.value : 'none',
      tieBreak: tieSelect.value,
    };
    return { settings, umaChoice: umaChoice || DEFAULT_UMA, rule: { ...base(), ...settings } };
  }

  // 選んでいるものに応じて、細かい選択肢の表示と 1 行表示を更新する
  function update() {
    roundSelect.hidden = !roundCheck.checked;
    umaSelect.hidden = !umaCheck.checked;
    umaCustom.hidden = !umaCheck.checked || umaSelect.value !== 'custom';
    tieRow.hidden = !umaCheck.checked;
    const r = read();
    summary.textContent = r.error || describeRule(r.rule);
    summary.classList.toggle('ng', Boolean(r.error));
    onChange();
  }

  for (const el of [roundCheck, roundSelect, umaCheck, umaSelect, tieSelect]) el.addEventListener('change', update);
  umaCustom.addEventListener('input', update);

  const el = h('div', { class: 'rule-options' },
    h('div', { class: 'check-row' }, h('label', { class: 'check' }, roundCheck, '端数を丸める'), roundSelect),
    h('div', { class: 'check-row' }, h('label', { class: 'check' }, umaCheck, 'ウマ・オカあり'), umaSelect),
    umaCustom,
    tieRow,
    summary);

  apply(initial);
  return { el, read, apply, update };
}

// 対局作成画面のルール欄
//   presets：選べるルールの行、initialPresetId：選んでおくもの、initialRule：編集時の対局のルール
//   onSaveAsPreset(preset, read)：「この設定をルールとして保存」を押したとき。作った行を返す
// read() は { preset, settings, rule } か { error }
export function ruleSettings({ presets, initialPresetId, initialRule, onSaveAsPreset }) {
  const presetSelect = h('select');
  const renderOptions = () => presetSelect.replaceChildren(
    ...presets.map((p) => h('option', { value: p.id }, p.name)));
  renderOptions();
  presetSelect.value = initialPresetId;

  const preset = () => presets.find((p) => p.id === presetSelect.value) || presets[0];
  const base = () => {
    const r = normalizeRule(preset());
    return { start: r.start, ret: r.ret };
  };
  const options = ruleOptions({ initial: initialRule || normalizeRule(preset()), base });
  presetSelect.addEventListener('change', () => options.apply(normalizeRule(preset())));

  const read = () => {
    const r = options.read();
    return r.error ? r : { ...r, preset: preset() };
  };

  // その場で調整した設定を、新しいプリセットとして保存し、それを選んだ状態にする
  const saveAs = h('button', {
    type: 'button', class: 'small secondary',
    onclick: () => {
      const r = read();
      if (r.error) {
        alert(r.error);
        return;
      }
      const row = onSaveAsPreset(r);
      if (!row) return;
      presets.push(row);
      renderOptions();
      presetSelect.value = row.id;
      options.update();
    },
  }, 'この設定をルールとして保存');

  const el = h('div', { class: 'rule-settings' },
    h('label', { class: 'field' }, h('span', null, 'ルール'), presetSelect),
    options.el,
    onSaveAsPreset ? h('div', { class: 'save-as' }, saveAs) : null);

  return { el, read };
}
