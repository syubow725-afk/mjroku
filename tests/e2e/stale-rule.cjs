// 画面の通し確認（v1.0.3）：ルールを直す前に作った対局を、今のルールに合わせ直せる。
// 例：西川卓ルールを「ウマ・オカなし」（25,000 との差）で作って対局を入れた後、「30,000 返し・ウマなし（オカだけ）」に直した。
// 対局情報を開くと「今のルールと違う」と出て、ボタンで合わせると、素点で入れた半荘が計算し直される（25,800 → +1 が −4 に）
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const { createGas, serveGas, serveStatic, readSheet } = require('./mock-gas.cjs');

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
  const rule = { id: 'r_local', name: 'この卓のルール', group_id: 'g_itsumo', players: 4, start_points: 25000, return_points: 30000, uma: '20,10,-10,-20', uma_oka: false, rounding: 'round5', tie_break: 'seat' };
  // 直す前のルール（ウマ・オカなし）で入れた対局。素点 40,000／25,800／24,500／9,700 → +15／+1／−1／−15
  const scores = [40000, 25800, 24500, 9700];
  const oldPts = [15, 1, -1, -15];
  let res = post({ action: 'save', records: {
    members: M.map((name, i) => ({ id: `m_${i}`, name })),
    group_members: M.map((_, i) => ({ id: `g_itsumo:m_${i}`, group_id: 'g_itsumo', member_id: `m_${i}` })),
    rules: [rule],
    sessions: [{ id: 's_old', group_id: 'g_itsumo', date: '2026-11-20', rate: 50, chip_rate: 200, game_fee: 0, created_by: '入力係',
      rule_name: rule.name, rule_snapshot: JSON.stringify({ ...rule, uma: '0,0,0,0' }) }],
    participants: M.map((_, i) => ({ id: `s_old:m_${i}`, session_id: 's_old', member_id: `m_${i}`, col_order: i, chips: 0 })),
    hanchans: [{ id: 'h_old', session_id: 's_old', seq: 1, input_mode: 'score' }],
    results: M.map((_, i) => ({ id: `h_old:m_${i}`, hanchan_id: 'h_old', member_id: `m_${i}`, seat: i, raw_score: scores[i], pt: oldPts[i], rank: i + 1 })),
  } });
  assert.equal(res.ok, true, JSON.stringify(res));
  // そのあとルールを「30,000 返し・ウマなし（オカだけ）」に直した
  res = post({ action: 'save', records: { rules: [{ id: 'r_local', uma: '0,0,0,0', uma_oka: true }] } });
  assert.equal(res.ok, true);

  const gs = await serveGas(gas, 8790);
  const app = await serveStatic(path.join(PROJECT, 'app'), 8791);
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const waitText = (sel, part) => page.waitForFunction((s, p) => document.querySelector(s)?.textContent.includes(p), { timeout: 10000 }, sel, part);
  try {
    step('管理者で接続');
    await page.goto('http://localhost:8791/');
    await page.waitForFunction(() => location.hash === '#/settings' && document.querySelector('input[type=url]'));
    await page.type('input[type=text]', '入力係');
    await page.type('input[type=url]', 'http://localhost:8790/exec');
    await page.type('input[type=password]', ADMIN);
    await page.$eval('button::-p-text(保存して接続)', (b) => b.click());
    await waitText('.result', 'に接続しました');

    step('対局情報を開くと、今のルールと違うと知らせる（ルールの欄は同じ「この卓のルール」が選ばれたまま）');
    await page.goto('http://localhost:8791/#/session/s_old/edit');
    await page.waitForSelector('.rule-settings select');
    await waitText('.rule-stale', '今の「この卓のルール」（25,000 持ち 30,000 返し・ウマなし・五捨六入）と違います');
    assert.ok((await page.$eval('.rule-line', (e) => e.textContent)).includes('ウマオカなし'), '開いた時点は対局に保存したルールのまま');

    step('ボタンで今のルールに合わせて保存すると、素点の半荘が計算し直される');
    await page.$eval('button::-p-text(今の「この卓のルール」に合わせる)', (b) => b.click());
    await waitText('.rule-line', '25,000 持ち 30,000 返し・ウマなし・五捨六入');
    assert.equal(await page.$eval('.rule-stale', (e) => e.hidden), true);
    await page.$$eval('button', (bs) => bs.find((b) => b.textContent.trim() === '保存').click());
    await page.waitForFunction(() => location.hash === '#/session/s_old', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#sync-status')?.textContent.includes('同期済'), { timeout: 10000 });
    assert.ok(dialogs.some((d) => d.includes('計算し直しました')), dialogs.join(' / '));
    const pts = readSheet(gas, 'results').sort((a, b) => a.seat - b.seat).map((r) => r.pt);
    assert.deepEqual(pts, [30, -4, -6, -20], '25,800 → 26,000 − 30,000 ＝ −4');

    step('合わせた後は、もう知らせない');
    await page.goto('http://localhost:8791/#/session/s_old/edit');
    await page.waitForSelector('.rule-settings select');
    assert.equal(await page.$eval('.rule-stale', (e) => e.hidden), true);

    assert.deepEqual(errors, []);
    console.log('stale-rule OK');
  } catch (err) {
    console.error('FAILED', err.message, `（画面：${FAILURE}）`);
    await page.screenshot({ path: FAILURE, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close(); gs.close(); app.close();
  }
})();
