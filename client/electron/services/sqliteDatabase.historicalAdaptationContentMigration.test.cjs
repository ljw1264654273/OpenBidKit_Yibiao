const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function rebuildWithoutContentColumns(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  const legacySql = row.sql
    .replace(/,?\s*historical_adaptation_content_items_json TEXT/gi, '')
    .replace(/,?\s*historical_adaptation_content_confirmed_at TEXT/gi, '')
    .replace(/,?\s*historical_adaptation_content_check_json TEXT/gi, '');
  db.exec(`DROP TABLE ${quoteIdentifier(tableName)}`);
  db.exec(legacySql);
}

function runAssertions() {
  const { createSqliteDatabase, createTechnicalPlanProjectSchema, getTechnicalPlanProjectTablePrefix, schemaVersion } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-adaptation-content-migration-'));
  const app = { getPath: () => userDataPath, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const projectMeta = `${getTechnicalPlanProjectTablePrefix('legacy-adaptation-content')}meta`;
    createTechnicalPlanProjectSchema(database.db, 'legacy-adaptation-content');
    rebuildWithoutContentColumns(database.db, 'technical_plan_meta');
    rebuildWithoutContentColumns(database.db, projectMeta);
    database.db.pragma('user_version = 40');
    database.close();

    database = createSqliteDatabase(app);
    assert.equal(schemaVersion, 47);
    database.db.exec('DROP TABLE historical_adaptation_content_check_cache');
    database.db.pragma('user_version = 46');
    database.close();
    database = createSqliteDatabase(app);
    assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE name = 'historical_adaptation_content_check_cache'").get());
    database.db.exec('DROP TABLE historical_adaptation_content_check_cache');
    database.close();
    database = createSqliteDatabase(app);
    assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE name = 'historical_adaptation_content_check_cache'").get(), 'current-version health repair recreates missing cache');
    for (const tableName of ['technical_plan_meta', projectMeta]) {
      const columns = new Set(database.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((row) => row.name));
      assert.equal(columns.has('historical_adaptation_content_items_json'), true);
      assert.equal(columns.has('historical_adaptation_content_confirmed_at'), true);
      assert.equal(columns.has('historical_adaptation_content_check_json'), true);
      assert.equal(columns.has('content_items_storage_version'), true);
    }
    const tables = new Set(database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    assert.ok(tables.has('technical_plan_historical_content_items'));
    assert.ok(tables.has('technical_plan_historical_source_versions'));
    // Explicitly exercise the v44 -> v45 batch-table migration path.
    database.db.exec('DROP TABLE historical_adaptation_content_check_batches');
    database.db.pragma('user_version = 44');
    database.close();
    database = createSqliteDatabase(app);
    assert.ok(database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'historical_adaptation_content_check_batches'").get());
    const legacyItems = [{ node_id: 'chapter-1', manual_mode: 'rewrite', manual_instruction: '保留人工要求', content_origin: 'manual', status: 'success' }];
    database.db.prepare(`INSERT OR REPLACE INTO ${quoteIdentifier(projectMeta)} (id, created_at, updated_at, historical_adaptation_content_items_json, content_items_storage_version) VALUES (1, 'before', 'before', ?, 0)`).run(JSON.stringify(legacyItems));
    database.db.pragma('user_version = 43');
    database.close();
    database = createSqliteDatabase(app);
    const imported = database.db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE node_id = ?').get('chapter-1');
    assert.equal(JSON.parse(imported.item_json).manual_instruction, '保留人工要求');
    assert.equal(JSON.parse(imported.item_json).content_origin, 'manual');
    assert.equal(database.db.prepare(`SELECT content_items_storage_version FROM ${quoteIdentifier(projectMeta)}`).get().content_items_storage_version, 1);
    database.db.prepare('UPDATE technical_plan_historical_content_items SET item_json = ? WHERE node_id = ?').run(JSON.stringify({ ...legacyItems[0], manual_instruction: 'new authority' }), 'chapter-1');
    database.close();
    database = createSqliteDatabase(app);
    assert.equal(JSON.parse(database.db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE node_id = ?').get('chapter-1').item_json).manual_instruction, 'new authority');

    const prefix = getTechnicalPlanProjectTablePrefix('legacy-adaptation-content');
    database.db.prepare("INSERT INTO bid_projects (project_id, project_name, created_at, updated_at) VALUES (?, ?, 'before', 'before')")
      .run('legacy-adaptation-content', '升级测试项目');
    const unsafeDifference = { id: 'legacy-location', decision: 'confirmed', category: '名称地点替换',
      title: '旧地点', historical_excerpt: '五峰村', tender_requirement: '横泾街道', action: '替换' };
    const legacyState = [legacyItems[0], { node_id: 'automatic', status: 'success', content_origin: 'migrated' }];
    database.db.prepare(`UPDATE ${quoteIdentifier(projectMeta)} SET content_items_storage_version = 0,
      historical_adaptation_content_items_json = ?, historical_adaptation_differences_json = ?,
      historical_adaptation_difference_confirmed_at = 'before', historical_adaptation_outline_confirmed_at = 'before',
      historical_adaptation_outline_changes_json = '[{}]', historical_adaptation_content_confirmed_at = 'before',
      historical_adaptation_content_check_json = '{}', historical_adaptation_review_findings_json = '[{}]',
      historical_adaptation_review_confirmed_at = 'before' WHERE id = 1`).run(JSON.stringify(legacyState), JSON.stringify([unsafeDifference]));
    database.db.prepare('DELETE FROM technical_plan_historical_content_items WHERE project_id = ?').run('legacy_adaptation_content');
    for (const nodeId of ['chapter-1', 'automatic']) {
      database.db.prepare(`INSERT INTO ${quoteIdentifier(`${prefix}outline_nodes`)}
        (node_id, sort_order, level, title, content, created_at, updated_at) VALUES (?, 0, 1, ?, ?, 'before', 'before')`)
        .run(nodeId, nodeId, nodeId === 'chapter-1' ? '人工正文保持不变' : '自动正文仍保留');
      database.db.prepare(`INSERT INTO ${quoteIdentifier(`${prefix}content_plans`)} (node_id, plan_json, updated_at) VALUES (?, '{}', 'before')`).run(nodeId);
    }
    database.db.prepare(`INSERT INTO ${quoteIdentifier(`${prefix}tasks`)} (type, task_id, status, started_at, updated_at)
      VALUES ('historical-adaptation-content', 'legacy-running', 'running', 'before', 'before')`).run();
    database.db.prepare("INSERT OR REPLACE INTO technical_plan_meta (id, created_at, updated_at, content_items_storage_version, historical_adaptation_content_items_json) VALUES (1, 'before', 'before', 0, ?)")
      .run(JSON.stringify([{ ...legacyItems[0], manual_instruction: '根项目独立策略' }]));
    database.db.pragma('user_version = 43');
    database.close();
    database = createSqliteDatabase(app);
    const migratedMeta = database.db.prepare(`SELECT * FROM ${quoteIdentifier(projectMeta)} WHERE id = 1`).get();
    assert.equal(JSON.parse(migratedMeta.historical_adaptation_differences_json)[0].decision, 'pending');
    for (const key of ['historical_adaptation_difference_confirmed_at', 'historical_adaptation_outline_confirmed_at',
      'historical_adaptation_outline_changes_json', 'historical_adaptation_content_confirmed_at',
      'historical_adaptation_content_check_json', 'historical_adaptation_review_findings_json', 'historical_adaptation_review_confirmed_at']) {
      assert.equal(migratedMeta[key], null, `incompatible upgrade must invalidate ${key}`);
    }
    assert.equal(database.db.prepare(`SELECT count(*) AS count FROM ${quoteIdentifier(`${prefix}content_plans`)}`).get().count, 0,
      'incompatible downstream content plans must be cleared, without deleting chapter bodies');
    assert.equal(database.db.prepare(`SELECT content FROM ${quoteIdentifier(`${prefix}outline_nodes`)} WHERE node_id = 'chapter-1'`).get().content, '人工正文保持不变');
    const upgradedTask = database.db.prepare(`SELECT * FROM ${quoteIdentifier(`${prefix}tasks`)}`).get();
    assert.equal(upgradedTask.status, 'error');
    assert.match(upgradedTask.error, /升级中断/);
    const getItem = (projectId, nodeId) => JSON.parse(database.db.prepare('SELECT item_json FROM technical_plan_historical_content_items WHERE project_id = ? AND node_id = ?').get(projectId, nodeId).item_json);
    assert.equal(getItem('legacy-adaptation-content', 'chapter-1').status, 'success');
    assert.equal(getItem('legacy-adaptation-content', 'automatic').status, 'stale');
    assert.equal(getItem('', 'chapter-1').manual_instruction, '根项目独立策略');

    // A later project failure must roll back earlier project imports and completion markers.
    database.db.prepare('DELETE FROM technical_plan_historical_content_items').run();
    database.db.prepare('UPDATE technical_plan_meta SET content_items_storage_version = 0 WHERE id = 1').run();
    database.db.prepare(`UPDATE ${quoteIdentifier(projectMeta)} SET content_items_storage_version = 0, historical_adaptation_content_items_json = 'invalid-json' WHERE id = 1`).run();
    database.db.pragma('user_version = 43');
    const databasePath = database.path;
    database.close();
    database = undefined;
    assert.throws(() => createSqliteDatabase(app), /数据库升级失败/);
    const rollbackDb = new (require('better-sqlite3'))(databasePath, { readonly: true });
    try {
      assert.equal(rollbackDb.pragma('user_version', { simple: true }), 43);
      assert.equal(rollbackDb.prepare('SELECT content_items_storage_version FROM technical_plan_meta WHERE id = 1').get().content_items_storage_version, 0);
      assert.equal(rollbackDb.prepare('SELECT count(*) AS count FROM technical_plan_historical_content_items').get().count, 0);
    } finally { rollbackDb.close(); }
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('upgrades root and project meta tables with historical content adaptation columns', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native migration test timed out');
  });
}
