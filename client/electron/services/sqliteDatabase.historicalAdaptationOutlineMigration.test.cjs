const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function rebuildWithoutOutlineColumns(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  assert.ok(row?.sql, `Expected ${tableName} to exist`);
  const legacySql = row.sql
    .replace(/,?\s*historical_adaptation_original_outline_json TEXT/gi, '')
    .replace(/,?\s*historical_adaptation_outline_changes_json TEXT/gi, '')
    .replace(/,?\s*historical_adaptation_outline_confirmed_at TEXT/gi, '');
  db.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
  db.exec(legacySql);
}

function runAssertions() {
  const {
    createSqliteDatabase,
    createTechnicalPlanProjectSchema,
    getTechnicalPlanProjectTablePrefix,
    schemaVersion,
  } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-outline-migration-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const projectMeta = `${getTechnicalPlanProjectTablePrefix('legacy-adaptation-outline')}meta`;
    createTechnicalPlanProjectSchema(database.db, 'legacy-adaptation-outline');
    rebuildWithoutOutlineColumns(database.db, 'technical_plan_meta');
    rebuildWithoutOutlineColumns(database.db, projectMeta);
    database.db.pragma('user_version = 39');
    database.close();

    database = createSqliteDatabase(app);
    assert.equal(schemaVersion, 44);
    assert.equal(database.db.pragma('user_version', { simple: true }), 44);
    for (const tableName of ['technical_plan_meta', projectMeta]) {
      const columns = new Set(database.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((row) => row.name));
      assert.equal(columns.has('historical_adaptation_original_outline_json'), true);
      assert.equal(columns.has('historical_adaptation_outline_changes_json'), true);
      assert.equal(columns.has('historical_adaptation_outline_confirmed_at'), true);
    }
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try {
    runAssertions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  test('upgrades root and dynamic project meta tables with historical adaptation outline columns', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native migration test timed out');
  });
}
