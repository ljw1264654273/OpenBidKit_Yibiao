const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function createApp(userDataPath) {
  return {
    getPath: () => userDataPath,
    once() {},
  };
}

function getObjectNames(db, type) {
  return new Set(db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type).map((row) => row.name));
}

function assertTechnicalPlanCheckSchema(db) {
  const tables = getObjectNames(db, 'table');
  assert.ok(tables.has('technical_plan_check_meta'));
  assert.ok(tables.has('technical_plan_check_tasks'));
  const taskColumns = db.prepare('PRAGMA table_info(technical_plan_check_tasks)').all().map((row) => row.name);
  assert.deepEqual(taskColumns, [
    'type',
    'task_id',
    'status',
    'progress',
    'stats_json',
    'error',
    'started_at',
    'updated_at',
  ]);
  const triggers = getObjectNames(db, 'trigger');
  assert.ok(triggers.has('trg_technical_plan_check_task_logs_delete'));
  assert.ok(triggers.has('trg_technical_plan_check_task_logs_replace'));
}

function runMigrationAssertions(previousVersion) {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-technical-plan-check-migration-'));
  let database;
  try {
    database = createSqliteDatabase(createApp(userDataPath));
    database.db.prepare(`
      INSERT INTO duplicate_check_meta (id, step, active_analysis_tab, current_signature, created_at, updated_at)
      VALUES (1, 'analysis', 'outline', 'legacy-data', '2026-09-28', '2026-09-28')
    `).run();
    database.db.prepare(`
      INSERT INTO technical_plan_meta (id, outline_minimum_depth, outline_minimum_depth_snapshot, created_at, updated_at)
      VALUES (1, 4, 3, '2026-09-28', '2026-09-28')
    `).run();
    database.db.exec(`
      DROP TABLE technical_plan_check_tasks;
      DROP TABLE technical_plan_check_meta;
    `);
    database.db.pragma(`user_version = ${previousVersion}`);
    database.close();

    database = createSqliteDatabase(createApp(userDataPath));
    assert.equal(database.schemaVersion, 38);
    assert.equal(database.db.pragma('user_version', { simple: true }), 38);
    assertTechnicalPlanCheckSchema(database.db);
    assert.deepEqual(
      database.db.prepare('SELECT outline_minimum_depth, outline_minimum_depth_snapshot FROM technical_plan_meta WHERE id = 1').get(),
      { outline_minimum_depth: 4, outline_minimum_depth_snapshot: 3 },
    );
    assert.deepEqual(
      database.db.prepare(`
        SELECT step, active_analysis_tab, current_signature
        FROM duplicate_check_meta
        WHERE id = 1
      `).get(),
      {
        step: 'analysis',
        active_analysis_tab: 'outline',
        current_signature: 'legacy-data',
      },
    );

    database.close();
    database = createSqliteDatabase(createApp(userDataPath));
    assert.equal(database.db.pragma('user_version', { simple: true }), 38);
    assertTechnicalPlanCheckSchema(database.db);

    database.db.exec(`
      DROP TRIGGER trg_technical_plan_check_task_logs_delete;
      DROP TRIGGER trg_technical_plan_check_task_logs_replace;
    `);
    database.close();
    database = createSqliteDatabase(createApp(userDataPath));
    assertTechnicalPlanCheckSchema(database.db);

    database.db.prepare(`
      INSERT INTO technical_plan_check_tasks (
        type, task_id, status, progress, stats_json, error, started_at, updated_at
      ) VALUES ('technical-plan-check', 'delete-me', 'running', 10, NULL, NULL, '2026-09-29', '2026-09-29')
    `).run();
    database.db.prepare(`
      INSERT INTO task_logs (task_domain, task_type, task_id, message, created_at)
      VALUES ('technical-plan-check', 'technical-plan-check', 'delete-me', '旧日志', '2026-09-29')
    `).run();
    database.db.prepare("DELETE FROM technical_plan_check_tasks WHERE type = 'technical-plan-check'").run();
    assert.equal(
      database.db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_id = 'delete-me'").get().count,
      0,
    );

    database.db.prepare(`
      INSERT INTO technical_plan_check_tasks (
        type, task_id, status, progress, stats_json, error, started_at, updated_at
      ) VALUES ('technical-plan-check', 'replace-me', 'running', 10, NULL, NULL, '2026-09-29', '2026-09-29')
    `).run();
    database.db.prepare(`
      INSERT INTO task_logs (task_domain, task_type, task_id, message, created_at)
      VALUES ('technical-plan-check', 'technical-plan-check', 'replace-me', '待清理日志', '2026-09-29')
    `).run();
    database.db.prepare(`
      UPDATE technical_plan_check_tasks
      SET task_id = 'replacement', updated_at = '2026-09-29T02:00:00.000Z'
      WHERE type = 'technical-plan-check'
    `).run();
    assert.equal(
      database.db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_id = 'replace-me'").get().count,
      0,
    );

    database.db.exec(`
      DROP TABLE technical_plan_check_tasks;
      DROP TABLE technical_plan_check_meta;
    `);
    database.close();
    database = createSqliteDatabase(createApp(userDataPath));
    assert.equal(database.db.pragma('user_version', { simple: true }), 38);
    assertTechnicalPlanCheckSchema(database.db);
    assert.equal(
      database.db.prepare('SELECT current_signature FROM duplicate_check_meta WHERE id = 1').get().current_signature,
      'legacy-data',
    );
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try {
    runMigrationAssertions(Number(process.argv.at(-1)));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  for (const previousVersion of [36, 37]) {
    test(`upgrades v${previousVersion} to v38 and repairs technical plan check schema idempotently`, () => {
      const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native', String(previousVersion)], {
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native migration test timed out');
    });
  }
}
