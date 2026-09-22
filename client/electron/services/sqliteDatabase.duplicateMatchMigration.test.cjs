const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

test('migrates legacy duplicate result JSON into normalized match rows', () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-duplicate-match-migration-'));
  let database;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const db = database.db;
    const leftProjectId = 'legacy-left';
    const rightProjectId = 'legacy-right';
    const resultId = 'legacy-result';
    db.prepare(`
      INSERT INTO bid_projects (
        project_id, project_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
    `).run(leftProjectId, '旧左侧', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    db.prepare(`
      INSERT INTO bid_projects (
        project_id, project_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?)
    `).run(rightProjectId, '旧右侧', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z');
    db.prepare(`
      INSERT INTO bid_project_duplicate_results (
        result_id, left_project_id, right_project_id, summary_json, matches_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      resultId,
      leftProjectId,
      rightProjectId,
      JSON.stringify({ duplicateParagraphCount: 2 }),
      JSON.stringify([{ id: 'legacy-1' }, { id: 'legacy-2' }]),
      '2026-09-22T00:00:00.000Z',
      '2026-09-22T00:00:00.000Z',
    );
    db.exec('DROP TABLE bid_project_duplicate_matches; PRAGMA user_version = 32;');
    database.close();
    database = null;

    database = createSqliteDatabase(app);
    assert.equal(database.schemaVersion, 33);
    assert.deepEqual(
      database.db.prepare(`
        SELECT match_index, match_id, match_json
        FROM bid_project_duplicate_matches
        WHERE result_id = ?
        ORDER BY match_index
      `).all(resultId),
      [
        { match_index: 0, match_id: 'legacy-1', match_json: '{"id":"legacy-1"}' },
        { match_index: 1, match_id: 'legacy-2', match_json: '{"id":"legacy-2"}' },
      ],
    );
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test.after(() => {
  if (process.versions.electron) {
    require('electron').app.quit();
  }
});
