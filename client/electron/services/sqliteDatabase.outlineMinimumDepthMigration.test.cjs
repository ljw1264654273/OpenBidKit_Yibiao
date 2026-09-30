const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function rebuildWithoutOutlineMinimumDepth(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  assert.ok(row?.sql, `Expected ${tableName} to exist`);
  const legacySql = row.sql
    .replace(/,?\s*outline_minimum_depth INTEGER NOT NULL DEFAULT 0/gi, '')
    .replace(/,?\s*outline_minimum_depth_snapshot INTEGER/gi, '');
  db.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
  db.exec(legacySql);
}

function getColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => column.name));
}

function runMigrationAssertions() {
  const {
    createSqliteDatabase,
    schemaVersion,
    createTechnicalPlanProjectSchema,
    getTechnicalPlanProjectTablePrefix,
  } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-outline-depth-migration-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const projectMeta = `${getTechnicalPlanProjectTablePrefix('legacy-depth')}meta`;
    createTechnicalPlanProjectSchema(database.db, 'legacy-depth');
    rebuildWithoutOutlineMinimumDepth(database.db, 'technical_plan_meta');
    rebuildWithoutOutlineMinimumDepth(database.db, projectMeta);
    database.db.pragma('user_version = 36');
    database.close();

    database = createSqliteDatabase(app);
    assert.equal(database.schemaVersion, schemaVersion);
    assert.equal(database.db.pragma('user_version', { simple: true }), schemaVersion);
    for (const tableName of ['technical_plan_meta', projectMeta]) {
      const columns = getColumns(database.db, tableName);
      assert.equal(columns.has('outline_minimum_depth'), true, `${tableName} missing outline_minimum_depth`);
      assert.equal(columns.has('outline_minimum_depth_snapshot'), true, `${tableName} missing outline_minimum_depth_snapshot`);
      const defaults = database.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
      assert.equal(defaults.find((column) => column.name === 'outline_minimum_depth')?.dflt_value, '0');
    }
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
  test('upgrades root and dynamic project meta tables with outline minimum depth columns', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native migration test timed out');
  });
}
