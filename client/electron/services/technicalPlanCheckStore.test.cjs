const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function runStoreAssertions() {
  const { createSqliteDatabase } = require('./sqliteDatabase.cjs');
  const { createTaskLogStore } = require('./taskLogStore.cjs');
  const { createTechnicalPlanCheckStore } = require('./technicalPlanCheckStore.cjs');
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-technical-plan-check-store-'));
  const app = {
    getPath: () => userDataPath,
    once() {},
  };
  let database;
  try {
    database = createSqliteDatabase(app);
    const { db } = database;
    const store = createTechnicalPlanCheckStore({
      db,
      taskLogStore: createTaskLogStore({ db }),
    });

    assert.deepEqual(store.loadState(), {
      tenderFile: null,
      requirementsFile: null,
      scoringFile: null,
      proposalFile: null,
      outputPath: '',
      reportPath: '',
      summary: null,
      checkTask: undefined,
    });

    const inputs = {
      tender: { path: 'D:\\项目资料\\招标文件.docx', name: '招标文件.docx' },
      requirements: { path: 'D:\\项目资料\\采购需求.pdf', name: '采购需求.pdf' },
      scoring: { path: 'D:\\项目资料\\主观评分标准.docx', name: '主观评分标准.docx' },
      proposal: { path: 'D:\\项目资料\\技术方案.docx', name: '技术方案.docx' },
    };
    store.saveSelection('tender', inputs.tender);
    store.saveSelection('requirements', inputs.requirements);
    store.saveSelection('scoring', inputs.scoring);
    let state = store.saveSelection('proposal', inputs.proposal);
    assert.deepEqual(
      {
        tenderFile: state.tenderFile,
        requirementsFile: state.requirementsFile,
        scoringFile: state.scoringFile,
        proposalFile: state.proposalFile,
      },
      {
        tenderFile: inputs.tender,
        requirementsFile: inputs.requirements,
        scoringFile: inputs.scoring,
        proposalFile: inputs.proposal,
      },
    );
    assert.equal(state.outputPath, 'D:\\项目资料\\技术方案检查记录.docx');

    state = store.saveOutputPath('D:\\输出\\自定义检查记录.docx');
    assert.equal(state.outputPath, 'D:\\输出\\自定义检查记录.docx');
    store.updateWithoutReload({
      reportPath: 'D:\\输出\\自定义检查记录.docx',
      summary: { total: 3, issue: 1, review: 2 },
    });
    state = store.saveSelection('proposal', {
      path: 'D:\\项目资料\\技术方案修订版.docx',
      name: '技术方案修订版.docx',
    });
    assert.equal(state.outputPath, 'D:\\项目资料\\技术方案修订版检查记录.docx');
    assert.equal(state.reportPath, '');
    assert.equal(state.summary, null);

    const task = {
      task_id: 'check-1',
      type: 'technical-plan-check',
      status: 'running',
      progress: 40,
      logs: ['开始检查', '解析采购需求'],
      stats: { stage: 4 },
      started_at: '2026-09-29T01:00:00.000Z',
      updated_at: '2026-09-29T01:01:00.000Z',
    };
    state = store.checkpointTask(task, {
      summary: { total: 2 },
      reportPath: 'D:\\输出\\阶段报告.docx',
    });
    assert.equal(state.checkTask.task_id, 'check-1');
    assert.equal(state.checkTask.progress, 40);
    assert.deepEqual(state.checkTask.logs, ['开始检查', '解析采购需求']);
    assert.deepEqual(state.checkTask.stats, { stage: 4 });
    assert.deepEqual(state.summary, { total: 2 });
    assert.equal(state.reportPath, 'D:\\输出\\阶段报告.docx');
    assert.deepEqual(
      db.prepare(`
        SELECT task_domain, task_type, task_id, message
        FROM task_logs
        ORDER BY id ASC
      `).all(),
      [
        {
          task_domain: 'technical-plan-check',
          task_type: 'technical-plan-check',
          task_id: 'check-1',
          message: '开始检查',
        },
        {
          task_domain: 'technical-plan-check',
          task_type: 'technical-plan-check',
          task_id: 'check-1',
          message: '解析采购需求',
        },
      ],
    );

    state = store.recoverInterruptedTask();
    assert.equal(state.checkTask.status, 'error');
    assert.match(state.checkTask.error, /中断/);
    assert.deepEqual(state.checkTask.logs, ['开始检查', '解析采购需求']);

    store.checkpointTask({
      ...state.checkTask,
      task_id: 'check-2',
      status: 'running',
      logs: ['重新开始'],
      updated_at: '2026-09-29T01:02:00.000Z',
    }, {});
    assert.deepEqual(
      db.prepare(`
        SELECT task_id, message
        FROM task_logs
        WHERE task_domain = 'technical-plan-check'
        ORDER BY id ASC
      `).all(),
      [{ task_id: 'check-2', message: '重新开始' }],
    );

    store.checkpointTask(null, {});
    assert.equal(store.loadState().checkTask, undefined);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_domain = 'technical-plan-check'").get().count,
      0,
    );

    store.saveSelection('tender', inputs.tender);
    store.checkpointTask({
      task_id: 'check-3',
      type: 'technical-plan-check',
      status: 'success',
      progress: 100,
      logs: ['完成'],
      started_at: '2026-09-29T01:03:00.000Z',
      updated_at: '2026-09-29T01:04:00.000Z',
    }, { summary: { total: 0 }, reportPath: 'D:\\输出\\完成.docx' });
    state = store.clear();
    assert.deepEqual(state, {
      tenderFile: null,
      requirementsFile: null,
      scoringFile: null,
      proposalFile: null,
      outputPath: '',
      reportPath: '',
      summary: null,
      checkTask: undefined,
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM task_logs WHERE task_domain = 'technical-plan-check'").get().count,
      0,
    );
  } finally {
    database?.close();
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
}

if (process.argv.includes('--electron-native')) {
  try {
    runStoreAssertions();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.exit(process.exitCode || 0);
  }
} else {
  test('persists technical plan check inputs, output, result and task logs', () => {
    const result = spawnSync(require('electron'), ['--runAsNode', __filename, '--electron-native'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || 'Electron native store test timed out');
  });
}
