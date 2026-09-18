import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ProgressBar, useToast } from '../../../shared/ui';
import type { OutlineItem, WordExportProgressEvent, WordExportResult } from '../../../shared/types';
import type { ExportFormatConfig, ExportTemplateRecord } from '../../../shared/types/exportFormat';
import { DEFAULT_EXPORT_FORMAT } from '../../../shared/types/exportFormat';
import { buildExportFormatCssVars } from '../../../shared/utils/exportFormatCss';
import { TemplatePreview } from '../pages/ExportFormatPage';
import { countOutlineMermaidDiagrams } from '../services/wordExportUi';

interface ExportProgressState {
  open: boolean;
  running: boolean;
  progress: number;
  message: string;
  warnings: string[];
  mermaidCount: number;
  filePath?: string;
  error?: string;
}

const initialExportProgress: ExportProgressState = {
  open: false,
  running: false,
  progress: 0,
  message: '',
  warnings: [],
  mermaidCount: 0,
};

export interface WordExportDialogProps {
  open: boolean;
  outline?: OutlineItem[] | null;
  onOpenChange: (open: boolean) => void;
  onExport: (payload: { requestId: string; exportFormat: ExportFormatConfig }) => Promise<WordExportResult | undefined>;
  onCreateTemplate?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

function WordExportDialog({
  open,
  outline,
  onOpenChange,
  onExport,
  onCreateTemplate,
  onBusyChange,
}: WordExportDialogProps) {
  const { showToast } = useToast();
  const [exportProgress, setExportProgress] = useState<ExportProgressState>(initialExportProgress);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplateRecord[]>([]);
  const [exportTemplatesLoading, setExportTemplatesLoading] = useState(false);
  const [exportTemplateSearch, setExportTemplateSearch] = useState('');
  const [selectedExportTemplateId, setSelectedExportTemplateId] = useState('');
  const isExporting = exportProgress.running;

  const filteredExportTemplates = useMemo(() => {
    const keyword = exportTemplateSearch.trim().toLowerCase();
    if (!keyword) return exportTemplates;
    return exportTemplates.filter((template) => template.template_name.toLowerCase().includes(keyword));
  }, [exportTemplateSearch, exportTemplates]);

  const selectedExportTemplate = filteredExportTemplates.find((template) => template.template_id === selectedExportTemplateId)
    || filteredExportTemplates[0]
    || null;
  const exportTemplatePreviewStyle = useMemo<CSSProperties>(
    () => buildExportFormatCssVars(selectedExportTemplate?.config || DEFAULT_EXPORT_FORMAT),
    [selectedExportTemplate],
  );

  const loadExportTemplates = useCallback(async () => {
    setExportTemplatesLoading(true);
    try {
      const templates = await window.yibiao?.templates.list();
      const nextTemplates = templates || [];
      setExportTemplates(nextTemplates);
      setSelectedExportTemplateId((previous) => (
        nextTemplates.some((template) => template.template_id === previous)
          ? previous
          : nextTemplates[0]?.template_id || ''
      ));
    } catch (error) {
      setExportTemplates([]);
      setSelectedExportTemplateId('');
      showToast(error instanceof Error ? error.message : '读取导出模板失败', 'error');
    } finally {
      setExportTemplatesLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    setExportTemplateSearch('');
    void loadExportTemplates();
  }, [loadExportTemplates, open]);

  const runExportWord = async (exportFormat: ExportFormatConfig) => {
    const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mermaidCount = countOutlineMermaidDiagrams(outline || []);
    let unsubscribe: (() => void) | undefined;

    try {
      setExportProgress({
        open: true,
        running: true,
        progress: 2,
        message: mermaidCount
          ? `检测到 ${mermaidCount} 张 Mermaid 图，导出时会转换成 Word 图片，可能需要稍等。`
          : '正在准备导出 Word。',
        warnings: [],
        mermaidCount,
      });
      onBusyChange?.(true);

      unsubscribe = window.yibiao?.export.onWordExportProgress((event: WordExportProgressEvent) => {
        if (event.requestId && event.requestId !== requestId) return;

        setExportProgress((previous) => ({
          ...previous,
          open: true,
          running: event.phase === 'running',
          progress: event.progress,
          message: event.message,
          warnings: event.warnings || previous.warnings,
          error: event.phase === 'error' ? event.message : undefined,
        }));
      });

      const result = await onExport({ requestId, exportFormat });
      if (result?.canceled) {
        setExportProgress(initialExportProgress);
        showToast('已取消导出', 'info');
        return;
      }

      setExportProgress((previous) => ({
        ...previous,
        open: true,
        running: false,
        progress: 100,
        message: result?.message || 'Word 已导出，请打开文档核对图片、表格和版式。',
        warnings: result?.warnings || previous.warnings,
        filePath: result?.path,
      }));
      showToast(result?.message || 'Word 已导出', result?.warnings?.length ? 'info' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出 Word 失败';
      setExportProgress((previous) => ({
        ...previous,
        open: true,
        running: false,
        progress: 100,
        message,
        error: message,
      }));
      showToast(message, 'error');
    } finally {
      unsubscribe?.();
      onBusyChange?.(false);
    }
  };

  const handleOpenExportedFile = async () => {
    if (!exportProgress.filePath) return;

    try {
      await window.yibiao?.export.openFile(exportProgress.filePath);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '打开文件失败', 'error');
    }
  };

  const createExportTemplate = () => {
    if (!onCreateTemplate) {
      showToast('请从左侧菜单进入模板设置新建模板', 'info');
      return;
    }

    onOpenChange(false);
    onCreateTemplate();
  };

  const confirmExportTemplate = async () => {
    if (!selectedExportTemplate) {
      showToast('请先选择导出模板', 'info');
      return;
    }

    onOpenChange(false);
    await runExportWord(selectedExportTemplate.config);
  };

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isExporting) {
            onOpenChange(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-template-select-dialog">
            <div className="export-template-select-head">
              <div>
                <span className="section-kicker">Word 导出</span>
                <Dialog.Title>选择导出模板</Dialog.Title>
                <Dialog.Description>选择一个已保存模板后继续导出。模板样式应用范围保持现有导出逻辑。</Dialog.Description>
              </div>
              <Dialog.Close className="detail-help-close" type="button" aria-label="关闭模板选择" disabled={isExporting}>×</Dialog.Close>
            </div>

            <div className="export-template-select-body">
              <section className="export-template-select-list-panel" aria-label="模板列表">
                <input
                  className="export-template-select-search"
                  type="text"
                  value={exportTemplateSearch}
                  onChange={(event) => setExportTemplateSearch(event.target.value)}
                  placeholder="搜索模板名称"
                />
                <div className="export-template-select-list">
                  {exportTemplatesLoading ? (
                    <div className="export-template-select-empty"><strong>正在读取模板</strong><span>请稍候...</span></div>
                  ) : null}
                  {!exportTemplatesLoading && filteredExportTemplates.length === 0 ? (
                    <div className="export-template-select-empty">
                      <strong>{exportTemplates.length ? '没有匹配模板' : '暂无可用模板'}</strong>
                      <span>{exportTemplates.length ? '请换个关键词搜索，或新建一个模板。' : '请先新建并保存模板，保存后再返回导出。'}</span>
                      <button type="button" className="secondary-action" onClick={createExportTemplate} disabled={isExporting}>新建模板</button>
                    </div>
                  ) : null}
                  {!exportTemplatesLoading && filteredExportTemplates.map((template) => {
                    const selected = selectedExportTemplate?.template_id === template.template_id;
                    return (
                      <button
                        type="button"
                        className={`export-template-select-row${selected ? ' is-active' : ''}`}
                        key={template.template_id}
                        onClick={() => setSelectedExportTemplateId(template.template_id)}
                      >
                        <strong>{template.template_name}</strong>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="export-template-select-preview" aria-label="模板预览">
                {selectedExportTemplate ? (
                  <>
                    <div className="export-template-select-preview-head">
                      <span className="section-kicker">预览</span>
                      <strong>{selectedExportTemplate.template_name}</strong>
                    </div>
                    <TemplatePreview config={selectedExportTemplate.config} previewStyle={exportTemplatePreviewStyle} />
                  </>
                ) : (
                  <div className="export-template-select-preview-empty">
                    <strong>暂无模板预览</strong>
                    <span>选择模板后会在这里显示预览。</span>
                  </div>
                )}
              </section>
            </div>

            <div className="content-regenerate-actions export-template-select-actions">
              <button type="button" className="secondary-action" onClick={createExportTemplate} disabled={isExporting}>新建模板</button>
              <Dialog.Close className="secondary-action" type="button" disabled={isExporting}>取消</Dialog.Close>
              <button
                type="button"
                className="primary-action"
                onClick={() => { void confirmExportTemplate(); }}
                disabled={exportTemplatesLoading || !selectedExportTemplate || isExporting}
              >
                继续导出
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={exportProgress.open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !exportProgress.running) {
            setExportProgress(initialExportProgress);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-progress-card">
            <div className="content-regenerate-card-head">
              <span className="section-kicker">Word 导出</span>
              <Dialog.Title>{exportProgress.running ? '正在导出 Word' : exportProgress.error ? '导出失败' : '导出完成'}</Dialog.Title>
              <Dialog.Description>
                {exportProgress.mermaidCount > 0
                  ? `本次包含 ${exportProgress.mermaidCount} 张 Mermaid 图，导出时会在本地转换成 Word 图片。`
                  : '正在将正文、表格和图片写入 Word 文档。'}
              </Dialog.Description>
            </div>
            <div className="export-progress-body">
              <ProgressBar value={exportProgress.progress} label={`Word 导出进度 ${exportProgress.progress}%`} />
              <p>{exportProgress.message || '正在处理导出任务，请稍候。'}</p>
              {exportProgress.warnings.length > 0 && (
                <div className="export-warning-list">
                  <strong>需要核对</strong>
                  {exportProgress.warnings.slice(0, 4).map((warning) => <small key={warning}>{warning}</small>)}
                  {exportProgress.warnings.length > 4 && <small>还有 {exportProgress.warnings.length - 4} 条内容提示，请打开导出的 Word 核对。</small>}
                </div>
              )}
            </div>
            {!exportProgress.running && (
              <div className="content-regenerate-actions">
                {!exportProgress.error && exportProgress.filePath && (
                  <button className="primary-action" type="button" onClick={() => { void handleOpenExportedFile(); }}>
                    打开文件
                  </button>
                )}
                <Dialog.Close className={exportProgress.filePath && !exportProgress.error ? 'secondary-action' : 'primary-action'} type="button">
                  知道了
                </Dialog.Close>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default WordExportDialog;
