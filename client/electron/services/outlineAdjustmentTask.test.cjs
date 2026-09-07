const test = require('node:test');
const assert = require('node:assert/strict');

const { runOutlineAdjustmentTask } = require('./outlineAdjustmentTask.cjs');

test('旧目录 AI 调整使用 legacy-structure-only 且不伪造评分来源', async () => {
  const outlineData = {
    project_name: '测试项目',
    project_overview: '测试概述',
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '项目总体方案的具体响应范围',
      attr: '技术',
      content_mode: 'ai-generate',
    }],
  };
  let saveRequest;
  const checkpointCalls = [];
  const workspaceStore = {
    loadTechnicalPlan: () => ({ outlineData, outlineGenerationTask: { stats: {} } }),
    saveOutline: (request) => {
      saveRequest = request;
      return { outlineData: request.outlineData };
    },
  };
  const agentService = {
    hasPersistentTaskSession: () => true,
    updatePersistentTask() {},
    runTask: async (input) => {
      const working = JSON.parse(input.files.find((file) => file.path === 'outline.json').content);
      const files = new Map([
        ['score-coverage-map.json', JSON.stringify({ version: 1, coverage_mode: 'legacy-structure-only', records: [] })],
      ]);
      await input.continueTask(
        { output_content: JSON.stringify(working) },
        { readFile: async (name) => files.get(name) },
      );
      return { output_content: JSON.stringify(working), assistant_text: '仅调整指定目录。' };
    },
  };
  const checkpointTask = (patch, data, result) => {
    checkpointCalls.push({ patch, data, result });
    return { task: { task_id: 'adjust-legacy', stats: patch.stats || {}, logs: patch.logs || [], ...patch } };
  };

  await runOutlineAdjustmentTask({
    agentService,
    workspaceStore,
    updateTask: (patch) => ({ task_id: 'adjust-legacy', stats: {}, logs: patch.logs || [], ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal },
    payload: { requirement: '只优化当前标题表达' },
  });

  assert.equal(saveRequest.scoreCoverageMap.coverage_mode, 'legacy-structure-only');
  assert.deepEqual(saveRequest.scoreCoverageMap.records, []);
  assert.equal(saveRequest.outlineData.outline[0].origin_id, undefined);
  assert.match(checkpointCalls.at(-1).patch.stats.adjustment.notice, /旧目录仅完成结构检查/);
});
