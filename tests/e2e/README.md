# 画面の通し確認（tests/e2e）

偽の GAS（`mock-gas.cjs`。`gas/Code.gs` を Node 上で動かす）と手元のブラウザ（Edge、ヘッドレス）で、アプリを iPhone の画面幅で動かして確かめる。
本物のスプレッドシート・GAS・合言葉には触れない。データはすべて作り物で、実名は使わない。

## 動かし方

```
npm install           # 初回だけ（puppeteer-core を入れる）
npm run test:e2e      # tests/e2e の確認をすべて流す
```

- ブラウザは `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` を使う。別の場所なら環境変数 `MJROKU_BROWSER` で指定する
- ポート 8790（偽 GAS）と 8791（アプリ）を使う
- 失敗したときは、そのときの画面を OS の一時フォルダの `mjroku-e2e-failure.png` に保存する

## ファイル

| ファイル | 確かめること |
|---|---|
| `mock-gas.cjs` | 部品（偽 GAS と静的サーバー）。確認ではない |
| `rule-and-typing.cjs` | 西川卓ルール（ウマなし・オカだけ）の作成と素点入力、入力中に下のタブを隠すこと（v1.0.1） |

- `npm test`（単体テスト）は `tests/*.test.js` だけを流し、ここは流さない（ブラウザが要るため）
- v1.0.0 までの通し確認（e2e.cjs ほか）は、作業用の一時フォルダに置いていたため消えた。必要になった画面から、ここに足していく
