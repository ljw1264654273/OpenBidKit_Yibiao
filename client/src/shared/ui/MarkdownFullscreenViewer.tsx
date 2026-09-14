import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';

export interface MarkdownFullscreenViewerProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  contentRef?: Ref<HTMLDivElement>;
  title?: string;
  description?: string;
  buttonLabel?: string;
  disabled?: boolean;
  showFullscreen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  fullscreenClassName?: string;
  fullscreenStyle?: CSSProperties;
  fullscreenChildren?: ReactNode;
  autoScrollToHighlight?: boolean;
  scrollTargetSelector?: string;
}

function MarkdownFullscreenViewer({
  children,
  className = 'markdown-viewer',
  style,
  contentRef,
  title = 'Markdown 全屏预览',
  description = '全屏查看当前 Markdown 内容。',
  buttonLabel = '全屏',
  disabled = false,
  showFullscreen = true,
  open: controlledOpen,
  onOpenChange,
  fullscreenClassName,
  fullscreenStyle,
  fullscreenChildren,
  autoScrollToHighlight = false,
  scrollTargetSelector = '.markdown-highlight',
}: MarkdownFullscreenViewerProps) {
  const normalClassName = className;
  const dialogContentClassName = fullscreenClassName || className || 'markdown-viewer';
  const dialogStyle = fullscreenStyle || style;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const fullscreenContentRef = useRef<HTMLDivElement>(null);
  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (!open || !autoScrollToHighlight) return undefined;
    const timer = window.setTimeout(() => {
      fullscreenContentRef.current?.querySelector(scrollTargetSelector)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [autoScrollToHighlight, open, scrollTargetSelector]);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <div className="markdown-fullscreen-frame">
        <div ref={contentRef} className={normalClassName} style={style}>{children}</div>
        {showFullscreen && (
          <Dialog.Trigger asChild>
            <button type="button" className="markdown-fullscreen-trigger" disabled={disabled} aria-label={buttonLabel} title={buttonLabel}>
              {buttonLabel}
            </button>
          </Dialog.Trigger>
        )}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="markdown-fullscreen-overlay" />
        <Dialog.Content className="markdown-fullscreen-dialog">
          <Dialog.Title className="markdown-fullscreen-title">{title}</Dialog.Title>
          <Dialog.Description className="markdown-fullscreen-description">{description}</Dialog.Description>
          <Dialog.Close className="markdown-fullscreen-close" type="button">退出全屏</Dialog.Close>
          <div ref={fullscreenContentRef} className="markdown-fullscreen-content">
            <div className={dialogContentClassName} style={dialogStyle}>{fullscreenChildren || children}</div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default MarkdownFullscreenViewer;
