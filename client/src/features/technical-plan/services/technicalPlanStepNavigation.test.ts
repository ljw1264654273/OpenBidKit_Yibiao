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
      { accessible: true, complete: true, canProceed: false },
      { accessible: false, complete: false, canProceed: false },
    ],
  );
  assert.equal(stages[4].state, 'locked');
  assert.equal(stages[4].disabled, true);
});

test('重新解析期间可回访已完成事实设定，但不能进入被前置条件锁定的正文阶段', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'global-facts',
    completed: {
      'document-analysis': true,
      'bid-analysis': false,
      'outline-generation': true,
      'global-facts': true,
      'content-edit': false,
    },
  });

  assert.equal(stages[3].accessible, true);
  assert.equal(stages[3].complete, true);
  assert.equal(stages[4].accessible, false);
  assert.equal(stages[3].canProceed, false);
  assert.equal(stages[3].proceedBlockedReason, '前置步骤尚未完成：文件解析');
});

test('所有完成组合中，前四阶段继续条件都与下一阶段准入一致', () => {
  const keys = ['document-analysis', 'bid-analysis', 'outline-generation', 'global-facts', 'content-edit'] as const;
  for (let bits = 0; bits < 32; bits += 1) {
    const completed = Object.fromEntries(keys.map((key, index) => [key, Boolean(bits & (1 << index))])) as Record<typeof keys[number], boolean>;
    for (const currentStep of keys) {
      const stages = buildTechnicalPlanStageModels({ currentStep, completed });
      stages.slice(0, -1).forEach((stage, index) => {
        assert.equal(stage.canProceed, stage.complete && stages[index + 1].accessible);
      });
      assert.equal(stages[4].canProceed, completed['content-edit']);
    }
  }
});

test('前置恢复完成后清除阻塞原因，第五阶段已有正文仍可用于导出', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'global-facts',
    completed: {
      'document-analysis': true,
      'bid-analysis': true,
      'outline-generation': true,
      'global-facts': true,
      'content-edit': false,
    },
  });
  assert.equal(stages[3].canProceed, true);
  assert.equal(stages[3].proceedBlockedReason, undefined);

  const withContent = buildTechnicalPlanStageModels({
    currentStep: 'content-edit',
    completed: {
      'document-analysis': false,
      'bid-analysis': false,
      'outline-generation': false,
      'global-facts': false,
      'content-edit': true,
    },
  });
  assert.equal(withContent[4].canProceed, true);
  assert.equal(withContent[4].proceedBlockedReason, undefined);
});
