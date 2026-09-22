import { useEffect, useState } from 'react';
import { getKnowledgeBaseIdByNavigationId } from '../features/knowledge-base/knowledgeBaseCatalog';
import { normalizeSectionId, type SectionId } from '../shared/types/navigation';
import { getAppMenuItemById } from './menuConfig';
import BusinessBidPage from '../features/business-bid/pages/BusinessBidPage';
import ContentExpansionReplaceTestPage from '../features/developer/pages/ContentExpansionReplaceTestPage';
import DeveloperDemoPage, { isDeveloperDemoSection } from '../features/developer/pages/DeveloperDemoPage';
import DeveloperMultimodalTestPage from '../features/developer/pages/DeveloperMultimodalTestPage';
import AgentTestPage from '../features/developer/pages/AgentTestPage';
import DeveloperTestPage from '../features/developer/pages/DeveloperTestPage';
import ExportFormatPage from '../features/export-format/pages/ExportFormatPage';
import MyTemplatesPage from '../features/export-format/pages/MyTemplatesPage';
import DuplicateCheckPage from '../features/duplicate-check/pages/DuplicateCheckPage';
import KnowledgeBasePage from '../features/knowledge-base/pages/KnowledgeBasePage';
import RemoteKnowledgeBasePage from '../features/knowledge-base/pages/RemoteKnowledgeBasePage';
import RejectionCheckPage from '../features/rejection-check/pages/RejectionCheckPage';
import SettingsPage from '../features/settings/pages/SettingsPage';
import TechnicalPlanHome from '../features/technical-plan/pages/TechnicalPlanHome';
import FeasibilityReportHome from '../features/feasibility-report/pages/FeasibilityReportHome';
import BidProjectWorkspacePage from '../features/bid-project/pages/BidProjectWorkspacePage';
import ExpansionProjectCreatePage from '../features/bid-project/pages/ExpansionProjectCreatePage';
import type { BidProject } from '../features/bid-project/types';
import SecondaryMenuPage from '../shared/ui/SecondaryMenuPage';

interface AppRouterProps {
  activeSection: SectionId;
  activeProjectId: string | null;
  developerMode: boolean;
  onDeveloperModeChange: (developerMode: boolean) => void;
  onSectionChange: (section: SectionId) => void;
  onProjectChange: (projectId: string | null) => void;
  onProjectOpen: (project: BidProject) => Promise<void>;
  registerLeaveGuard?: (guard: ((nextSection?: string) => Promise<boolean>) | null) => void;
}

function AppRouter({
  activeSection,
  activeProjectId,
  developerMode,
  onDeveloperModeChange,
  onSectionChange,
  onProjectChange,
  onProjectOpen,
  registerLeaveGuard,
}: AppRouterProps) {
  const normalizedSection = normalizeSectionId(activeSection);
  const activeMenuItem = getAppMenuItemById(normalizedSection, developerMode);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (normalizedSection !== 'my-templates') {
      setEditingTemplateId(null);
    }
  }, [normalizedSection]);

  if (activeMenuItem?.children?.length) {
    return <SecondaryMenuPage menuItem={activeMenuItem} onNavigate={onSectionChange} />;
  }

  if (isDeveloperDemoSection(normalizedSection)) {
    return <DeveloperDemoPage sectionId={normalizedSection} />;
  }

  const knowledgeBaseId = getKnowledgeBaseIdByNavigationId(normalizedSection);
  if (knowledgeBaseId) {
    return <KnowledgeBasePage knowledgeBaseId={knowledgeBaseId} />;
  }

  switch (normalizedSection) {
    case 'bid-projects':
      return <BidProjectWorkspacePage onSectionChange={onSectionChange} onProjectOpen={onProjectOpen} />;
    case 'technical-plan':
      return <TechnicalPlanHome workflowKind="technical-plan" projectId={activeProjectId || undefined} registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} />;
    case 'existing-plan-expansion':
      return activeProjectId ? (
        <TechnicalPlanHome workflowKind="existing-plan-expansion" projectId={activeProjectId} registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} />
      ) : (
        <ExpansionProjectCreatePage
          onBack={() => onSectionChange('bid-projects')}
          onProjectCreated={(project) => {
            onProjectChange(project.projectId);
          }}
        />
      );
    case 'feasibility-report':
      return <FeasibilityReportHome registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} />;
    case 'business-bid':
      return <BusinessBidPage />;
    case 'remote-knowledge-base':
      return <RemoteKnowledgeBasePage />;
    case 'image-knowledge-base':
      return <KnowledgeBasePlaceholder title="图片知识库" description="图片知识库正在开发中，敬请期待。" />;
    case 'duplicate-check':
      return <DuplicateCheckPage />;
    case 'rejection-check':
      return <RejectionCheckPage />;
    case 'my-templates':
      return editingTemplateId
        ? <ExportFormatPage mode="edit" templateId={editingTemplateId} onBack={() => setEditingTemplateId(null)} />
        : <MyTemplatesPage onCreateTemplate={() => onSectionChange('new-template')} onEditTemplate={setEditingTemplateId} />;
    case 'new-template':
      return <ExportFormatPage mode="create" />;
    case 'export-format':
      return <ExportFormatPage mode="create" />;
    case 'developer-test':
      return null;
    case 'developer-json-test':
      return <DeveloperTestPage />;
    case 'developer-multimodal-test':
      return <DeveloperMultimodalTestPage />;
    case 'developer-expansion-replace-test':
      return <ContentExpansionReplaceTestPage />;
    case 'developer-agent-test':
      return <AgentTestPage />;
    case 'settings':
      return <SettingsPage onDeveloperModeChange={onDeveloperModeChange} />;
    default:
      return null;
  }
}

function KnowledgeBasePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="page-stack knowledge-placeholder-page">
      <section className="knowledge-placeholder-panel">
        <span className="section-kicker">知识库</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </section>
    </div>
  );
}

export default AppRouter;
