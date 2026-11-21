// 画面の通し確認（v1.0.1）：西川卓ルール（25,000 持ち 30,000 返し・ウマなし・五捨六入）を作って素点で入れる。入力中は下のタブを隠す
const path = require('path');
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const { createGas, serveGas, serveStatic, readSheet } = require('./mock-gas.cjs');

const PROJECT = path.resolve(__dirname, '../..');
// ブラウザは手元の Edge を使う（別の場所なら環境変数 MJROKU_BROWSER で指定）
const EDGE = process.env.MJROKU_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ADMIN = 'テスト管理者の合言葉';
const step = (s) => console.log('▶', s);

(async () => {
  const gas = createGas(path.join(PROJECT, 'gas/Code.gs'));
  gas.ctx.setupSheets();
  gas.prompts.push('テスト合言葉'); gas.ctx.setPasscode();
  gas.prompts.push(ADMIN); gas.ctx.setAdminPasscode();
  const post = (body) => JSON.parse(gas.ctx.doPost({ postData: { contents: JSON.stringify({ ...body, passcode: ADMIN }) } }).body);
  const M = ['Aさん', 'Bさん', 'Cさん', 'Dさん'];
  assert.equal(post({ action: 'save', records: {
    members: M.map((name, i) => ({ id: `m_${i}`, name })),
    group_members: M.map((_, i) => ({ id: `g_itsumo:m_${i}`, group_id: 'g_itsumo', member_id: `m_${i}` })),
  } }).ok, true);
  const gs = await serveGas(gas, 8790);
  const app = await serveStatic(path.join(PROJECT, 'app'), 8791);
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const text = (sel) => page.$eval(sel, (el) => el.textContent);
  const waitText = (sel, part) => page.waitForFunction((s, p) => document.querySelector(s)?.textContent.includes(p), { timeout: 10000 }, sel, part);
  const setValue = (el, v) => el.evaluate((e, val) => { e.value = val; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, v);
  try {
    step('管理者で接続');
    await page.goto('http://localhost:8791/');
    await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('input[type=url]'));
    await page.type('input[type=text]', '入力係');
    await page.type('input[type=url]', 'http://localhost:8790/exec');
    await page.type('input[type=password]', ADMIN);
    await page.$eval('button::-p-text(保存して接続)', (b) => b.click());
    await waitText('.result', 'に接続しました');

    step('西川卓ルール：ウマに「なし（オカだけ）」を選べて、1 行表示が「ウマなし」になる');
    await page.goto('http://localhost:8791/#/rule/new');
    await page.waitForSelector('.rule-options');
    await page.type('input[type=text]', '西川卓ルール');
    const umaSelect = await page.evaluateHandle(() => [...document.querySelectorAll('.rule-options select')].find((s) => s.querySelector('option[value=none]')));
    const roundSelect = await page.evaluateHandle(() => [...document.querySelectorAll('.rule-options select')].find((s) => s.querySelector('option[value=round5]')));
    await setValue(roundSelect, 'round5');
    await setValue(umaSelect, 'none');
    await waitText('.rule-line', '25,000 持ち 30,000 返し・ウマなし・五捨六入');
    await page.$eval('button.block::-p-text(保存)', (b) => b.click());
    await page.waitForFunction(() => location.hash === '#/rules');
    await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent.includes('同期済'), { timeout: 10000 });
    const rule = readSheet(gas, 'rules').find((r) => r.name === '西川卓ルール');
    assert.deepEqual([rule.start_points, rule.return_points, rule.uma, rule.uma_oka, rule.rounding], [25000, 30000, '0,0,0,0', true, 'round5']);
    // 開き直しても「なし（オカだけ）」のまま
    await page.goto(`http://localhost:8791/#/rule/${rule.id}`);
    await page.waitForSelector('.rule-options');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.rule-options select')].find((s) => s.querySelector('option[value=none]')).value), 'none');

    step('対局を作ってこのルールを選ぶ → 素点で 40,000／32,600／24,500／2,900 → +30／+3／−6／−27');
    await page.goto('http://localhost:8791/#/sessions/new');
    await page.waitForSelector('.rule-settings select');
    await page.evaluate((id) => { const s = document.querySelector('.rule-settings select'); s.value = id; s.dispatchEvent(new Event('change')); }, rule.id);
    await waitText('.rule-line', 'ウマなし・五捨六入');
    for (const name of M) await page.$$eval('label, button', (els, n) => els.find((e) => e.textContent.trim() === n)?.click(), name);
    await page.$eval('button::-p-text(作成して入力へ)', (b) => b.click());
    await page.waitForFunction(() => /^#\/session\/s_[a-z0-9]+/.test(location.hash), { timeout: 10000 });
    const sid = (await page.evaluate(() => location.hash)).split('/')[2];
    await page.goto(`http://localhost:8791/#/session/${sid}/hanchan/new`);
    await page.waitForSelector('.entry input');
    await page.$eval('button::-p-text(素点入力)', (b) => b.click());
    const inputs = await page.$$eval('.entry input', (els) => els.map((e, i) => (e.offsetParent ? i : -1)).filter((i) => i >= 0));
    const scoreInputs = (await page.$$('.entry input')).filter((_, i) => inputs.includes(i));
    const scores = ['400', '326', '245', '29'];
    for (let i = 0; i < 4; i++) await setValue(scoreInputs[i], scores[i]);
    const previews = await page.$$eval('.preview', (ps) => ps.map((p) => p.textContent));
    assert.deepEqual(previews, ['+30（1着）', '+3（2着）', '-6（3着）', '-27（4着）'], previews.join(' / '));

    step('入力中は下のタブを隠し、入力欄から離れると戻す');
    const tabVisible = () => page.$eval('.tabbar', (e) => getComputedStyle(e).display !== 'none');
    assert.equal(await tabVisible(), true);
    await scoreInputs[3].focus();
    await page.waitForFunction(() => document.body.classList.contains('typing'));
    assert.equal(await tabVisible(), false, '入力中はタブを隠す');
    await scoreInputs[2].focus(); // 次の欄へ移っても隠したまま
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await tabVisible(), false);
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForFunction(() => !document.body.classList.contains('typing'));
    assert.equal(await tabVisible(), true, '離れたらタブを戻す');
    // チェックボックスや選択欄（グループの切り替えなど）では隠さない
    await page.goto('http://localhost:8791/#/sessions/new');
    await page.waitForSelector('.rule-settings select');
    await page.focus('.rule-settings select');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await tabVisible(), true);

    assert.deepEqual(errors, []);
    console.log('rule-and-typing OK');
  } catch (err) {
    console.error('FAILED', err.message, '（画面：' + path.join(require('os').tmpdir(), 'mjroku-e2e-failure.png') + '）');
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'mjroku-e2e-failure.png'), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close(); gs.close(); app.close();
  }
})();
