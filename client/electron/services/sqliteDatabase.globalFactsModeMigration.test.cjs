const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function rebuildMetaTableWithLegacyDefault(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  assert.ok(row?.sql, `Expected ${tableName} to exist`);
  const currentDefinition = "global_facts_mode TEXT NOT NULL DEFAULT 'omit'";
  const legacyDefinition = "global_facts_mode TEXT NOT NULL DEFAULT 'fabricate'";
  assert.match(row.sql, new RegExp(currentDefinition));
  db.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
  db.exec(row.sql.replace(currentDefinition, legacyDefinition));
}

function insertLegacyMeta(db, tableName, values) {
  db.prepare(`
    INSERT INTO ${quoteIdentifier(tableName)} (
      id, step, tender_file_name, global_facts_mode, outline_project_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    values.step,
    values.tenderFileName,
    values.globalFactsMode,
    values.outlineProjectName,
    '2026-09-28',
    '2026-09-28',
  );
}

function getGlobalFactsDefault(db, tableName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all()
    .find((column) => column.name === 'global_facts_mode')?.dflt_value;
}

function runMigrationAssertions() {
  const {
    createSqliteDatabase,
    createTechnicalPlanProjectSchema,
    getTechnicalPlanProjectTablePrefix,
  } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-global-facts-mode-migration-'));
  const freshUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-global-facts-mode-fresh-'));
  const app = {
    getPath: () => userDataPath,
    once() {},
  };
  let database;
  let freshDatabase;
  try {
    database = createSqliteDatabase(app);
    const db = database.db;
    const fabricateProjectId = 'legacy-fabricate';
    const placeholderProjectId = 'legacy-placeholder';
    const fabricateProjectMeta = `${getTechnicalPlanProjectTablePrefix(fabricateProjectId)}meta`;
    const placeholderProjectMeta = `${getTechnicalPlanProjectTablePrefix(placeholderProjectId)}meta`;
    createTechnicalPlanProjectSchema(db, fabricateProjectId);
    createTechnicalPlanProjectSchema(db, placeholderProjectId);
    for (const tableName of ['technical_plan_meta', fabricateProjectMeta, placeholderProjectMeta]) {
      rebuildMetaTableWithLegacyDefault(db, tableName);
    }
    insertLegacyMeta(db, 'technical_plan_meta', {
      step: 'outline',
      tenderFileName: '保留的招标文件.docx',
      globalFactsMode: 'fabricate',
      outlineProjectName: '保留的单例项目',
    });
    insertLegacyMeta(db, fabricateProjectMeta, {
      step: 'global-facts',
      tenderFileName: '项目级旧招标文件.docx',
      globalFactsMode: 'fabricate',
      outlineProjectName: '保留的项目级名称',
    });
    insertLegacyMeta(db, placeholderProjectMeta, {
      step: 'global-facts',
      tenderFileName: '严谨模式项目.docx',
      globalFactsMode: 'placeholder',
      outlineProjectName: '保留的严谨模式项目',
    });
    database.db.pragma('user_version = 35');
    database.close();

    database = createSqliteDatabase(app);
    assert.deepEqual(
      {
        schemaVersion: database.schemaVersion,
        userVersion: database.db.pragma('user_version', { simple: true }),
        ...database.db.prepare(`
          SELECT step, tender_file_name, outline_project_name, global_facts_mode
          FROM technical_plan_meta
          WHERE id = 1
        `).get(),
      },
      {
        schemaVersion: 37,
        userVersion: 37,
        step: 'outline',
        tender_file_name: '保留的招标文件.docx',
        outline_project_name: '保留的单例项目',
        global_facts_mode: 'omit',
      },
    );
    assert.deepEqual(
      database.db.prepare(`
        SELECT step, tender_file_name, outline_project_name, global_facts_mode
        FROM ${quoteIdentifier(fabricateProjectMeta)}
        WHERE id = 1
      `).get(),
      {
        step: 'global-facts',
        tender_file_name: '项目级旧招标文件.docx',
        outline_project_name: '保留的项目级名称',
        global_facts_mode: 'omit',
      },
    );
    assert.deepEqual(
      database.db.prepare(`
        SELECT tender_file_name, outline_project_name, global_facts_mode
        FROM ${quoteIdentifier(placeholderProjectMeta)}
        WHERE id = 1
      `).get(),
      {
        tender_file_name: '严谨模式项目.docx',
        outline_project_name: '保留的严谨模式项目',
        global_facts_mode: 'placeholder',
      },
    );

    // v36 仅迁移已存值，不为修改历史 DDL 默认值而重建表；Store 会显式写入 omit。
    assert.equal(getGlobalFactsDefault(database.db, 'technical_plan_meta'), "'fabricate'");
    assert.equal(getGlobalFactsDefault(database.db, fabricateProjectMeta), "'fabricate'");

    database.close();
    database = createSqliteDatabase(app);
    assert.equal(database.db.pragma('user_version', { simple: true }), 37);
    assert.equal(
      database.db.prepare(`SELECT global_facts_mode FROM ${quoteIdentifier(fabricateProjectMeta)} WHERE id = 1`).get()
        .global_facts_mode,
      'omit',
    );
    assert.equal(
      database.db.prepare(`SELECT global_facts_mode FROM ${quoteIdentifier(placeholderProjectMeta)} WHERE id = 1`).get()
        .global_facts_mode,
      'placeholder',
    );

    freshDatabase = createSqliteDatabase({
      getPath: () => freshUserDataPath,
      once() {},
    });
    const freshProjectMeta = `${getTechnicalPlanProjectTablePrefix('fresh-default')}meta`;
    createTechnicalPlanProjectSchema(freshDatabase.db, 'fresh-default');
    assert.equal(getGlobalFactsDefault(freshDatabase.db, 'technical_plan_meta'), "'omit'");
    assert.equal(getGlobalFactsDefault(freshDatabase.db, freshProjectMeta), "'omit'");
  } finally {
    database?.close();
    freshDatabase?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.rmSync(freshUserDataPath, { recursive: true, force: true });
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
