import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { OutlineExpansionMode, OutlineItem } from '../../../shared/types';
import { MarkdownRenderer, ToolbarArrowLeftIcon, ToolbarArrowRightIcon } from '../../../shared/ui';
import type { ScoreCoverageRecord } from '../types';
import { buildOutlineSourceViewItems, injectOutlineSourceAnchorMarkers } from '../services/outlineSourceMatcher';

export interface TenderSourcePanelProps {
  selectedItem: OutlineItem | null;
  outline: OutlineItem[];
  coverageRecords: ScoreCoverageRecord[];
  outlineExpansionMode: OutlineExpansionMode;
  markdown: string;
  loading: boolean;
  error: string;
  sorting: boolean;
  onRetry: () => void;
  headerAction?: ReactNode;
}

function useMarkdownHash(markdown: string) {
  const [result, setResult] = useState({ markdown: '', hash: '' });
  useEffect(() => {
    let cancelled = false;
    if (!markdown) {
      setResult({ markdown: '', hash: '' });
      return undefined;
    }
    setResult({ markdown: '', hash: '' });
    void window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(markdown)).then((digest) => {
      if (cancelled) return;
      setResult({
        markdown,
        hash: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''),
      });
    }).catch(() => {
      if (!cancelled) setResult({ markdown: '', hash: '' });
    });
    return () => { cancelled = true; };
  }, [markdown]);
  return result.markdown === markdown ? result.hash : '';
}

function normalizeTableFragments(markdown: string) {
  const value = String(markdown || '');
  if (!/<(?:tr|td|th)\b/i.test(value) || /<table\b/i.test(value)) return value;
  return value
    .replace(/((?:<tr\b[\s\S]*?<\/tr>\s*)+)/gi, '<table><tbody>$1</tbody></table>')
    .replace(/((?:<(?:td|th)\b[\s\S]*?<\/(?:td|th)>\s*)+)/gi, '<table><tbody><tr>$1</tr></tbody></table>');
}

function TenderSourcePanel({
  selectedItem,
  outline,
  coverageRecords,
  outlineExpansionMode,
  markdown,
  loading,
  error,
  sorting,
  onRetry,
  headerAction,
}: TenderSourcePanelProps) {
  const selectedItemId = selectedItem?.id;
  const sourceBodyRef = useRef<HTMLDivElement | null>(null);
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const markdownHash = useMarkdownHash(markdown);
  const viewModel = useMemo(
    () => selectedItemId
      ? buildOutlineSourceViewItems(outline, selectedItemId, coverageRecords, markdown, markdownHash)
      : { items: [], scope: 'none' as const },
    [coverageRecords, markdown, markdownHash, outline, selectedItemId],
  );
  const itemCount = viewModel.items.length;
  const locatedItems = useMemo(
    () => viewModel.items.filter((item) => item.status === 'located'),
    [viewModel.items],
  );
  const sourceSignature = viewModel.items.map((item) => `${item.sourceId}:${item.status}:${item.matchStart ?? ''}:${item.matchEnd ?? ''}`).join('|');
  const safeActiveSourceIndex = locatedItems.length > 0
    ? Math.min(activeSourceIndex, locatedItems.length - 1)
    : -1;
  const activeSourceItem = safeActiveSourceIndex >= 0 ? locatedItems[safeActiveSourceIndex] : undefined;
  const anchoredMarkdown = useMemo(
    () => injectOutlineSourceAnchorMarkers(markdown, locatedItems, safeActiveSourceIndex),
    [locatedItems, markdown, safeActiveSourceIndex],
  );
  useEffect(() => {
    setActiveSourceIndex(0);
  }, [selectedItemId, sourceSignature]);

  useEffect(() => {
    if (!locatedItems.length || safeActiveSourceIndex < 0) return undefined;
    const timer = window.setTimeout(() => {
      sourceBodyRef.current?.querySelector('[data-outline-source-anchor="primary-start"]')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [anchoredMarkdown, locatedItems.length, safeActiveSourceIndex]);

  const associationNotice = selectedItem && !itemCount
    ? viewModel.supplementKind === 'professional'
      ? '当前目录仅包含专业补充内容，暂无招标原文关联'
      : viewModel.supplementKind === 'user'
        ? '当前目录仅包含用户补充内容，暂无招标原文关联'
        : outlineExpansionMode === 'original-only' && viewModel.scope === 'none'
          ? '当前目录来自原方案，暂无招标原文关联'
          : '当前目录暂无招标原文关联'
    : viewModel.items.some((item) => item.status === 'unlocated')
      ? `有 ${viewModel.items.filter((item) => item.status === 'unlocated').length} 条来源未能在当前原文中唯一定位`
      : '';

  return (
    <section className="outline-source-panel" aria-label="标书原文">
      <header className="outline-source-panel-head">
        <div>
          <strong>标书原文</strong>
          <span aria-live="polite">
            {itemCount > 0 ? `共 ${itemCount} 条关联来源` : '0 条'}
          </span>
        </div>
        <div className="outline-source-panel-actions">
          {locatedItems.length > 1 && (
            <div className="outline-source-panel-source-nav" role="group" aria-label="关联招标原文导航">
              <button
                type="button"
                className="outline-source-panel-icon-button"
                aria-label="上一处招标原文"
                title="上一处招标原文"
                disabled={safeActiveSourceIndex <= 0}
                onClick={() => setActiveSourceIndex((index) => Math.max(0, index - 1))}
              >
                <ToolbarArrowLeftIcon />
              </button>
              <span aria-live="polite">{safeActiveSourceIndex + 1} / {locatedItems.length}</span>
              <button
                type="button"
                className="outline-source-panel-icon-button"
                aria-label="下一处招标原文"
                title="下一处招标原文"
                disabled={safeActiveSourceIndex >= locatedItems.length - 1}
                onClick={() => setActiveSourceIndex((index) => Math.min(locatedItems.length - 1, index + 1))}
              >
                <ToolbarArrowRightIcon />
              </button>
            </div>
          )}
          {headerAction}
        </div>
      </header>

      {sorting && (
        <p className="outline-source-panel-notice">目录顺序尚未保存，保存后更新原文关联</p>
      )}

      <div className="outline-source-panel-body">
        {error ? (
          <div className="outline-source-panel-state is-error">
            <strong>读取招标原文失败</strong>
            <p>{error}</p>
            <button type="button" className="text-button" onClick={onRetry}>重试</button>
          </div>
        ) : loading ? (
          <div className="outline-source-panel-state">
            <strong>正在读取招标原文...</strong>
          </div>
        ) : !markdown ? (
          <div className="outline-source-panel-state">
            <strong>暂无招标文件原文</strong>
          </div>
        ) : (
          <div ref={sourceBodyRef} className="outline-source-panel-document markdown-viewer">
            {associationNotice && <p className="outline-source-panel-association-notice">{associationNotice}</p>}
            <MarkdownRenderer allowRawHtml highlightSourceAnchor={activeSourceItem ? 'primary' : undefined} preserveTableCellSpans>
              {normalizeTableFragments(anchoredMarkdown)}
            </MarkdownRenderer>
          </div>
        )}
      </div>
    </section>
  );
}

export default TenderSourcePanel;
