import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

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
  resizableNavigation?: {
    defaultWidth?: number;
    minWidth?: number;
    maxWidth?: number;
    storageKey?: string;
  };
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
  resizableNavigation,
}: AdaptiveTwoPaneWorkspaceProps) {
  const navigationTabId = `${id}-navigation-tab`;
  const contentTabId = `${id}-content-tab`;
  const navigationPanelId = `${id}-navigation-panel`;
  const contentPanelId = `${id}-content-panel`;
  const resizeConfig = useMemo(() => resizableNavigation
    ? {
      defaultWidth: resizableNavigation.defaultWidth ?? 380,
      minWidth: resizableNavigation.minWidth ?? 300,
      maxWidth: resizableNavigation.maxWidth ?? 520,
      storageKey: resizableNavigation.storageKey ?? `yibiao.workspace.${id}.navigation-width`,
    }
    : null, [resizableNavigation?.defaultWidth, resizableNavigation?.maxWidth, resizableNavigation?.minWidth, resizableNavigation?.storageKey]);
  const [navigationWidth, setNavigationWidth] = useState(() => {
    if (!resizeConfig || typeof window === 'undefined') return resizeConfig?.defaultWidth ?? 330;
    const stored = Number(window.localStorage.getItem(resizeConfig.storageKey));
    return Number.isFinite(stored)
      ? Math.min(resizeConfig.maxWidth, Math.max(resizeConfig.minWidth, stored))
      : resizeConfig.defaultWidth;
  });
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!resizeConfig) return;
    window.localStorage.setItem(resizeConfig.storageKey, String(navigationWidth));
  }, [navigationWidth, resizeConfig]);

  const setClampedNavigationWidth = useCallback((width: number) => {
    if (!resizeConfig) return;
    setNavigationWidth(Math.min(resizeConfig.maxWidth, Math.max(resizeConfig.minWidth, Math.round(width))));
  }, [resizeConfig]);

  const startNavigationResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeConfig) return;
    event.preventDefault();
    resizeStartRef.current = { startX: event.clientX, startWidth: navigationWidth };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [navigationWidth, resizeConfig]);

  useEffect(() => {
    if (!resizeConfig) return;
    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setClampedNavigationWidth(start.startWidth + event.clientX - start.startX);
    };
    const stopResize = () => {
      resizeStartRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };
  }, [resizeConfig, setClampedNavigationWidth]);

  const handleSeparatorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!resizeConfig) return;
    const step = event.shiftKey ? 40 : 16;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setClampedNavigationWidth(navigationWidth - step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setClampedNavigationWidth(navigationWidth + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setClampedNavigationWidth(resizeConfig.minWidth);
    } else if (event.key === 'End') {
      event.preventDefault();
      setClampedNavigationWidth(resizeConfig.maxWidth);
    }
  }, [navigationWidth, resizeConfig, setClampedNavigationWidth]);

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
      <div
        className={`adaptive-workspace-grid${resizeConfig ? ' is-resizable' : ''}`}
        style={resizeConfig ? { '--adaptive-navigation-width': `${navigationWidth}px` } as CSSProperties : undefined}
      >
        <div id={navigationPanelId} role="tabpanel" aria-labelledby={navigationTabId} className={`adaptive-workspace-pane is-navigation${activePane === 'navigation' ? ' is-active-pane' : ''}`}>
          {navigation}
        </div>
        {resizeConfig && (
          <div
            className="adaptive-workspace-divider"
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="调整目录宽度"
            aria-valuemin={resizeConfig.minWidth}
            aria-valuemax={resizeConfig.maxWidth}
            aria-valuenow={navigationWidth}
            title="拖动调整目录宽度，使用方向键微调，双击恢复默认宽度"
            onPointerDown={startNavigationResize}
            onKeyDown={handleSeparatorKeyDown}
            onDoubleClick={() => setClampedNavigationWidth(resizeConfig.defaultWidth)}
          />
        )}
        <div id={contentPanelId} role="tabpanel" aria-labelledby={contentTabId} className={`adaptive-workspace-pane is-content${activePane === 'content' ? ' is-active-pane' : ''}`}>
          {content}
        </div>
      </div>
    </section>
  );
}

export default AdaptiveTwoPaneWorkspace;
