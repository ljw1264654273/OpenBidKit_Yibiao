const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createSqliteDatabase, schemaVersion } = require('./sqliteDatabase.cjs');
const { createKnowledgeBaseStore } = require('./knowledgeBaseStore.cjs');
const { createKnowledgeBaseService } = require('./knowledgeBaseService.cjs');
const { getKnowledgeBaseDir } = require('../utils/paths.cjs');

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

function createKnowledgeWorkspace() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-knowledge-contract-'));
  const app = createApp(userDataPath);
  const database = createSqliteDatabase(app);
  const store = createKnowledgeBaseStore({ app, db: database.db });
  return {
    userDataPath,
    app,
    database,
    store,
    close() {
      database.close();
      fs.rmSync(userDataPath, { recursive: true, force: true });
    },
  };
}

function createTestDocument(store, folderId, overrides = {}) {
  return store.createDocument({
    id: overrides.id || 'doc-category-test',
    folder_id: folderId,
    file_name: overrides.file_name || '分类测试文档.md',
    document_dir: overrides.document_dir || `folders/${folderId}/documents/${overrides.id || 'doc-category-test'}`,
    source_path: overrides.source_path || `folders/${folderId}/documents/${overrides.id || 'doc-category-test'}/source.md`,
    markdown_path: overrides.markdown_path || `folders/${folderId}/documents/${overrides.id || 'doc-category-test'}/content.md`,
    status: overrides.status || 'success',
    progress: overrides.progress ?? 100,
    message: overrides.message || '整理完成',
    ...overrides,
  });
}

function assertCategoryAwareStoreContracts() {
  const workspace = createKnowledgeWorkspace();
  try {
    const documentFolder = workspace.store.createFolder('文档文件夹');
    const enterpriseFolder = workspace.store.createFolder('企业文件夹', 'enterprise');
    const document = createTestDocument(workspace.store, documentFolder.id);
    workspace.store.saveMatchResult(document.id, {
      candidateItems: [{ id: 'candidate-1', title: '候选条目', summary: '候选摘要' }],
      finalItems: [{
        id: 'item-1',
        title: '保留条目',
        resume: '保留摘要',
        content: '保留正文',
      }],
      matchResult: {},
      report: null,
    });
    workspace.store.saveDocumentStep(document.id, 'save_result', { status: 'success' });
    workspace.store.saveMatchBatch(document.id, 0, { status: 'success', itemIds: ['item-1'], matches: [] });

    const defaultIndex = workspace.store.list();
    assert.deepEqual(defaultIndex.folders.map((folder) => folder.knowledge_base_id), ['document']);
    assert.deepEqual(defaultIndex.documents.map((item) => item.knowledge_base_id), ['document']);

    const enterpriseIndex = workspace.store.list({ knowledgeBaseId: 'enterprise' });
    assert.deepEqual(enterpriseIndex.folders.map((folder) => folder.id), [enterpriseFolder.id]);
    assert.deepEqual(enterpriseIndex.documents, []);

    const allIndex = workspace.store.list({ allKnowledgeBases: true });
    assert.deepEqual(
      [...new Set(allIndex.folders.map((folder) => folder.knowledge_base_id))].sort(),
      ['document', 'enterprise'],
    );

    const moved = workspace.store.moveDocument(document.id, enterpriseFolder.id);
    assert.equal(moved.id, document.id);
    assert.equal(moved.folder_id, enterpriseFolder.id);
    assert.equal(moved.knowledge_base_id, 'enterprise');
    assert.deepEqual(workspace.store.readItems(document.id), [{
      id: 'item-1',
      title: '保留条目',
      resume: '保留摘要',
      content: '保留正文',
      source_block_ids: [],
      source_file: undefined,
    }]);
    assert.equal(
      workspace.database.db.prepare('SELECT COUNT(*) AS count FROM knowledge_document_steps WHERE document_id = ?').get(document.id).count,
      1,
    );
    assert.equal(
      workspace.database.db.prepare('SELECT COUNT(*) AS count FROM knowledge_match_batches WHERE document_id = ?').get(document.id).count,
      1,
    );
    assert.equal(workspace.store.updateDocument(document.id, { message: '跨库后仍可更新' }).knowledge_base_id, 'enterprise');
    assert.deepEqual(
      workspace.store.list({ knowledgeBaseId: 'enterprise' }).documents.map((item) => [item.id, item.knowledge_base_id]),
      [[document.id, 'enterprise']],
    );
  } finally {
    workspace.close();
  }
}

function assertServiceRejectsInvalidMoves() {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-knowledge-move-contract-'));
  try {
    const document = {
      id: 'doc-processing',
      folder_id: 'folder-source',
      file_name: '处理中.md',
      document_dir: 'folders/folder-source/documents/doc-processing',
      source_path: 'folders/folder-source/documents/doc-processing/source.md',
      markdown_path: 'folders/folder-source/documents/doc-processing/content.md',
      status: 'converting',
    };
    const folders = [
      { id: 'folder-source', name: '源文件夹', knowledge_base_id: 'document' },
      { id: 'folder-target', name: '目标文件夹', knowledge_base_id: 'enterprise' },
    ];
    const store = {
      recoverInterruptedDocuments() {
        return [];
      },
      getDocument(documentId) {
        if (documentId !== document.id) throw new Error('知识库文档不存在');
        return document;
      },
      list() {
        return { folders, documents: [document] };
      },
      moveDocument() {
        throw new Error('不应调用 Store 移动');
      },
    };
    const service = createKnowledgeBaseService({
      app: createApp(tempUserData),
      configStore: { load: () => ({}) },
      knowledgeBaseStore: store,
    });

    assert.throws(
      () => service.moveDocument(document.id, 'folder-target'),
      /正在处理中/,
    );

    document.status = 'success';
    assert.throws(
      () => service.moveDocument(document.id, 'folder-missing'),
      /目标知识库文件夹不存在/,
    );
  } finally {
    fs.rmSync(tempUserData, { recursive: true, force: true });
  }
}

function assertServiceMovesAcrossCategoriesAndEmitsContext() {
  const workspace = createKnowledgeWorkspace();
  try {
    const sourceFolder = workspace.store.createFolder('源文件夹');
    const targetFolder = workspace.store.createFolder('目标文件夹', 'enterprise');
    const document = createTestDocument(workspace.store, sourceFolder.id, {
      id: 'doc-cross-category',
      document_dir: `folders/${sourceFolder.id}/documents/doc-cross-category`,
      source_path: `folders/${sourceFolder.id}/documents/doc-cross-category/source.md`,
      markdown_path: `folders/${sourceFolder.id}/documents/doc-cross-category/content.md`,
    });
    workspace.store.saveMatchResult(document.id, {
      finalItems: [{ id: 'item-cross', title: '跨库条目', resume: '摘要', content: '正文' }],
      candidateItems: [],
      matchResult: {},
      report: null,
    });
    const oldDir = path.join(getKnowledgeBaseDir(workspace.app), document.document_dir);
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'source.md'), 'source', 'utf8');
    fs.writeFileSync(path.join(oldDir, 'content.md'), '# content', 'utf8');

    const events = [];
    const service = createKnowledgeBaseService({
      app: workspace.app,
      configStore: { load: () => ({}) },
      knowledgeBaseStore: workspace.store,
    });
    const movedResult = service.moveDocument(
      document.id,
      targetFolder.id,
      null,
      'after',
      {
        isDestroyed: () => false,
        send: (channel, payload) => events.push({ channel, payload }),
      },
    );
    const movedDocument = movedResult.document;
    const expectedDocumentDir = `folders/${targetFolder.id}/documents/${document.id}`;

    assert.equal(movedDocument.id, document.id);
    assert.equal(movedDocument.knowledge_base_id, 'enterprise');
    assert.equal(movedDocument.document_dir, expectedDocumentDir);
    assert.equal(fs.existsSync(path.join(getKnowledgeBaseDir(workspace.app), expectedDocumentDir)), true);
    assert.equal(fs.existsSync(oldDir), false);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      channel: 'knowledge-base:event',
      payload: {
        document: movedDocument,
        previousFolderId: sourceFolder.id,
        previousKnowledgeBaseId: 'document',
      },
    });
    assert.deepEqual(workspace.store.readItems(document.id), [{
      id: 'item-cross',
      title: '跨库条目',
      resume: '摘要',
      content: '正文',
      source_block_ids: [],
      source_file: undefined,
    }]);
  } finally {
    workspace.close();
  }
}

function runNativeAssertions() {
  assertKnowledgeFolderCategoryMigration(31);
  assertKnowledgeFolderCategoryMigration(schemaVersion);
  assertKnowledgeBaseCatalog();
  assertCategoryAwareStoreContracts();
  assertServiceRejectsInvalidMoves();
  assertServiceMovesAcrossCategoriesAndEmitsContext();
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
