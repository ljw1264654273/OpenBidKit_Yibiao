const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');

const variantColumns = [
  'derived_from_project_id',
  'uniqueness_status',
  'uniqueness_result_id',
  'uniqueness_attempts',
  'uniqueness_auto_run_requested',
];

for (const previousSchema of ['knowledge-region', 'derived-bid']) {
  test(`upgrades the ${previousSchema} v34 database without losing existing data`, () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-variant-migration-'));
    const app = {
      getPath: () => userDataPath,
      once() {},
    };
    let database;
    try {
      database = createSqliteDatabase(app);
      const db = database.db;
      db.prepare(`
        INSERT INTO knowledge_folders (folder_id, name, province, city, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('folder', '城市资料', '广东省', '广州市', '2026-09-28', '2026-09-28');
      db.prepare(`
        INSERT INTO bid_projects (
          project_id, project_name, derived_from_project_id, uniqueness_status,
          uniqueness_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('variant', '第二份标书', 'source', 'passed', 2, '2026-09-28', '2026-09-28');

      if (previousSchema === 'knowledge-region') {
        for (const column of variantColumns) {
          db.exec(`ALTER TABLE bid_projects DROP COLUMN ${column}`);
        }
      } else {
        db.exec('ALTER TABLE knowledge_folders DROP COLUMN province; ALTER TABLE knowledge_folders DROP COLUMN city;');
      }
      db.pragma('user_version = 34');
      database.close();

      database = createSqliteDatabase(app);
      assert.equal(database.schemaVersion, 35);
      assert.equal(database.db.pragma('user_version', { simple: true }), 35);
      assert.deepEqual(
        database.db.prepare('SELECT name, province, city FROM knowledge_folders WHERE folder_id = ?').get('folder'),
        {
          name: '城市资料',
          province: previousSchema === 'knowledge-region' ? '广东省' : null,
          city: previousSchema === 'knowledge-region' ? '广州市' : null,
        },
      );
      assert.deepEqual(
        database.db.prepare(`
          SELECT project_name, derived_from_project_id, uniqueness_status,
            uniqueness_attempts, uniqueness_auto_run_requested, uniqueness_result_id
          FROM bid_projects WHERE project_id = ?
        `).get('variant'),
        {
          project_name: '第二份标书',
          derived_from_project_id: previousSchema === 'derived-bid' ? 'source' : null,
          uniqueness_status: previousSchema === 'derived-bid' ? 'passed' : 'none',
          uniqueness_attempts: previousSchema === 'derived-bid' ? 2 : 0,
          uniqueness_auto_run_requested: 0,
          uniqueness_result_id: null,
        },
      );
      database.close();
      database = createSqliteDatabase(app);
      assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM bid_projects').get().count, 1);
    } finally {
      database?.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
}
