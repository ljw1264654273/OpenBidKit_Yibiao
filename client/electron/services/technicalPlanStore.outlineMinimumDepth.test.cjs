const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

function createApp(userDataPath) {
  return { getPath: () => userDataPath, once() {} };
}

function createStore(app, db) {
  return createTechnicalPlanStore({
    app,
    db,
    fileService: {
      async importDocument() {
        return {
          success: true,
          file_content: '# 招标文件\n技术要求正文。',
          file_name: '测试招标文件.md',
          parser_label: '本地解析',
        };
      },
    },
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

function outlineConfig(minimumDepth) {
  return {
    referenceKnowledgeDocumentIds: [],
    remoteKnowledgeScopes: [],
    outlineMode: 'standalone-technical',
    outlineExpansionMode: 'ai-complement',
    wordControlOptions: { minimumWords: 40000, maximumWords: 50000, sectionWords: 1800, strictSectionWords: false },
    minimumDepth,
  };
}

async function runAssertions() {
  const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-outline-depth-store-'));
  const derivedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-outline-depth-derived-'));
  let sourceDatabase;
  let derivedDatabase;
  try {
    const sourceApp = createApp(sourcePath);
    sourceDatabase = createSqliteDatabase(sourceApp);
    const sourceStore = createStore(sourceApp, sourceDatabase.db);

    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepth, 0);
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepthSnapshot, undefined);

    sourceStore.saveOutlineConfig(outlineConfig(5));
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepth, 5);

    const outlineData = {
      project_name: '测试项目',
      outline: [{ id: '1', title: '技术方案', description: '技术方案', attr: '技术', content_mode: 'ai-generate' }],
    };
    sourceStore.updateTechnicalPlan({ outlineData, outlineMinimumDepthSnapshot: 5 });
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepthSnapshot, 5);

    sourceDatabase.db.prepare('UPDATE technical_plan_meta SET outline_minimum_depth_snapshot = NULL WHERE id = 1').run();
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepthSnapshot, 0);

    sourceStore.updateTechnicalPlan({ outlineData: null });
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepthSnapshot, undefined);
    assert.equal(sourceStore.loadTechnicalPlan().outlineMinimumDepth, 5);

    await sourceStore.importTenderDocument(['fixture.md']);
    sourceStore.saveOutlineConfig(outlineConfig(5));
    const seed = sourceStore.exportVariantSeed();
    assert.equal(seed.outlineMinimumDepth, 5);

    const derivedApp = createApp(derivedPath);
    derivedDatabase = createSqliteDatabase(derivedApp);
    const derivedStore = createStore(derivedApp, derivedDatabase.db);
    const derivedState = derivedStore.importVariantSeed(seed);
    assert.equal(derivedState.outlineMinimumDepth, 5);
    assert.equal(derivedState.outlineMinimumDepthSnapshot, undefined);
  } finally {
    sourceDatabase?.close();
    derivedDatabase?.close();
    fs.rmSync(sourcePath, { recursive: true, force: true });
    fs.rmSync(derivedPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  runAssertions()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => process.exit(process.exitCode || 0));
} else {
  test('persists outline minimum depth, loads legacy snapshots, and inherits current value for variants', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
