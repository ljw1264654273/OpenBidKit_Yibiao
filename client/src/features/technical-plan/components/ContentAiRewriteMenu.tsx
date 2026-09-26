import * as Popover from '@radix-ui/react-popover';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { MarkdownEditorSelection } from '../../../shared/ui/MarkdownEditor';

export type ContentAiRewriteMode = 'rewrite' | 'continue' | 'image';

interface ContentAiRewriteMenuProps {
  selection: MarkdownEditorSelection | null;
  disabled?: boolean;
  compact?: boolean;
  onSelect: (mode: ContentAiRewriteMode) => void;
}

function ContentAiRewriteMenu({ selection, disabled = false, compact = false, onSelect }: ContentAiRewriteMenuProps) {
  const [open, setOpen] = useState(false);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasSelection = Boolean(selection && selection.end > selection.start);
  const hasCursor = Boolean(selection);
  const disabledTitle = disabled ? '正文生成任务进行中或当前为预览模式' : !hasCursor ? '请先点击正文编辑区' : '';
  const choose = (mode: ContentAiRewriteMode) => {
    setOpen(false);
    onSelect(mode);
  };
  const focusOption = (direction: 1 | -1) => {
    const enabled = optionRefs.current.filter((item): item is HTMLButtonElement => Boolean(item && !item.disabled));
    if (!enabled.length) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    enabled[(current + direction + enabled.length) % enabled.length]?.focus();
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(-1);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={compact ? 'content-ai-rewrite-trigger is-compact' : 'secondary-action content-ai-rewrite-trigger'}
          disabled={disabled}
          title={disabledTitle || (hasSelection ? '改写选中内容' : '从光标处续写')}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !disabled) {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() => focusOption(event.key === 'ArrowDown' ? 1 : -1));
            }
          }}
        >
          <span aria-hidden="true">✦</span>
          AI改写
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="content-ai-rewrite-menu" align="end" sideOffset={7} collisionPadding={12} onKeyDown={handleMenuKeyDown}>
          <button ref={(element) => { optionRefs.current[0] = element; }} type="button" disabled={!hasSelection} className={hasSelection ? 'is-primary' : ''} onClick={() => choose('rewrite')}>
            <strong>改写选中内容</strong>
            <span>{hasSelection ? `已选择 ${selection!.end - selection!.start} 个字符` : '请先选择纯正文内容'}</span>
          </button>
          <button ref={(element) => { optionRefs.current[1] = element; }} type="button" disabled={!hasCursor} className={!hasSelection && hasCursor ? 'is-primary' : ''} onClick={() => choose('continue')}>
            <strong>从光标处续写</strong>
            <span>在当前位置补充正文，不修改前后内容</span>
          </button>
          <button ref={(element) => { optionRefs.current[2] = element; }} type="button" disabled={!hasCursor} onClick={() => choose('image')}>
            <strong>在光标处插入图片</strong>
            <span>支持 AI、本地文件、拖放和剪贴板</span>
          </button>
          <Popover.Arrow className="content-ai-rewrite-menu-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default ContentAiRewriteMenu;
