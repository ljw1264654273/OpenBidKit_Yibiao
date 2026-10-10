import test from 'node:test';
import assert from 'node:assert/strict';

// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { buildTechnicalPlanStageModels } from './technicalPlanStepNavigation.ts';

test('按阶段顺序映射已完成、当前和锁定状态', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'bid-analysis',
    completed: {
      'document-analysis': true,
      'bid-analysis': false,
      'outline-generation': false,
      'global-facts': false,
      'content-edit': false,
    },
  });

  assert.deepEqual(
    stages.map(({ state, disabled }) => ({ state, disabled })),
    [
      { state: 'complete', disabled: false },
      { state: 'current', disabled: false },
      { state: 'locked', disabled: true },
      { state: 'locked', disabled: true },
      { state: 'locked', disabled: true },
    ],
  );
});

test('当前阶段展示运行状态并开放完成前置条件后的下一阶段', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'bid-analysis',
    completed: {
      'document-analysis': true,
      'bid-analysis': true,
      'outline-generation': false,
      'global-facts': false,
      'content-edit': false,
    },
    currentStatusLabel: '解析中',
  });

  assert.equal(stages[1].statusLabel, '解析中');
  assert.equal(stages[2].state, 'available');
  assert.equal(stages[2].disabled, false);
});

test('回退到第一阶段时保留非相邻已完成阶段的可达性与完成字段', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'document-analysis',
    completed: {
      'document-analysis': false,
      'bid-analysis': true,
      'outline-generation': true,
      'global-facts': true,
      'content-edit': false,
    },
  });

  assert.deepEqual(
    stages.map(({ accessible, complete, canProceed }) => ({ accessible, complete, canProceed })),
    [
      { accessible: true, complete: false, canProceed: false },
      { accessible: true, complete: true, canProceed: true },
      { accessible: true, complete: true, canProceed: true },
      { accessible: true, complete: true, canProceed: true },
      { accessible: false, complete: false, canProceed: false },
    ],
  );
  assert.equal(stages[4].state, 'locked');
  assert.equal(stages[4].disabled, true);
});
