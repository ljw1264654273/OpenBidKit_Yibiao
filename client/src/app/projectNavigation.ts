import type { SectionId } from '../shared/types/navigation';
import type { BidProjectType } from '../features/bid-project/types';

export type ProjectWorkbenchSection = 'technical-plan' | 'existing-plan-expansion';

export interface MenuNavigationDecision {
  shouldNavigate: boolean;
  shouldCloseActiveProject: boolean;
  shouldStartNewExpansion: boolean;
}

export function isProjectWorkbenchSection(section: SectionId): section is ProjectWorkbenchSection {
  return section === 'technical-plan' || section === 'existing-plan-expansion';
}

export function getProjectSection(projectType: BidProjectType): ProjectWorkbenchSection {
  return projectType === 'existing-plan-expansion' ? 'existing-plan-expansion' : 'technical-plan';
}

export function getMenuNavigationDecision({
  activeSection,
  requestedSection,
  activeProjectId,
}: {
  activeSection: SectionId;
  requestedSection: SectionId;
  activeProjectId: string | null;
}): MenuNavigationDecision {
  const isSameSection = requestedSection === activeSection;
  const shouldStartNewExpansion = requestedSection === 'existing-plan-expansion' && Boolean(activeProjectId);

  if (isSameSection && !shouldStartNewExpansion) {
    return {
      shouldNavigate: false,
      shouldCloseActiveProject: false,
      shouldStartNewExpansion: false,
    };
  }

  const shouldSwitchWorkbench = isProjectWorkbenchSection(requestedSection)
    && requestedSection !== activeSection;

  return {
    shouldNavigate: true,
    shouldCloseActiveProject: Boolean(activeProjectId && (
      shouldStartNewExpansion
      || shouldSwitchWorkbench
      || !isProjectWorkbenchSection(requestedSection)
    )),
    shouldStartNewExpansion,
  };
}
