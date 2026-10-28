/**
 * 麻雀録 GAS 窓口（段階0：雛形）
 *
 * スプレッドシートに紐づけ、ウェブアプリとして公開する。
 *   実行ユーザー：自分　／　アクセスできるユーザー：全員
 *
 * 段階0では疎通確認（action=ping）だけを返す。
 * 合言葉の照合とデータの読み書きは段階1以降で足す。
 */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    return json_({
      ok: true,
      app: 'mjroku',
      // 紐づいたスプレッドシートを開けているかの確認を兼ねる
      spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName(),
      time: new Date().toISOString(),
    });
  }
  return json_({ ok: false, error: 'unknown action: ' + action });
}

// 書き込みは段階1で実装する。アプリ側は Content-Type: text/plain で JSON を送る想定
// （application/json だとブラウザが事前確認（CORS preflight）を送り、GAS が応答できないため）
function doPost(e) {
  return json_({ ok: false, error: 'not implemented' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
