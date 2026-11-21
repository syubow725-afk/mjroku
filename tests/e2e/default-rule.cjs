// 画面の通し確認（v1.0.2）：新しい対局で最初に選ばれるルール。
// 本家から取り込んだ対局しかないグループでは、そのグループだけのルールから始まる（西川卓）。
// 本アプリで対局を作ったあとは、その対局のルールを引き継ぐ
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const { createGas, serveGas, serveStatic } = require('./mock-gas.cjs');

const PROJECT = path.resolve(__dirname, '../..');
const EDGE = process.env.MJROKU_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ADMIN = 'テスト管理者の合言葉';
const FAILURE = path.join(os.tmpdir(), 'mjroku-e2e-failure.png');
const step = (s) => console.log('▶', s);

(async () => {
  const gas = createGas(path.join(PROJECT, 'gas/Code.gs'));
  gas.ctx.setupSheets();
  gas.prompts.push(ADMIN); gas.ctx.setAdminPasscode();
  const post = (body) => JSON.parse(gas.ctx.doPost({ postData: { contents: JSON.stringify({ ...body, passcode: ADMIN }) } }).body);
  const M = ['Aさん', 'Bさん', 'Cさん', 'Dさん'];
  const std = JSON.parse(JSON.stringify(gas.ctx.readTable_('rules').byId.r_standard));
  // 本家から取り込んだ対局（ルールは仮に「いつものルール」）と、このグループだけのルール
  const res = post({ action: 'save', records: {
    members: M.map((name, i) => ({ id: `m_${i}`, name })),
    group_members: M.map((_, i) => ({ id: `g_itsumo:m_${i}`, group_id: 'g_itsumo', member_id: `m_${i}` })),
    rules: [{ id: 'r_local', name: 'この卓のルール', group_id: 'g_itsumo', players: 4, start_points: 25000, return_points: 30000, uma: '0,0,0,0', uma_oka: true, rounding: 'round5', tie_break: 'seat' }],
    sessions: [{ id: 's_imp', group_id: 'g_itsumo', date: '2026-09-19', rate: 50, chip_rate: 200, game_fee: 0,
      rule_name: 'いつものルール', rule_snapshot: JSON.stringify({ ...std, id: 'r_standard' }), created_by: 'Aさん（本家から取り込み）' }],
  } });
  assert.equal(res.ok, true, JSON.stringify(res));
  const gs = await serveGas(gas, 8790);
  const app = await serveStatic(path.join(PROJECT, 'app'), 8791);
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const waitText = (sel, part) => page.waitForFunction((s, p) => document.querySelector(s)?.textContent.includes(p), { timeout: 10000 }, sel, part);
  const chosenRule = async () => {
    await page.goto('http://localhost:8791/#/sessions');
    await page.goto('http://localhost:8791/#/sessions/new');
    await page.waitForSelector('.rule-settings select');
    return page.$eval('.rule-settings select', (s) => s.selectedOptions[0].textContent);
  };
  try {
    step('管理者で接続');
    await page.goto('http://localhost:8791/');
    await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('input[type=url]'));
    await page.type('input[type=text]', '入力係');
    await page.type('input[type=url]', 'http://localhost:8790/exec');
    await page.type('input[type=password]', ADMIN);
    await page.$eval('button::-p-text(保存して接続)', (b) => b.click());
    await waitText('.result', 'に接続しました');

    step('取り込んだ対局しかない：このグループだけのルールから始まる');
    assert.equal(await chosenRule(), 'この卓のルール');
    await waitText('.rule-line', '25,000 持ち 30,000 返し・ウマなし・五捨六入');

    step('本アプリで「いつものルール」の対局を作ると、次からはそれを引き継ぐ');
    await page.evaluate(() => { const s = document.querySelector('.rule-settings select'); s.value = 'r_standard'; s.dispatchEvent(new Event('change')); });
    for (const name of M) await page.$$eval('button.chip', (els, n) => els.find((e) => e.textContent.trim() === n)?.click(), name);
    await page.$eval('button::-p-text(作成して入力へ)', (b) => b.click());
    await page.waitForFunction(() => /^#\/session\/s_[a-z0-9]+/.test(location.hash), { timeout: 10000 });
    assert.equal(await chosenRule(), 'いつものルール');

    assert.deepEqual(errors, []);
    console.log('default-rule OK');
  } catch (err) {
    console.error('FAILED', err.message, `（画面：${FAILURE}）`);
    await page.screenshot({ path: FAILURE, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close(); gs.close(); app.close();
  }
})();
