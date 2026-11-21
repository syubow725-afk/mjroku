// 画面の通し確認（tests/e2e/*.cjs。mock-gas.cjs を除く）を順に流す：npm run test:e2e
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('tests/e2e').filter((f) => f.endsWith('.cjs') && f !== 'mock-gas.cjs').sort();
let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [`tests/e2e/${f}`], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\nNG：${failed} 件が失敗` : `\nOK：${files.length} 件すべて通過`);
process.exitCode = failed ? 1 : 0;
