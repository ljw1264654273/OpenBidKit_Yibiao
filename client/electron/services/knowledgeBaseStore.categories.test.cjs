const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createSqliteDatabase, schemaVersion } = require('./sqliteDatabase.cjs');
const { createKnowledgeBaseStore } = require('./knowledgeBaseStore.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createLegacyDatabase(userDataPath, version) {
  const databasePath = path.join(userDataPath, 'workspace', 'yibiao.sqlite');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE knowledge_folders (
      folder_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO knowledge_folders (folder_id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('folder-b', '第二个文件夹', 1, '2026-09-20T00:00:02.000Z', '2026-09-20T00:00:02.000Z');
  db.prepare(`
    INSERT INTO knowledge_folders (folder_id, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run('folder-a', '第一个文件夹', 0, '2026-09-20T00:00:01.000Z', '2026-09-20T00:00:01.000Z');
  db.pragma(`user_version = ${version}`);
  db.close();
}

function assertKnowledgeFolderCategoryMigration(initialVersion) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-knowledge-category-'));
  let database;
  try {
    createLegacyDatabase(userDataPath, initialVersion);
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const columns = database.db.prepare('PRAGMA table_info(knowledge_folders)').all();
    const categoryColumn = columns.find((column) => column.name === 'knowledge_base_id');

    assert.ok(categoryColumn);
    assert.equal(categoryColumn.dflt_value, "'document'");
    assert.deepEqual(
      database.db.prepare(`
        SELECT folder_id, knowledge_base_id
        FROM knowledge_folders
        ORDER BY sort_order ASC, created_at ASC
      `).all(),
      [
        { folder_id: 'folder-a', knowledge_base_id: 'document' },
        { folder_id: 'folder-b', knowledge_base_id: 'document' },
      ],
    );

    const categoryIndex = database.db.prepare('PRAGMA index_list(knowledge_folders)').all()
      .find((index) => index.name === 'idx_knowledge_folders_category_order');
    assert.ok(categoryIndex);
    assert.deepEqual(
      database.db.prepare(`PRAGMA index_info("${categoryIndex.name}")`).all().map((column) => column.name),
      ['knowledge_base_id', 'sort_order', 'created_at'],
    );

    const store = createKnowledgeBaseStore({ app, db: database.db });
    const createdFolder = store.createFolder('新文件夹');
    assert.equal(
      database.db.prepare('SELECT knowledge_base_id FROM knowledge_folders WHERE folder_id = ?').get(createdFolder.id).knowledge_base_id,
      'document',
    );
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

function loadKnowledgeBaseCatalog() {
  const catalogPath = path.join(__dirname, '../../src/features/knowledge-base/knowledgeBaseCatalog.ts');
  const source = fs.readFileSync(catalogPath, 'utf8');
  const typescript = require('typescript');
  const output = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'require', 'module', output)(module.exports, require, module);
  return module.exports;
}

function assertKnowledgeBaseCatalog() {
  const catalog = loadKnowledgeBaseCatalog();
  assert.deepEqual(
    catalog.KNOWLEDGE_BASE_CATALOG.map((item) => [item.id, item.label, item.navigationId]),
    [
      ['document', '文档知识库', 'document-knowledge-base'],
      ['national-standard', '国标知识库', 'national-standard-knowledge-base'],
      ['provincial-standard', '省标知识库', 'provincial-standard-knowledge-base'],
      ['municipal-standard', '市标知识库', 'municipal-standard-knowledge-base'],
      ['industry-standard', '行业标知识库', 'industry-standard-knowledge-base'],
      ['enterprise', '企业知识库', 'enterprise-knowledge-base'],
    ],
  );
  assert.equal(catalog.getKnowledgeBaseCatalogItem('document').navigationId, 'document-knowledge-base');
  assert.equal(
    catalog.getKnowledgeBaseCatalogItemByNavigationId('enterprise-knowledge-base').id,
    'enterprise',
  );
  assert.equal(catalog.getKnowledgeBaseIdByNavigationId('missing-navigation'), undefined);
}

function runNativeAssertions() {
  assertKnowledgeFolderCategoryMigration(31);
  assertKnowledgeFolderCategoryMigration(schemaVersion);
  assertKnowledgeBaseCatalog();
}

if (process.argv.includes('--electron-native')) {
  try {
    runNativeAssertions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  test('migrates and repairs legacy knowledge folders into the document catalog', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native knowledge category test timed out'}`);
  });
}
