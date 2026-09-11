import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { OutlineExpansionMode, OutlineItem } from '../../../shared/types';
import { MarkdownFullscreenViewer, MarkdownRenderer } from '../../../shared/ui';
import type { ScoreCoverageRecord } from '../types';
import { buildOutlineSourceViewItems, injectMarkdownSourceAnchor, injectOutlineSourceAnchorMarkers } from '../services/outlineSourceMatcher';

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

const sourceKindLabels = {
  requirement: '招标要求',
  criterion: '评分标准',
  'response-point': '响应要点',
};

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

function formatChineseSourceIndex(index: number) {
  const value = index + 1;
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value < 10) return digits[value];
  if (value === 10) return '十';
  if (value < 20) return `十${digits[value % 10]}`;
  if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ''}`;
  return String(value);
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
  const markdownHash = useMarkdownHash(markdown);
  const viewModel = useMemo(
    () => selectedItemId
      ? buildOutlineSourceViewItems(outline, selectedItemId, coverageRecords, markdown, markdownHash)
      : { items: [], scope: 'none' as const },
    [coverageRecords, markdown, markdownHash, outline, selectedItemId],
  );
  const itemCount = viewModel.items.length;
  const anchoredFullscreenMarkdown = useMemo(
    () => injectOutlineSourceAnchorMarkers(markdown, viewModel.items),
    [markdown, viewModel.items],
  );
  const fullSourceDisabled = sorting || loading || Boolean(error) || !markdown;

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
          <MarkdownFullscreenViewer
            className="outline-source-panel-fullscreen-viewer"
            fullscreenClassName="markdown-viewer outline-source-panel-fullscreen-viewer"
            title="招标文件原文"
            description="全屏查看当前招标文件 Markdown 原文。"
            buttonLabel="全屏查看招标原文"
            disabled={fullSourceDisabled}
            autoScrollToHighlight={viewModel.items.some((item) => item.status === 'located')}
            scrollTargetSelector="[data-outline-source-anchor='primary-start']"
            fullscreenChildren={<MarkdownRenderer allowRawHtml highlightSourceAnchor="primary">{anchoredFullscreenMarkdown}</MarkdownRenderer>}
          >
            <span className="outline-source-panel-fullscreen-placeholder" aria-hidden="true" />
          </MarkdownFullscreenViewer>
          {headerAction}
        </div>
      </header>

      {sorting && (
        <p className="outline-source-panel-notice">目录顺序尚未保存，保存后更新原文关联</p>
      )}

      <div className="outline-source-panel-body">
        {!selectedItem ? (
          <div className="outline-source-panel-state">
            <strong>请选择目录查看关联招标原文</strong>
          </div>
        ) : error ? (
          <div className="outline-source-panel-state is-error">
            <strong>读取招标原文失败</strong>
            <p>{error}</p>
            <button type="button" className="text-button" onClick={onRetry}>重试</button>
          </div>
        ) : loading ? (
          <div className="outline-source-panel-state">
            <strong>正在读取招标原文...</strong>
          </div>
        ) : outlineExpansionMode === 'original-only' && viewModel.scope === 'none' ? (
          <div className="outline-source-panel-state">
            <strong>当前目录来自原方案，暂无招标原文关联</strong>
          </div>
        ) : viewModel.supplementKind === 'professional' ? (
          <div className="outline-source-panel-state">
            <strong>当前目录仅包含专业补充内容，暂无招标原文关联</strong>
          </div>
        ) : viewModel.supplementKind === 'user' ? (
          <div className="outline-source-panel-state">
            <strong>当前目录仅包含用户补充内容，暂无招标原文关联</strong>
          </div>
        ) : !viewModel.items.length ? (
          <div className="outline-source-panel-state">
            <strong>当前目录暂无招标原文关联</strong>
          </div>
        ) : (
          <div className="outline-source-panel-source-list">
            {viewModel.items.map((item, index) => {
              const itemMarkdown = item.status === 'unlocated'
                ? item.sourceText
                : `${item.contextBefore}${item.matchedText}${item.contextAfter}`;
              const anchoredItemMarkdown = item.status === 'located'
                ? injectMarkdownSourceAnchor(
                  itemMarkdown,
                  item.contextBefore.length,
                  item.contextBefore.length + item.matchedText.length,
                )
                : itemMarkdown;
              return (
                <article className={`outline-source-panel-source-block${item.status === 'unlocated' ? ' is-unlocated' : ''}`} key={item.sourceId}>
                  <header className="outline-source-panel-source-head">
                    <strong>第{formatChineseSourceIndex(index)}条</strong>
                    <span className={`is-${item.kind}`}>{sourceKindLabels[item.kind]}</span>
                  </header>
                  {item.status === 'unlocated' && (
                    <p className="outline-source-panel-unlocated-notice">
                      {item.locationReason === 'ambiguous'
                        ? '原文存在多处相同内容，未自动标注，以下为已保存原文'
                        : item.locationReason === 'stale-anchor'
                          ? '招标原文已变化，原定位失效，以下为已保存原文'
                          : '未能在当前招标原文中唯一定位，以下为已保存原文'}
                    </p>
                  )}
                  <div className="outline-source-panel-source-text markdown-viewer">
                    <MarkdownRenderer allowRawHtml highlightSourceAnchor={item.status === 'located' ? 'primary' : undefined}>{normalizeTableFragments(anchoredItemMarkdown)}</MarkdownRenderer>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default TenderSourcePanel;
