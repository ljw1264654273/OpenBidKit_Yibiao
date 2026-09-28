const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBidProjectManager } = require('./bidProjectManager.cjs');
const { getTechnicalPlanProjectTablePrefix } = require('./sqliteDatabase.cjs');

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-bid-manager-'));
  const db = new Database(':memory:');
  const manager = createBidProjectManager({
    app: { getPath: () => root },
    db,
    fileService: {},
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {}, normalizeLogs: (logs) => logs || [] },
    configStore: { load: () => ({}) },
  });
  return { root, db, manager };
}

test('lists project index without initializing every technical-plan schema', () => {
  const { root, db, manager } = createHarness();
  try {
    const source = manager.createProject({
      projectName: '第一份标书',
      sourceFile: { fileName: '招标文件.docx', contentHash: 'content-hash' },
    });
    const derived = manager.createProject({
      projectName: '第二份标书',
      sourceFile: { fileName: '招标文件.docx', contentHash: 'content-hash' },
      sourceGroupId: source.sourceGroupId,
      derivedFromProjectId: source.projectId,
    });
    manager.updateProject(derived.projectId, {
      status: 'completed',
      uniquenessStatus: 'passed',
    });

    const sourceOutlineTable = `${getTechnicalPlanProjectTablePrefix(source.projectId)}outline_nodes`;
    db.prepare(`DROP TABLE "${sourceOutlineTable}"`).run();
    assert.equal(db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?',
    ).get(sourceOutlineTable), undefined);

    const listed = manager.listProjects();

    assert.equal(listed.length, 2);
    assert.equal(db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type = \'table\' AND name = ?',
    ).get(sourceOutlineTable), undefined);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
