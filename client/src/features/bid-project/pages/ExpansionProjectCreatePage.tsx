import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineSpinner, MarkdownRenderer, UploadBoard, UploadEmpty, UploadFilePill, UploadRow, useToast } from '../../../shared/ui';
import type { BidProject, ExpansionImportDocumentPreview, ExpansionProjectImportPreview } from '../types';
import {
  canCreateExpansionProject,
  confirmExpansionImport,
  discardExpansionImport,
  getExpansionProjectDefaultName,
  getFilePathsFromFileList,
  prepareExpansionImport,
} from '../services/expansionProjectCreate';

interface ExpansionProjectCreatePageProps {
  onProjectCreated: (project: BidProject) => void;
  onBack: () => void;
}

type FileKind = 'tender' | 'originalPlan';

interface SelectedFile {
  fileName: string;
  filePath: string;
  size?: number;
  modifiedAt?: string;
}

const emptyPreview: ExpansionProjectImportPreview = {
  success: false,
  canceled: false,
  token: null,
  tender: {
    success: false,
    requestedCount: 0,
    documents: [],
    errors: [],
  },
  originalPlan: {
    success: false,
    message: '请上传已有标书或原方案',
  },
};

function formatFileSize(size?: number) {
  if (!Number.isFinite(size) || !size || size < 1024) return `${Math.max(0, size || 0)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedAt(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function fileBadge(fileName: string) {
  const extension = fileName.split('.').pop()?.toUpperCase();
  return extension && extension.length <= 5 ? extension : 'FILE';
}

function isSuccessDocument(document: ExpansionImportDocumentPreview): document is Extract<ExpansionImportDocumentPreview, { success: true }> {
  return document.success === true;
}

function getSuccessfulTenderDocuments(preview: ExpansionProjectImportPreview) {
  return preview.tender.documents.filter(isSuccessDocument);
}

function getSelectedFileName(files: SelectedFile[]) {
  return files.length === 1 ? files[0].fileName : `${files.length} 个文件`;
}

function ExpansionProjectCreatePage({ onProjectCreated, onBack }: ExpansionProjectCreatePageProps) {
  const { showToast } = useToast();
  const [tenderFiles, setTenderFiles] = useState<SelectedFile[]>([]);
  const [originalPlanFiles, setOriginalPlanFiles] = useState<SelectedFile[]>([]);
  const [preview, setPreview] = useState<ExpansionProjectImportPreview>(emptyPreview);
  const [projectName, setProjectName] = useState('扩写项目');
  const [busyKind, setBusyKind] = useState<FileKind | 'creating' | null>(null);
  const tokenRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const clearStagedImport = useCallback(async () => {
    const token = tokenRef.current;
    tokenRef.current = null;
    if (!token) return;
    await discardExpansionImport(token).catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      const token = tokenRef.current;
      tokenRef.current = null;
      if (token) void discardExpansionImport(token).catch(() => undefined);
    };
  }, []);

  const prepareImport = useCallback(async (nextTenderFiles: SelectedFile[], nextOriginalPlanFiles: SelectedFile[], kind: FileKind) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusyKind(kind);
    await clearStagedImport();
    if (mountedRef.current && requestId === requestIdRef.current) {
      setPreview(emptyPreview);
    }

    try {
      const result = await prepareExpansionImport(
        nextTenderFiles.map((file) => file.filePath),
        nextOriginalPlanFiles.map((file) => file.filePath),
      );
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        if (result.token) await discardExpansionImport(result.token).catch(() => undefined);
        return;
      }
      setPreview(result);
      tokenRef.current = result.token;
      if (result.success) setProjectName(getExpansionProjectDefaultName(result));
    } catch (error) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setPreview({
          ...emptyPreview,
          message: error instanceof Error ? error.message : '解析文件失败',
        });
        showToast(error instanceof Error ? error.message : '解析文件失败', 'error');
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setBusyKind(null);
    }
  }, [clearStagedImport, showToast]);

  const selectFiles = useCallback(async (kind: FileKind, filePaths?: string[]) => {
    if (busyKind) return;
    const multiple = kind === 'tender';
    const selected = await window.yibiao?.file.selectDuplicateCheckFiles({ multiple, filePaths });
    if (!selected?.success || !selected.files?.length) {
      if (selected?.message && selected.message !== '已取消选择') showToast(selected.message, 'error');
      return;
    }

    const files = selected.files.map((file) => ({
      fileName: file.file_name,
      filePath: file.file_path,
      size: file.size,
      modifiedAt: file.modified_at,
    }));
    const nextTenderFiles = kind === 'tender' ? files : tenderFiles;
    const nextOriginalPlanFiles = kind === 'originalPlan' ? files.slice(0, 1) : originalPlanFiles;
    if (kind === 'tender') setTenderFiles(files);
    else setOriginalPlanFiles(files.slice(0, 1));
    await prepareImport(nextTenderFiles, nextOriginalPlanFiles, kind);
  }, [busyKind, originalPlanFiles, prepareImport, showToast, tenderFiles]);

  const handleDrop = useCallback((kind: FileKind, files: FileList) => {
    const paths = getFilePathsFromFileList(files);
    if (!paths.length) {
      showToast('无法读取拖入文件的本地路径，请改用选择文件', 'error');
      return;
    }
    void selectFiles(kind, paths);
  }, [selectFiles, showToast]);

  const removeFiles = useCallback(async (kind: FileKind) => {
    if (busyKind) return;
    requestIdRef.current += 1;
    await clearStagedImport();
    const nextTenderFiles = kind === 'tender' ? [] : tenderFiles;
    const nextOriginalPlanFiles = kind === 'originalPlan' ? [] : originalPlanFiles;
    if (kind === 'tender') setTenderFiles([]);
    else setOriginalPlanFiles([]);
    await prepareImport(nextTenderFiles, nextOriginalPlanFiles, kind);
  }, [busyKind, clearStagedImport, originalPlanFiles, prepareImport, tenderFiles]);

  const handleCreate = async () => {
    if (!canCreateExpansionProject(preview) || !preview.token || busyKind) return;
    const token = preview.token;
    setBusyKind('creating');
    try {
      const project = await confirmExpansionImport(token, { projectName: projectName.trim() || '扩写项目' });
      tokenRef.current = null;
      onProjectCreated(project);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建扩写项目失败', 'error');
      setBusyKind(null);
    }
  };

  const parsedTenderDocuments = getSuccessfulTenderDocuments(preview);
  const parsedOriginalPlan = isSuccessDocument(preview.originalPlan) ? preview.originalPlan : null;
  const canCreate = canCreateExpansionProject(preview) && !busyKind;

  return (
    <div className="expansion-create-page">
      <header className="expansion-create-head">
        <div>
          <span className="section-kicker">已有方案扩写</span>
          <h1>新建扩写项目</h1>
          <p>上传招标文件和已有标书，创建一份独立的扩写项目。</p>
        </div>
        <button type="button" className="secondary-action" onClick={onBack} disabled={Boolean(busyKind)}>
          返回我的标书
        </button>
      </header>

      <UploadBoard
        className="expansion-create-upload-board"
        kicker="STEP 01"
        title="准备扩写素材"
        subtitle="两类文件都会复制并解析到新项目中，原文件不会被修改。"
        aside={<span className="expansion-create-requirement">招标文件可多份，原方案限一份</span>}
      >
        <UploadRow
          index="01"
          title="招标文件"
          note="必选，可多份"
          onDropFiles={(files) => handleDrop('tender', files)}
          dropDisabled={Boolean(busyKind)}
          actions={(
            <>
              <button type="button" className="secondary-action" onClick={() => { void selectFiles('tender'); }} disabled={Boolean(busyKind)}>
                选择文件
              </button>
              {tenderFiles.length ? (
                <button type="button" className="text-button danger-text" onClick={() => { void removeFiles('tender'); }} disabled={Boolean(busyKind)}>
                  清空
                </button>
              ) : null}
            </>
          )}
        >
          {tenderFiles.length ? (
            <div className="upload-file-list">
              {tenderFiles.map((file) => (
                <UploadFilePill
                  key={file.filePath}
                  badge={fileBadge(file.fileName)}
                  name={file.fileName}
                  meta={[formatFileSize(file.size), formatModifiedAt(file.modifiedAt)].filter(Boolean).join(' · ')}
                />
              ))}
            </div>
          ) : (
            <UploadEmpty title="还没有招标文件" hint="拖入一份或多份本地招标文件，作为扩写依据。" />
          )}
        </UploadRow>

        <UploadRow
          index="02"
          title="已有标书 / 原方案"
          note="必选，仅一份"
          onDropFiles={(files) => handleDrop('originalPlan', files)}
          dropDisabled={Boolean(busyKind)}
          actions={(
            <>
              <button type="button" className="secondary-action" onClick={() => { void selectFiles('originalPlan'); }} disabled={Boolean(busyKind)}>
                选择文件
              </button>
              {originalPlanFiles.length ? (
                <button type="button" className="text-button danger-text" onClick={() => { void removeFiles('originalPlan'); }} disabled={Boolean(busyKind)}>
                  清空
                </button>
              ) : null}
            </>
          )}
        >
          {originalPlanFiles.length ? (
            <div className="upload-file-list">
              <UploadFilePill
                badge={fileBadge(originalPlanFiles[0].fileName)}
                name={originalPlanFiles[0].fileName}
                meta={[formatFileSize(originalPlanFiles[0].size), formatModifiedAt(originalPlanFiles[0].modifiedAt)].filter(Boolean).join(' · ')}
              />
            </div>
          ) : (
            <UploadEmpty title="还没有原方案" hint="上传需要扩写的本地标书或方案文档。" />
          )}
        </UploadRow>
      </UploadBoard>

      <section className="expansion-create-preview" aria-live="polite">
        <div className="expansion-create-preview-head">
          <div>
            <span className="section-kicker">解析预览</span>
            <h2>确认文件内容</h2>
          </div>
          {busyKind && busyKind !== 'creating' ? <span className="expansion-create-status"><InlineSpinner />正在解析文件...</span> : null}
        </div>
        {preview.message ? <div className="expansion-create-error">{preview.message}</div> : null}
        {preview.tender.errors.length ? (
          <div className="expansion-create-error">
            <strong>招标文件有解析问题</strong>
            {preview.tender.errors.map((error) => <span key={error}>{error}</span>)}
          </div>
        ) : null}
        <div className="expansion-create-preview-grid">
          <PreviewDocumentGroup
            title="招标文件"
            countLabel={tenderFiles.length ? `${parsedTenderDocuments.length} / ${tenderFiles.length} 份解析成功` : '尚未选择'}
            documents={parsedTenderDocuments}
            emptyMessage={tenderFiles.length ? '招标文件尚未解析成功。' : '选择招标文件后，这里会显示解析摘要。'}
          />
          <PreviewDocumentGroup
            title="已有标书 / 原方案"
            countLabel={parsedOriginalPlan ? '解析成功' : originalPlanFiles.length ? '尚未解析成功' : '尚未选择'}
            documents={parsedOriginalPlan ? [parsedOriginalPlan] : []}
            emptyMessage={originalPlanFiles.length ? '原方案尚未解析成功。' : '选择原方案后，这里会显示解析摘要。'}
          />
        </div>
      </section>

      <section className="expansion-create-submit">
        <label>
          <span>项目名称</span>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="例如：智慧园区项目扩写"
            disabled={Boolean(busyKind)}
          />
        </label>
        <div className="expansion-create-submit-actions">
          <span>{canCreate ? '文件已准备完成，可以创建独立扩写项目。' : '请先完成招标文件和原方案的解析。'}</span>
          <button type="button" className="primary-action" onClick={() => { void handleCreate(); }} disabled={!canCreate}>
            {busyKind === 'creating' ? <><InlineSpinner />正在创建...</> : '创建扩写项目'}
          </button>
        </div>
      </section>
    </div>
  );
}

interface PreviewDocumentGroupProps {
  title: string;
  countLabel: string;
  documents: Array<Extract<ExpansionImportDocumentPreview, { success: true }>>;
  emptyMessage: string;
}

function PreviewDocumentGroup({ title, countLabel, documents, emptyMessage }: PreviewDocumentGroupProps) {
  return (
    <article className="expansion-create-preview-group">
      <header>
        <div>
          <strong>{title}</strong>
          <span>{countLabel}</span>
        </div>
      </header>
      {documents.length ? (
        <div className="expansion-create-documents">
          {documents.map((document) => (
            <div className="expansion-create-document" key={`${document.fileName}-${document.fileHash}`}>
              <div className="expansion-create-document-meta">
                <div className="expansion-create-document-icon">{fileBadge(document.fileName)}</div>
                <div>
                  <strong title={document.fileName}>{document.fileName}</strong>
                  <span>{[document.parserLabel || '未知解析方式', `${document.markdownChars.toLocaleString('zh-CN')} 字`, formatFileSize(document.size)].join(' · ')}</span>
                </div>
              </div>
              <div className="expansion-create-markdown-preview">
                <MarkdownRenderer allowRawHtml={false}>{document.contentPreview || '解析成功，但没有可预览的正文摘要。'}</MarkdownRenderer>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="expansion-create-preview-empty">{emptyMessage}</div>
      )}
    </article>
  );
}

export default ExpansionProjectCreatePage;
