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
  const updatedOutlineTask = { task_id: 'outline-score-map', stats: { score_coverage_map: { records: [] } } };
  const workspaceStore = {
    loadTechnicalPlan: () => ({ outlineData, outlineGenerationTask: { stats: {} } }),
    saveOutline: (request) => {
      saveRequest = request;
      return { outlineData: request.outlineData, outlineGenerationTask: updatedOutlineTask };
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
  assert.equal(checkpointCalls.at(-1).result.technicalPlanPatch.outlineGenerationTask, updatedOutlineTask);
});

test('完整覆盖模式在 AI 调整后恢复权威来源并重新计算原文锚点', async () => {
  const outlineData = {
    project_name: '测试项目',
    project_overview: '测试概述',
    outline: [{
      id: '1',
      title: '实施方案',
      description: '实施方案的具体响应范围和交付内容',
      attr: '技术',
      content_mode: 'ai-generate',
    }],
  };
  const previousCoverageMap = {
    version: 2,
    coverage_mode: 'full',
    document_hash: 'old-hash',
    records: [{
      source_id: 'R1-C1',
      source_kind: 'criterion',
      source_text: '供应商应提交实施方案',
      node_ids: ['1'],
      coverage_location: 'description',
      user_override: 'none',
      supplement_kind: 'none',
      source_location_status: 'located',
      source_anchor: {
        document_hash: 'old-hash',
        match_start: 0,
        match_end: 2,
        context_start: 0,
        context_end: 2,
        match_method: 'exact',
      },
    }],
  };
  let saveRequest;
  const workspaceStore = {
    loadTechnicalPlan: () => ({
      outlineData,
      outlineGenerationTask: { stats: { score_coverage_map: previousCoverageMap } },
    }),
    readTenderMarkdown: () => '前文。\n\n供应商应提交实施方案。\n\n后文。',
    saveOutline: (request) => {
      saveRequest = request;
      return {
        outlineData: request.outlineData,
        outlineGenerationTask: { task_id: 'outline-score-map', stats: { score_coverage_map: request.scoreCoverageMap } },
      };
    },
  };
  const agentService = {
    hasPersistentTaskSession: () => true,
    updatePersistentTask() {},
    runTask: async (input) => {
      const working = JSON.parse(input.files.find((file) => file.path === 'outline.json').content);
      const agentInputMap = JSON.parse(input.files.find((file) => file.path === 'score-coverage-map.json').content);
      assert.equal(agentInputMap.version, 1);
      assert.equal(agentInputMap.records[0].source_anchor, undefined);
      const generatedMap = {
        version: 1,
        coverage_mode: 'full',
        records: [
          {
            ...previousCoverageMap.records[0],
            source_kind: 'response-point',
            source_text: 'Agent 改写来源',
            source_anchor: {
              document_hash: 'forged',
              match_start: 0,
              match_end: 1,
              context_start: 0,
              context_end: 1,
              match_method: 'exact',
            },
          },
          {
            source_id: 'FAKE-C1',
            source_kind: 'criterion',
            source_text: '前文',
            node_ids: ['1'],
            coverage_location: 'description',
            user_override: 'none',
            supplement_kind: 'none',
          },
        ],
      };
      await input.continueTask(
        { output_content: JSON.stringify(working) },
        { readFile: async () => JSON.stringify(generatedMap) },
      );
      return { output_content: JSON.stringify(working), assistant_text: '完成调整。' };
    },
  };
  const checkpointTask = (patch) => ({ task: { task_id: 'adjust-full', stats: patch.stats || {}, logs: patch.logs || [], ...patch } });

  await runOutlineAdjustmentTask({
    agentService,
    workspaceStore,
    updateTask: (patch) => ({ task_id: 'adjust-full', stats: {}, logs: patch.logs || [], ...patch }),
    checkpointTask,
    taskControl: { signal: new AbortController().signal },
    payload: { requirement: '优化目录描述' },
  });

  const record = saveRequest.scoreCoverageMap.records[0];
  assert.equal(saveRequest.scoreCoverageMap.version, 2);
  assert.equal(record.source_kind, 'criterion');
  assert.equal(record.source_text, '供应商应提交实施方案');
  assert.equal(record.source_location_status, 'located');
  assert.equal(record.source_anchor.match_start, '前文。\n\n'.length);
  assert.notEqual(record.source_anchor.document_hash, 'forged');
  assert.equal(saveRequest.scoreCoverageMap.records.some((item) => item.source_id === 'FAKE-C1'), false);
});
