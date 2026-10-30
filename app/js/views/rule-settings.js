// 対局作成画面のルール設定（仕様書 6.1.1）
//   プリセットを選ぶ → □ 端数を丸める（初期はなし。入れたら四捨五入から選ぶ）
//                    → ☑ ウマ・オカあり（初期はあり。ウマは 10-20／10-30／5-10／自由入力）
// 今の設定は 1 行で表示する（例：25,000 持ち 30,000 返し・ウマ 10-20・丸めなし）
import { h } from '../util.js';
import { normalizeRule, parseUma, umaLabel, describeRule, ROUNDING_LABELS } from '../calc.js';
import { umaToString } from '../model.js';

const UMA_CHOICES = ['10-20', '10-30', '5-10'];
const ROUNDING_CHOICES = ['round4', 'round5', 'floor', 'ceil'];

// presets：rules シートの行、initialPresetId：選んでおくプリセット、initialRule：編集時の対局のルール（計算用の形）
// 戻り値の read() は { preset, settings } か、入力に誤りがあれば { error }
export function ruleSettings({ presets, initialPresetId, initialRule }) {
  const presetSelect = h('select', null,
    presets.map((p) => h('option', { value: p.id, selected: p.id === initialPresetId }, p.name)));

  const roundCheck = h('input', { type: 'checkbox' });
  const roundSelect = h('select', null, ROUNDING_CHOICES.map((m) => h('option', { value: m }, ROUNDING_LABELS[m])));
  const umaCheck = h('input', { type: 'checkbox' });
  const umaSelect = h('select', null,
    UMA_CHOICES.map((u) => h('option', { value: u }, u)),
    h('option', { value: 'custom' }, '自由入力'));
  const umaCustom = h('input', { type: 'text', autocomplete: 'off', placeholder: '例：10-20 または 30,10,-10,-30' });
  const summary = h('p', { class: 'rule-line' });

  const preset = () => presets.find((p) => p.id === presetSelect.value) || presets[0];

  // ルール（計算用の形）を画面の状態に反映する
  function apply(rule) {
    roundCheck.checked = rule.rounding !== 'none';
    roundSelect.value = rule.rounding !== 'none' ? rule.rounding : 'round4';
    umaCheck.checked = rule.umaOka;
    const label = rule.uma.every((v) => v === 0) ? '10-20' : umaLabel(rule.uma);
    if (UMA_CHOICES.includes(label)) {
      umaSelect.value = label;
      umaCustom.value = '';
    } else {
      umaSelect.value = 'custom';
      umaCustom.value = label.includes('/') ? umaToString(rule.uma) : label;
    }
    update();
  }

  function read() {
    const base = normalizeRule(preset());
    let uma = [0, 0, 0, 0];
    if (umaCheck.checked) {
      uma = parseUma(umaSelect.value === 'custom' ? umaCustom.value : umaSelect.value);
      if (!uma) return { error: 'ウマを「10-20」か「30,10,-10,-30」の形で入れてください（合計 0）' };
    }
    const settings = { umaOka: umaCheck.checked, uma, rounding: roundCheck.checked ? roundSelect.value : 'none' };
    return { preset: preset(), settings, rule: { ...base, ...settings } };
  }

  // 選んでいるものに応じて、細かい選択肢の表示と 1 行表示を更新する
  function update() {
    roundSelect.hidden = !roundCheck.checked;
    umaSelect.hidden = !umaCheck.checked;
    umaCustom.hidden = !umaCheck.checked || umaSelect.value !== 'custom';
    const r = read();
    summary.textContent = r.error || describeRule(r.rule);
    summary.classList.toggle('ng', Boolean(r.error));
  }

  presetSelect.addEventListener('change', () => apply(normalizeRule(preset())));
  for (const el of [roundCheck, roundSelect, umaCheck, umaSelect]) el.addEventListener('change', update);
  umaCustom.addEventListener('input', update);

  apply(initialRule || normalizeRule(preset()));

  const el = h('div', { class: 'rule-settings' },
    h('label', { class: 'field' }, h('span', null, 'ルール'), presetSelect),
    h('div', { class: 'check-row' },
      h('label', { class: 'check' }, roundCheck, '端数を丸める'),
      roundSelect),
    h('div', { class: 'check-row' },
      h('label', { class: 'check' }, umaCheck, 'ウマ・オカあり'),
      umaSelect),
    umaCustom,
    summary);

  return { el, read };
}
