const { app } = require('electron');
const Database = require('better-sqlite3');

const databasePath = process.argv[2];
const wanted = new Set(['制度要求', '不得打乱重分', '第二轮土地承包到期后再延长三十年', '无致命错误']);
app.whenReady().then(() => {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  const rows = db.prepare('SELECT result_id, matches_json FROM bid_project_duplicate_results ORDER BY updated_at DESC, rowid DESC LIMIT 1').all();
  for (const row of rows) {
    const matches = JSON.parse(row.matches_json || '[]');
    for (const match of matches) {
      for (const sentence of match.exactSentences || []) {
        const key = String(sentence.left || '').replace(/[。！？!?，,；;：:]/g, '').trim();
        if (!wanted.has(key)) continue;
        console.log(JSON.stringify({ resultId: row.result_id, matchId: match.id, matchType: match.matchType, similarity: match.similarity, leftParagraph: match.leftParagraph, rightParagraph: match.rightParagraph, sentence }, null, 2));
      }
    }
  }
  db.close();
  app.quit();
});
