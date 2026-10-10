import type { TechnicalPlanStageKey, TechnicalPlanStageModel } from '../services/technicalPlanStepNavigation';

interface TechnicalPlanStageNavigationProps {
  stages: TechnicalPlanStageModel[];
  onStageChange: (step: TechnicalPlanStageKey) => void;
}

function TechnicalPlanStageNavigation({ stages, onStageChange }: TechnicalPlanStageNavigationProps) {
  return (
    <section className="technical-plan-stage-panel" aria-label="技术方案流程">
      <nav className="technical-plan-stages" aria-label="技术方案步骤">
        {stages.map((stage, index) => (
          <button
            key={stage.key}
            type="button"
            className={`technical-plan-stage is-${stage.state}`}
            aria-current={stage.state === 'current' ? 'step' : undefined}
            disabled={stage.disabled}
            onClick={() => onStageChange(stage.key)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stage.label}</strong>
            <small>{stage.statusLabel}</small>
          </button>
        ))}
      </nav>
    </section>
  );
}

export default TechnicalPlanStageNavigation;
