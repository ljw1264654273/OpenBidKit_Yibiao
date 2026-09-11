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
    agentService: { deletePersistentTask() {} },
    taskLogStore: { list: () => [], sync() {} },
    configStore: { load: () => ({}) },
  });
}

function coverageRecord(overrides = {}) {
  return {
    source_id: 'R1-C1-P1',
    source_kind: 'response-point',
    source_text: '建设目标',
    node_ids: ['1.1', '1.2'],
    coverage_location: 'title',
    user_override: 'none',
    supplement_kind: 'none',
    ...overrides,
  };
}

function outline(children) {
  return {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '响应项目总体方案评分要求',
      attr: '技术',
      ...(children?.length ? { children } : { content_mode: 'ai-generate' }),
    }],
  };
}

function leaf(id, title) {
  return { id, title, description: `${title}的具体响应内容`, content_mode: 'ai-generate' };
}

async function runAssertions() {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-score-coverage-'));
  let database;
  try {
    const app = createApp(userDataPath);
    database = createSqliteDatabase(app);
    const store = createStore(app, database.db);
    const initialOutline = outline([leaf('1.1', '建设目标。'), leaf('1.2', '建设目标实施要求：')]);
    store.updateTechnicalPlan({
      outlineData: initialOutline,
      outlineGenerationTask: {
        task_id: 'outline-score-map',
        status: 'success',
        progress: 100,
        stats: {
          score_coverage_map: { version: 1, coverage_mode: 'full', records: [coverageRecord()] },
        },
      },
    });
    let storedOutline = store.loadTechnicalPlan().outlineData;
    assert.equal(storedOutline.outline[0].children[0].title, '建设目标');
    assert.equal(storedOutline.outline[0].children[1].title, '建设目标实施要求');

    const sortedOutline = outline([leaf('1.1', '建设目标实施要求；'), leaf('1.2', '建设目标，')]);
    const sortedSaved = store.saveOutline({
      outlineData: sortedOutline,
      reason: 'sort',
      idMap: { '1': '1', '1.1': '1.2', '1.2': '1.1' },
    });
    let map = sortedSaved.outlineGenerationTask.stats.score_coverage_map;
    assert.deepEqual(map.records[0].node_ids, ['1.2', '1.1']);
    assert.equal(sortedSaved.outlineData.outline[0].children[0].title, '建设目标实施要求');
    assert.equal(sortedSaved.outlineData.outline[0].children[1].title, '建设目标');

    const editedOutline = outline([leaf('1.1', '用户修改的建设要求'), leaf('1.2', '建设目标')]);
    const editedSaved = store.saveOutline({ outlineData: editedOutline, reason: 'edit', affectedNodeIds: ['1.1'] });
    map = editedSaved.outlineGenerationTask.stats.score_coverage_map;
    assert.equal(map.records[0].user_override, 'renamed');

    const partiallyDeletedSaved = store.saveOutline({
      outlineData: outline([leaf('1.2', '建设目标')]),
      reason: 'delete',
      affectedNodeIds: ['1.1'],
      idMap: { '1': '1', '1.2': '1.2' },
    });
    map = partiallyDeletedSaved.outlineGenerationTask.stats.score_coverage_map;
    assert.deepEqual(map.records[0].node_ids, ['1.2']);
    assert.equal(map.records[0].user_override, 'partially-removed');

    const deletedSaved = store.saveOutline({
      outlineData: outline(),
      reason: 'delete',
      affectedNodeIds: ['1.2'],
      idMap: { '1': '1' },
    });
    map = deletedSaved.outlineGenerationTask.stats.score_coverage_map;
    assert.deepEqual(map.records[0].node_ids, []);
    assert.equal(map.records[0].coverage_location, 'none');
    assert.equal(map.records[0].user_override, 'removed');

    const addedChildSaved = store.saveOutline({
      outlineData: outline([leaf('1.1', '用户补充内容')]),
      reason: 'add-child',
      affectedNodeIds: ['1'],
      idMap: { '1': '1' },
    });
    map = addedChildSaved.outlineGenerationTask.stats.score_coverage_map;
    const userRecord = map.records.find((record) => record.source_id === 'U1');
    assert.equal(userRecord.source_kind, 'user-supplement');
    assert.deepEqual(userRecord.node_ids, ['1.1']);
    assert.equal(userRecord.user_override, 'added');

    const replacementMap = {
      version: 1,
      coverage_mode: 'full',
      records: [coverageRecord({ source_id: 'R2', source_kind: 'requirement', node_ids: ['1'] })],
    };
    store.saveOutline({ outlineData: outline(), reason: 'replace', scoreCoverageMap: replacementMap });
    map = store.loadTechnicalPlan().outlineGenerationTask.stats.score_coverage_map;
    assert.deepEqual(map, replacementMap);
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
  test('saveOutline 按修改原因持续维护评分覆盖映射', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout || 'Electron native score coverage test timed out'}`);
  });
}
