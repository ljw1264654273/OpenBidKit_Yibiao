interface TechnicalPlanStageFooterProps {
  title: string;
  description: string;
  actionLabel: string;
  disabled: boolean;
  tooltip: string;
  onAction: () => void;
}

function TechnicalPlanStageFooter({
  title,
  description,
  actionLabel,
  disabled,
  tooltip,
  onAction,
}: TechnicalPlanStageFooterProps) {
  return (
    <footer className="technical-plan-stage-footer">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button type="button" className="primary-action" disabled={disabled} title={tooltip} onClick={onAction}>
        {actionLabel}
      </button>
    </footer>
  );
}

export default TechnicalPlanStageFooter;
