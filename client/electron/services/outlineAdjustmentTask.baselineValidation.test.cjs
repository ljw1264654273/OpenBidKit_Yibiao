const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentOutlineInput,
  buildAdjustmentBaseline,
  inheritCoverageOverrides,
} = require('./outlineAdjustmentTask.cjs');
const { stripOutlineInternalFields, validateFinalOutline } = require('./outlineGenerationTaskV2.cjs');

function manualOutline() {
  return {
    outline: [{
      id: '1',
      title: '项目总体方案',
      description: '相关说明',
      attr: '技术',
      children: [{
        id: '1.1',
        title: '建设目标',
        description: '具体内容',
        content_mode: 'ai-generate',
      }],
    }],
  };
}

test('未变化的手工单子节点和空泛说明按 origin 基线豁免', () => {
  const working = buildAgentOutlineInput(manualOutline());
  const baseline = buildAdjustmentBaseline(working);
  const result = validateFinalOutline({
    outline: working,
    scoreCoverageMap: { version: 1, coverage_mode: 'legacy-structure-only', records: [] },
    baseline,
  });

  assert.equal(result.valid, true);
  assert.ok(working.outline[0].origin_id);
  assert.equal(stripOutlineInternalFields(working).outline[0].origin_id, undefined);
});

test('Agent 新增的单子节点或空泛说明不享受基线豁免', () => {
  const working = buildAgentOutlineInput(manualOutline());
  const baseline = buildAdjustmentBaseline(working);
  working.outline.push({
    id: '2',
    origin_id: 'agent-new-root',
    title: '新增方案',
    description: '相关说明',
    attr: '技术',
    children: [{
      id: '2.1',
      origin_id: 'agent-new-child',
      title: '新增内容',
      description: '具体内容',
      content_mode: 'ai-generate',
    }],
  });
  const result = validateFinalOutline({
    outline: working,
    scoreCoverageMap: { version: 1, coverage_mode: 'legacy-structure-only', records: [] },
    baseline,
  });

  assert.equal(result.valid, false);
  assert.ok(result.mandatoryIssues.some((issue) => issue.code === 'single-child'));
  assert.ok(result.mandatoryIssues.some((issue) => issue.code === 'generic-description'));
});

test('AI 调整继承全部用户覆盖状态并继续保留部分删除的剩余节点', () => {
  const previous = {
    version: 1,
    coverage_mode: 'full',
    records: [
      { source_id: 'R1', user_override: 'renamed', node_ids: ['1'] },
      { source_id: 'R2', user_override: 'partially-removed', node_ids: ['1.1'] },
      { source_id: 'R3', user_override: 'removed', node_ids: [] },
      { source_id: 'U1', user_override: 'added', node_ids: ['1.2'] },
    ],
  };
  const generated = {
    version: 1,
    coverage_mode: 'full',
    records: previous.records.map((record) => ({ ...record, user_override: 'none' })),
  };
  const merged = inheritCoverageOverrides(previous, generated);

  assert.deepEqual(merged.records.map((record) => record.user_override), ['renamed', 'partially-removed', 'removed', 'added']);
  assert.deepEqual(merged.records[1].node_ids, ['1.1']);
});
