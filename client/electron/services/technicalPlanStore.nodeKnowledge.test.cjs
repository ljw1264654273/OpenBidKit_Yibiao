const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase, createTechnicalPlanProjectSchema } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
    once() {},
  };
}

function createStore(app, db, projectId) {
  return createTechnicalPlanStore({
    app,
    db,
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
    projectId,
  });
}

async function runNodeKnowledgeAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-node-knowledge-'));
  let database;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createStore(app, database.db);
    const outlineData = {
      project_name: '节点知识库测试',
      outline: [
        {
          id: '1',
          title: '父目录',
          description: '父目录说明',
          children: [
            { id: '1.1', title: '子目录', description: '子目录说明', content: '旧子目录正文' },
          ],
        },
        { id: '2', title: '旁支目录', description: '旁支说明', content: '旁支正文' },
      ],
    };

    store.saveOutline({ outlineData, reason: 'replace' });
    store.updateTechnicalPlan({
      contentGenerationSections: {
        '1.1': { id: '1.1', title: '子目录', status: 'success', content: '旧子目录正文' },
        '2': { id: '2', title: '旁支目录', status: 'success', content: '旁支正文' },
      },
      contentGenerationPlans: {
        '1.1': { plan_version: 1, plan: [{ heading: '旧计划' }] },
        '2': { plan_version: 1, plan: [{ heading: '旁支计划' }] },
      },
      contentIllustrationPlan: {
        plan_version: 1,
        revision: 'node-knowledge-before',
        items: [{
          item_id: 'illustration-1',
          kind: 'mermaid',
          image_type: 'process',
          title: '旧配图',
          section_ids: ['1.1'],
          placement: 'after',
          generation: { status: 'success', code: 'flowchart TD\n  A --> B' },
        }],
      },
    });

    const result = store.saveOutlineNodeKnowledge({
      nodeId: '1',
      knowledgeFolderIds: ['folder-a', 'folder-a', '', 'folder-b'],
      knowledgeDocumentIds: ['doc-a', 'doc-a', '', 'doc-b'],
    });

    assert.deepEqual(result.outlineData.outline[0].knowledge_folder_ids, ['folder-a', 'folder-b']);
    assert.deepEqual(result.outlineData.outline[0].knowledge_document_ids, ['doc-a', 'doc-b']);
    assert.equal(result.outlineData.outline[0].children[0].content, undefined);
    assert.equal(result.outlineData.outline[1].content, '旁支正文');
    assert.equal(result.contentGenerationSections['1.1'], undefined);
    assert.equal(result.contentGenerationSections['2'].content, '旁支正文');
    assert.equal(result.contentGenerationPlans['1.1'], undefined);
    assert.deepEqual(result.contentGenerationPlans['2'].plan, [{ heading: '旁支计划' }]);
    assert.equal(result.contentGenerationTask, undefined);
    assert.equal(result.contentGenerationRuntime, undefined);
    assert.equal(result.contentIllustrationPlan, undefined);

    const loaded = store.loadTechnicalPlan();
    assert.deepEqual(loaded.outlineData.outline[0].knowledge_folder_ids, ['folder-a', 'folder-b']);
    assert.deepEqual(loaded.outlineData.outline[0].knowledge_document_ids, ['doc-a', 'doc-b']);
    assert.equal(loaded.outlineData.outline[0].children[0].content, undefined);
    assert.equal(loaded.outlineData.outline[1].content, '旁支正文');

    createTechnicalPlanProjectSchema(database.db, 'project-a');
    const projectStore = createStore(app, database.db, 'project-a');
    projectStore.saveOutline({
      outlineData: {
        project_name: '项目级技术方案',
        outline: [{ id: 'p1', title: '项目节点', description: '' }],
      },
      reason: 'replace',
    });
    projectStore.saveOutlineNodeKnowledge({ nodeId: 'p1', knowledgeFolderIds: ['project-folder'], knowledgeDocumentIds: ['project-doc'] });
    assert.deepEqual(projectStore.loadTechnicalPlan().outlineData.outline[0].knowledge_folder_ids, ['project-folder']);
    assert.deepEqual(projectStore.loadTechnicalPlan().outlineData.outline[0].knowledge_document_ids, ['project-doc']);

    store.updateTechnicalPlan({
      outlineGenerationTask: {
        task_id: 'outline-running',
        type: 'outline-generation',
        status: 'running',
        progress: 50,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    assert.throws(
      () => store.saveOutlineNodeKnowledge({ nodeId: '1', knowledgeFolderIds: ['locked-folder'] }),
      /目录生成任务正在运行/,
    );
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  runNodeKnowledgeAssertions()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('saving outline node knowledge persists folder links and invalidates only affected branch', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native node knowledge test timed out'}`);
  });
}
