import { useEffect, useMemo, useState } from 'react';
import type { OutlineExpansionMode, OutlineItem } from '../../../shared/types';
import { MarkdownFullscreenViewer, MarkdownRenderer, ToolbarArrowLeftIcon, ToolbarArrowRightIcon } from '../../../shared/ui';
import type { ScoreCoverageRecord } from '../types';
import { buildOutlineSourceViewItems } from '../services/outlineSourceMatcher';

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
}

const sourceKindLabels = {
  requirement: '招标要求',
  criterion: '评分标准',
  'response-point': '响应要点',
};

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
}: TenderSourcePanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const coverageSignature = JSON.stringify(coverageRecords);
  const viewModel = useMemo(
    () => selectedItem
      ? buildOutlineSourceViewItems(outline, selectedItem.id, coverageRecords, markdown)
      : { items: [], scope: 'none' as const },
    [coverageRecords, markdown, outline, selectedItem],
  );
  const itemCount = viewModel.items.length;
  const safeActiveIndex = itemCount > 0 ? Math.min(activeIndex, itemCount - 1) : 0;
  const activeItem = viewModel.items[safeActiveIndex];
  const sourceSwitchDisabled = sorting || itemCount <= 1;
  const fullSourceDisabled = sorting || loading || Boolean(error) || !markdown;

  useEffect(() => {
    setActiveIndex(0);
  }, [coverageRecords, coverageSignature, markdown, selectedItem?.id]);

  useEffect(() => {
    if (activeIndex !== safeActiveIndex) {
      setActiveIndex(safeActiveIndex);
    }
  }, [activeIndex, safeActiveIndex]);

  return (
    <section className="outline-source-panel" aria-label="标书原文">
      <header className="outline-source-panel-head">
        <div>
          <strong>标书原文</strong>
          <span aria-live="polite">
            {itemCount > 0 ? `${itemCount} 处 · ${safeActiveIndex + 1}/${itemCount}` : '0 处'}
          </span>
        </div>
        <div className="outline-source-panel-actions">
          <button
            type="button"
            className="outline-source-panel-icon-button"
            aria-label="上一处招标原文"
            title="上一处招标原文"
            disabled={sourceSwitchDisabled || safeActiveIndex === 0}
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
          >
            <ToolbarArrowLeftIcon />
          </button>
          <button
            type="button"
            className="outline-source-panel-icon-button"
            aria-label="下一处招标原文"
            title="下一处招标原文"
            disabled={sourceSwitchDisabled || safeActiveIndex >= itemCount - 1}
            onClick={() => setActiveIndex((index) => Math.min(itemCount - 1, index + 1))}
          >
            <ToolbarArrowRightIcon />
          </button>
          <MarkdownFullscreenViewer
            className="outline-source-panel-fullscreen-viewer"
            title="招标文件原文"
            description="全屏查看当前招标文件 Markdown 原文。"
            buttonLabel="全屏查看招标原文"
            disabled={fullSourceDisabled}
            fullscreenChildren={<MarkdownRenderer allowRawHtml={false}>{markdown}</MarkdownRenderer>}
          >
            <span className="outline-source-panel-fullscreen-placeholder" aria-hidden="true" />
          </MarkdownFullscreenViewer>
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
        ) : !activeItem ? (
          <div className="outline-source-panel-state">
            <strong>当前目录暂无招标原文关联</strong>
          </div>
        ) : activeItem.status === 'unlocated' ? (
          <article className="outline-source-panel-source is-unlocated">
            <p>评分原文，未定位到正文上下文</p>
            <div className="outline-source-panel-source-text">{activeItem.sourceText}</div>
            <span className="outline-source-panel-source-kind">{sourceKindLabels[activeItem.kind]}</span>
          </article>
        ) : (
          <article className="outline-source-panel-source">
            <div className="outline-source-panel-source-text">
              <span>{activeItem.contextBefore}</span>
              <mark>{activeItem.matchedText}</mark>
              <span>{activeItem.contextAfter}</span>
            </div>
            <span className="outline-source-panel-source-kind">{sourceKindLabels[activeItem.kind]}</span>
          </article>
        )}
      </div>
    </section>
  );
}

export default TenderSourcePanel;
