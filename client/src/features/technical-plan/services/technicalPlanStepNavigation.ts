import type { TechnicalPlanStep } from '../types';

export const TECHNICAL_PLAN_STAGE_DEFINITIONS = [
  { key: 'document-analysis', label: '选择标书' },
  { key: 'bid-analysis', label: '文件解析' },
  { key: 'outline-generation', label: '目录生成' },
  { key: 'global-facts', label: '事实设定' },
  { key: 'content-edit', label: '生成正文' },
] as const satisfies ReadonlyArray<{ key: TechnicalPlanStep; label: string }>;

export type TechnicalPlanStageKey = typeof TECHNICAL_PLAN_STAGE_DEFINITIONS[number]['key'];
export type TechnicalPlanStageVisualState = 'complete' | 'current' | 'available' | 'locked';
export type TechnicalPlanStageCompletion = Record<TechnicalPlanStageKey, boolean>;

export interface TechnicalPlanStageModel {
  key: TechnicalPlanStageKey;
  label: string;
  statusLabel: string;
  state: TechnicalPlanStageVisualState;
  complete: boolean;
  accessible: boolean;
  canProceed: boolean;
  proceedBlockedReason?: string;
  disabled: boolean;
}

export function buildTechnicalPlanStageModels(input: {
  currentStep: TechnicalPlanStep;
  completed: TechnicalPlanStageCompletion;
  currentStatusLabel?: string;
}): TechnicalPlanStageModel[] {
  const stages = TECHNICAL_PLAN_STAGE_DEFINITIONS.map((definition, index) => {
    const complete = input.completed[definition.key];
    const current = definition.key === input.currentStep;
    const prerequisitesComplete = TECHNICAL_PLAN_STAGE_DEFINITIONS
      .slice(0, index)
      .every((previous) => input.completed[previous.key]);
    const accessible = current || complete || prerequisitesComplete;
    const state: TechnicalPlanStageVisualState = current
      ? 'current'
      : complete
        ? 'complete'
        : accessible
          ? 'available'
          : 'locked';
    return {
      ...definition,
      state,
      complete,
      accessible,
      disabled: !accessible,
      statusLabel: current
        ? input.currentStatusLabel || (complete ? '待验收' : '进行中')
        : complete
          ? '已完成'
          : accessible
            ? '可开始'
            : '待开放',
    };
  });

  return stages.map((stage, index) => {
    const nextStage = stages[index + 1];
    const blockedByPrerequisites = stage.complete && nextStage && !nextStage.accessible;
    return {
      ...stage,
      // 前四步确认后必须能进入下一阶段；第五步的完成字段仍用于正文导出。
      canProceed: stage.complete && (!nextStage || nextStage.accessible),
      proceedBlockedReason: blockedByPrerequisites
        ? `前置步骤尚未完成：${stages.slice(0, index + 1).filter((previous) => !previous.complete).map((previous) => previous.label).join('、')}`
        : undefined,
    };
  });
}
