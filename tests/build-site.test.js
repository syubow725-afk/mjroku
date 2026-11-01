import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGasUrl, buildSite } from '../scripts/build-site.mjs';

// 実在の URL は使わない（形だけの作り物）
const URL = 'https://script.google.com/macros/s/AKfy_example-ID_123/exec';

test('checkGasUrl：GAS のウェブアプリ URL の形だけを通す', () => {
  assert.equal(checkGasUrl(URL), true);
  assert.equal(checkGasUrl(` ${URL} `), true);
  for (const bad of ['', undefined, 'http://script.google.com/macros/s/x/exec', 'https://script.google.com/macros/s/x/dev',
    'https://example.com/macros/s/x/exec', `${URL}?a=1`]) {
    assert.equal(checkGasUrl(bad), false, String(bad));
  }
});

test('buildSite：環境変数 GAS_URL を site.json に書く。無い・形が違えば公開を止める', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjroku-site-'));
  buildSite({ GAS_URL: URL }, dir);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8')), { gasUrl: URL });
  const empty = mkdtempSync(join(tmpdir(), 'mjroku-site-'));
  assert.throws(() => buildSite({}, empty), /GAS_URL がありません/);
  assert.throws(() => buildSite({ GAS_URL: 'https://example.com/' }, empty), /形が違います/);
  assert.equal(existsSync(join(empty, 'site.json')), false);
});
