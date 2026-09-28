const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function runMigrationAssertions() {
  const { createSqliteDatabase, schemaVersion } = require('./sqliteDatabase.cjs');
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
    assert.equal(database.schemaVersion, schemaVersion);
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
}

if (process.argv.includes('--electron-native')) {
  try {
    runMigrationAssertions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  test('migrates legacy duplicate result JSON into normalized match rows', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native duplicate migration test timed out');
  });
}
