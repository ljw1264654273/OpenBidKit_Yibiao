import { useCallback, useEffect, useRef, useState } from 'react';
import AppRouter from './app/AppRouter';
import GpuHardwareAccelerationPrompt from './app/GpuHardwareAccelerationPrompt';
import RequiredOnlineServicesPrompt from './app/RequiredOnlineServicesPrompt';
import AppShell from './components/AppShell';
import { trackAppOpen, trackConfigUsage, trackPageView } from './shared/analytics/analytics';
import type { SectionId } from './shared/types/navigation';
import { onAppNavigation } from './shared/navigation/appNavigation';
import type { BidProject } from './features/bid-project/types';
import {
  getMenuNavigationDecision,
  getProjectSection,
} from './app/projectNavigation';

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('bid-projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [developerMode, setDeveloperMode] = useState(false);
  const leaveGuardRef = useRef<((nextSection?: string) => Promise<boolean>) | null>(null);

  useEffect(() => {
    trackAppOpen();

    void window.yibiao?.config.load()
      .then((config) => {
        setDeveloperMode(Boolean(config?.developer_mode));
        trackConfigUsage({}, config);
      })
      .catch((error) => console.warn('读取开发者模式失败', error));
  }, []);

  useEffect(() => {
    trackPageView(activeSection);
  }, [activeSection]);

  useEffect(() => {
    if (!developerMode && activeSection.startsWith('developer-')) {
      setActiveSection('bid-projects');
    }
  }, [activeSection, developerMode]);

  const requestSectionChange = useCallback(async (section: SectionId) => {
    const decision = getMenuNavigationDecision({
      activeSection,
      requestedSection: section,
      activeProjectId,
    });
    if (!decision.shouldNavigate) {
      return;
    }
    const allowed = section === activeSection
      ? true
      : await (leaveGuardRef.current?.(section) ?? Promise.resolve(true));
    if (allowed) {
      if (decision.shouldCloseActiveProject && activeProjectId) {
        await window.yibiao?.bidProject.close(activeProjectId).catch(() => undefined);
        setActiveProjectId(null);
      }
      setActiveSection(section);
    }
  }, [activeProjectId, activeSection]);

  const openProject = useCallback(async (project: BidProject) => {
    await window.yibiao?.bidProject.open(project.projectId);
    setActiveProjectId(project.projectId);
    setActiveSection(getProjectSection(project.projectType));
  }, []);

  useEffect(() => onAppNavigation(({ section }) => { void requestSectionChange(section); }), [requestSectionChange]);

  return (
    <>
      <GpuHardwareAccelerationPrompt />
      <RequiredOnlineServicesPrompt />
      <AppShell
        activeSection={activeSection}
        developerMode={developerMode}
        onSectionChange={(section) => { void requestSectionChange(section); }}
      >
        <AppRouter
          activeSection={activeSection}
          activeProjectId={activeProjectId}
          developerMode={developerMode}
          onDeveloperModeChange={setDeveloperMode}
          onSectionChange={(section) => { void requestSectionChange(section); }}
          onProjectChange={setActiveProjectId}
          onProjectOpen={openProject}
          registerLeaveGuard={(guard) => {
            leaveGuardRef.current = guard;
          }}
        />
      </AppShell>
    </>
  );
}

export default App;
