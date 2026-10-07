const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
  const { getBidAnalysisTasks } = require('./bidAnalysisTask.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-empty-historical-source-'));
  const app = { getPath: () => root, once() {} };
  let database;
  try {
    database = createSqliteDatabase(app);
    const store = createTechnicalPlanStore({ app, db: database.db, fileService: {},
      agentService: { deletePersistentTask() {} }, taskLogStore: { list: () => [], sync() {} }, configStore: { load: () => ({}) } });
    const originalPlan = '# 实施方案\n## 作业流程\n### 整体作业流程\n### 调查作业流程\n调查正文。';
    const originalPath = path.join(root, 'workspace', 'technical-plan', 'original-plan.md');
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.writeFileSync(originalPath, originalPlan, 'utf8');
    database.db.prepare('UPDATE technical_plan_meta SET original_plan_markdown_path = ? WHERE id = 1').run('technical-plan/original-plan.md');
    store.updateTechnicalPlan({
      outlineData: { outline: [{ id: '3.1.1', title: '整体作业流程' }] },
      historicalAdaptationDifferenceConfirmedAt: '2026-10-01T08:00:00.000Z',
      historicalAdaptationOutlineConfirmedAt: '2026-10-01T09:00:00.000Z',
      historicalAdaptationOutlineChanges: [{ target_node_id: '3.1.1', target_title: '整体作业流程', reason: '沿用历史章节', original_path: '原目录 / 实施方案 / 作业流程 / 整体作业流程', change_type: 'unchanged' }],
      historicalAdaptationDifferences: [],
      bidAnalysisTasks: Object.fromEntries(getBidAnalysisTasks('full').map((item) => [item.id, { status: 'success', content: `${item.label}内容` }])),
    });
    const item = store.prepareHistoricalAdaptationContentPlan().historicalAdaptationContentItems[0];
    assert.equal(item.source_path, '实施方案 / 作业流程 / 整体作业流程');
    assert.equal(item.source_content_hash, '');
    assert.equal(item.recommended_mode, null);
    const source = store.getHistoricalAdaptationSourceSection({ nodeId: '3.1.1' });
    assert.equal(source.available, false);
    assert.match(source.error, /原文为空/);
  } finally {
    database?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try { runAssertions(); } catch (error) { console.error(error); process.exitCode = 1; } finally { process.exit(process.exitCode || 0); }
} else {
  test('distinguishes an existing historical heading with empty body from a hash mismatch', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
