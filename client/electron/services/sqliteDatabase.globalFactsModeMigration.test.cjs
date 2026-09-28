const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runMigrationAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-global-facts-mode-migration-'));
  const app = {
    getPath: () => userDataPath,
    once() {},
  };
  let database;
  try {
    database = createSqliteDatabase(app);
    database.db.prepare(`
      INSERT INTO technical_plan_meta (
        id, step, tender_file_name, global_facts_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(1, 'outline', '保留的招标文件.docx', 'fabricate', '2026-09-28', '2026-09-28');
    database.db.pragma('user_version = 35');
    database.close();

    database = createSqliteDatabase(app);
    const meta = database.db.prepare(`
      SELECT step, tender_file_name, global_facts_mode
      FROM technical_plan_meta
      WHERE id = 1
    `).get();

    assert.deepEqual(
      {
        schemaVersion: database.schemaVersion,
        userVersion: database.db.pragma('user_version', { simple: true }),
        ...meta,
      },
      {
        schemaVersion: 36,
        userVersion: 36,
        step: 'outline',
        tender_file_name: '保留的招标文件.docx',
        global_facts_mode: 'omit',
      },
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
  test('upgrades v35 global facts fabricate mode to omit without losing other data', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native migration test timed out');
  });
}
