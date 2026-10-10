import { useToast } from '../../../shared/ui';
import type { SectionId } from '../../../shared/types/navigation';
import TechnicalPlanHome from '../../technical-plan/pages/TechnicalPlanHome';
import { createBidProjectFromTenderFiles } from '../services/createBidProjectFromTenderFiles';
import type { BidProject } from '../types';

interface BidProjectCreatePageProps {
  onSectionChange: (section: SectionId) => void;
  registerLeaveGuard?: (guard: ((nextSection?: string) => Promise<boolean>) | null) => void;
  onProjectOpen: (project: BidProject) => Promise<void>;
}

function BidProjectCreatePage({ onSectionChange, onProjectOpen, registerLeaveGuard }: BidProjectCreatePageProps) {
  const { showToast } = useToast();

  return (
    <TechnicalPlanHome
      workflowKind="technical-plan"
      onSectionChange={onSectionChange}
      registerLeaveGuard={registerLeaveGuard}
      onCreateFromTenderFiles={(filePaths) => createBidProjectFromTenderFiles({ showToast, onProjectOpen, filePaths })}
    />
  );
}

export default BidProjectCreatePage;
