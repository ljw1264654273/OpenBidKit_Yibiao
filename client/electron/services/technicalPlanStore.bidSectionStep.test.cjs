const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
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

function createStore(app, db, markdown) {
  return createTechnicalPlanStore({
    app,
    db,
    fileService: {
      async importDocument() {
        return {
          success: true,
          file_content: markdown,
          file_name: '多标项招标文件.md',
          parser_label: '本地解析',
        };
      },
    },
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

async function runAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-bid-section-step-'));
  let database;
  try {
    const markdown = [
      '# 招标文件',
      '本次采购共3个标项。',
      '## 标项一',
      '标项一内容。',
      '## 标项二',
      '标项二内容。',
      '## 标项三',
      '标项三内容。',
    ].join('\n');
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createStore(app, database.db, markdown);

    await store.importTenderDocument(['fixture.md']);
    store.updateTechnicalPlan({
      step: 'document-analysis',
      bidSectionMode: 'multiple',
      bidSectionExtractionStatus: 'success',
      bidSections: [
        { id: 'section-1', index: 1, unit: '标项', title: '标项一', includeRanges: [{ startLine: 3, endLine: 4 }] },
        { id: 'section-2', index: 2, unit: '标项', title: '标项二', includeRanges: [{ startLine: 5, endLine: 6 }] },
        { id: 'section-3', index: 3, unit: '标项', title: '标项三', includeRanges: [{ startLine: 7, endLine: 8 }] },
      ],
    });

    store.selectBidSection({ id: 'section-2' });
    const state = store.loadTechnicalPlan();

    assert.equal(state.tenderFile.selectedSectionId, 'section-2');
    assert.equal(state.tenderFile.selectedSectionTitle, '标项二');
    assert.equal(state.step, 'document-analysis');
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
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
  test('STEP 01 选择多标段投标范围后仍停留在第一步', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native bid section step test timed out'}`);
  });
}
