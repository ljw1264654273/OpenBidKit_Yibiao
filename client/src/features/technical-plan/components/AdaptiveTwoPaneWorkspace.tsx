import type { ReactNode } from 'react';

export type WorkspacePane = 'navigation' | 'content';

interface AdaptiveTwoPaneWorkspaceProps {
  id: string;
  className?: string;
  navigationLabel: string;
  contentLabel: string;
  activePane: WorkspacePane;
  onPaneChange: (pane: WorkspacePane) => void;
  navigation: ReactNode;
  content: ReactNode;
}

function AdaptiveTwoPaneWorkspace({
  id,
  className,
  navigationLabel,
  contentLabel,
  activePane,
  onPaneChange,
  navigation,
  content,
}: AdaptiveTwoPaneWorkspaceProps) {
  const navigationTabId = `${id}-navigation-tab`;
  const contentTabId = `${id}-content-tab`;
  const navigationPanelId = `${id}-navigation-panel`;
  const contentPanelId = `${id}-content-panel`;

  return (
    <section className={`adaptive-workspace-shell${className ? ` ${className}` : ''}`}>
      <div className="adaptive-workspace-tabs" role="tablist" aria-label={`${navigationLabel}与${contentLabel}`}>
        <button type="button" id={navigationTabId} role="tab" aria-selected={activePane === 'navigation'} aria-controls={navigationPanelId} onClick={() => onPaneChange('navigation')}>
          {navigationLabel}
        </button>
        <button type="button" id={contentTabId} role="tab" aria-selected={activePane === 'content'} aria-controls={contentPanelId} onClick={() => onPaneChange('content')}>
          {contentLabel}
        </button>
      </div>
      <div className="adaptive-workspace-grid">
        <div id={navigationPanelId} role="tabpanel" aria-labelledby={navigationTabId} className={`adaptive-workspace-pane is-navigation${activePane === 'navigation' ? ' is-active-pane' : ''}`}>
          {navigation}
        </div>
        <div id={contentPanelId} role="tabpanel" aria-labelledby={contentTabId} className={`adaptive-workspace-pane is-content${activePane === 'content' ? ' is-active-pane' : ''}`}>
          {content}
        </div>
      </div>
    </section>
  );
}

export default AdaptiveTwoPaneWorkspace;
