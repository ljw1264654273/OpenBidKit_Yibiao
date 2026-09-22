const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getWorkspaceDir, getWorkspaceTrashDir } = require('../utils/paths.cjs');
const { forceRemoveSync } = require('../utils/forceRemove.cjs');

const EXPANSION_IMPORT_KIND = 'existing-plan-expansion';
const EXPANSION_IMPORT_TTL_MS = 30 * 60 * 1000;
const IMPORT_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_PREVIEW_LENGTH = 500;

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeFileName(value) {
  return String(value || '招标文件').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '招标文件';
}

function normalizeFilePaths(value) {
  return (Array.isArray(value) ? value : [])
    .map((filePath) => String(filePath || '').trim())
    .filter(Boolean);
}

function isAbsoluteLocalFilePath(filePath) {
  return path.isAbsolute(String(filePath || '').trim());
}

function normalizeImportErrors(result, fallbackMessage) {
  const errors = Array.isArray(result?.errors)
    ? result.errors.map((error) => String(error || '').trim()).filter(Boolean)
    : [];
  if (!result?.success && !errors.length && fallbackMessage) {
    errors.push(String(fallbackMessage));
  }
  return errors;
}

function isImportCanceled(result) {
  return result?.canceled === true
    || (result?.success === false && String(result?.message || '').trim() === '已取消选择');
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function isValidSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function createEmptyOriginalPlanPreview(message) {
  return {
    success: false,
    message: message || '未导入原方案',
  };
}

function createBidProjectImportService({ app, fileService, bidProjectManager, workflowAnalytics }) {
  const importsDir = path.join(getWorkspaceDir(app), 'bid-project-imports');
  const workspaceTrashDir = getWorkspaceTrashDir(app);
  fs.mkdirSync(importsDir, { recursive: true });

  function getImportDir(token) {
    return path.join(importsDir, String(token || '').replace(/[^a-zA-Z0-9_-]/g, ''));
  }

  function removeImportDir(token) {
    forceRemoveSync(getImportDir(token), {
      trashDir: workspaceTrashDir,
      deferOnFailure: true,
    });
  }

  function isValidExpansionDocument(document, tokenDir) {
    if (!document || typeof document !== 'object') return false;
    const requiredFields = [
      'fileName',
      'parserLabel',
      'fileHash',
      'contentHash',
      'contentPreview',
      'markdownChars',
      'size',
      'modifiedAt',
      'content',
      'stagedPath',
    ];
    if (requiredFields.some((field) => !hasOwn(document, field))) return false;
    if (typeof document.fileName !== 'string' || !document.fileName.trim()) return false;
    if (!(typeof document.parserLabel === 'string' || document.parserLabel === null)) return false;
    if (!isValidSha256(document.fileHash) || !isValidSha256(document.contentHash)) return false;
    if (typeof document.content !== 'string' || !document.content.length) return false;
    if (typeof document.contentPreview !== 'string'
      || document.contentPreview !== document.content.slice(0, CONTENT_PREVIEW_LENGTH)) {
      return false;
    }
    if (!Number.isInteger(document.markdownChars)
      || document.markdownChars < 1
      || document.markdownChars !== document.content.length) {
      return false;
    }
    if (!Number.isInteger(document.size) || document.size < 0) return false;
    if (!Number.isFinite(parseDate(document.modifiedAt))) return false;
    if (typeof document.stagedPath !== 'string' || !path.isAbsolute(document.stagedPath)) return false;

    const resolvedTokenDir = path.resolve(tokenDir);
    const resolvedStagedPath = path.resolve(document.stagedPath);
    if (resolvedStagedPath !== resolvedTokenDir
      && !resolvedStagedPath.startsWith(`${resolvedTokenDir}${path.sep}`)) {
      return false;
    }

    let stats;
    try {
      stats = fs.statSync(resolvedStagedPath);
    } catch {
      return false;
    }
    if (!stats.isFile() || stats.size !== document.size) return false;
    try {
      return hashFile(resolvedStagedPath) === document.fileHash
        && hashText(document.content) === document.contentHash;
    } catch {
      return false;
    }
  }

  function isValidExpansionMetadata(metadata, expectedToken) {
    const token = String(expectedToken || '').trim();
    if (!metadata
      || typeof metadata !== 'object'
      || !IMPORT_TOKEN_PATTERN.test(token)
      || metadata.token !== token
      || metadata.kind !== EXPANSION_IMPORT_KIND
      || metadata.status !== 'ready'
      || typeof metadata.createdAt !== 'string'
      || typeof metadata.expiresAt !== 'string'
      || !Array.isArray(metadata.tenderDocuments)
      || !metadata.tenderDocuments.length
      || !metadata.originalPlanDocument
      || typeof metadata.originalPlanDocument !== 'object') {
      return false;
    }
    const createdAt = parseDate(metadata.createdAt);
    const expiresAt = Date.parse(metadata.expiresAt);
    if (!Number.isFinite(createdAt)
      || !Number.isFinite(expiresAt)
      || createdAt > expiresAt
      || createdAt > Date.now()
      || expiresAt <= Date.now()) {
      return false;
    }
    const tokenDir = getImportDir(token);
    const documents = [...metadata.tenderDocuments, metadata.originalPlanDocument];
    return documents.every((document) => isValidExpansionDocument(document, tokenDir));
  }

  function cleanupStagedImports() {
    for (const entry of fs.readdirSync(importsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(importsDir, entry.name);
      let shouldRemove = true;
      try {
        const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
        if (metadata.kind === EXPANSION_IMPORT_KIND) {
          shouldRemove = !isValidExpansionMetadata(metadata, entry.name);
        }
      } catch {
        shouldRemove = true;
      }
      if (!shouldRemove) continue;
      try {
        forceRemoveSync(dir, {
          trashDir: workspaceTrashDir,
          deferOnFailure: true,
        });
      } catch {
        // 重启时清理暂存失败不阻断后续导入，下一次启动继续尝试。
      }
    }
  }

  cleanupStagedImports();

  function readImport(token) {
    const dir = getImportDir(token);
    const metadataPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) throw new Error('导入暂存已失效，请重新选择招标文件');
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  function readExpansionImportMetadata(token) {
    if (!IMPORT_TOKEN_PATTERN.test(String(token || '').trim())) {
      throw new Error('扩写导入暂存 token 无效');
    }
    const dir = getImportDir(token);
    const metadataPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('扩写导入暂存已失效，请重新选择文件');
    }
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch {
      throw new Error('扩写导入暂存已损坏，请重新选择文件');
    }
    if (metadata.kind !== EXPANSION_IMPORT_KIND) {
      throw new Error('该 token 不是扩写导入 token');
    }
    if (metadata.status !== 'ready') {
      throw new Error('扩写导入暂存正在处理中或已失效');
    }
    if (!isValidExpansionMetadata(metadata, token)) {
      try {
        removeImportDir(token);
      } catch {
        // 损坏暂存清理失败由下一次启动继续兜底。
      }
      throw new Error('扩写导入暂存已过期或损坏，请重新选择文件');
    }
    return metadata;
  }

  function writeExpansionMetadata(token, metadata) {
    fs.writeFileSync(
      path.join(getImportDir(token), 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
  }

  function buildImportedDocument(document, fallbackPath) {
    const sourcePath = String(document?.source_path || fallbackPath || '').trim();
    const content = String(document?.file_content || '');
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error(`${document?.file_name || path.basename(sourcePath) || '文件'}：本地文件不存在`);
    }
    if (!content.trim()) {
      throw new Error(`${document?.file_name || path.basename(sourcePath)}：未提取到有效 Markdown 内容`);
    }
    const stats = fs.statSync(sourcePath);
    const fileName = safeFileName(document?.file_name || path.basename(sourcePath));
    return {
      success: true,
      fileName,
      parserLabel: document?.parser_label || null,
      fileHash: hashFile(sourcePath),
      contentHash: hashText(content),
      contentPreview: content.slice(0, CONTENT_PREVIEW_LENGTH),
      markdownChars: content.length,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourcePath,
      content,
    };
  }

  function toDocumentPreview(document) {
    if (!document) return createEmptyOriginalPlanPreview();
    const {
      sourcePath,
      stagedPath,
      content,
      ...preview
    } = document;
    return preview;
  }

  function stageImportedDocuments(documents, tokenDir, prefix) {
    const stageDir = path.join(tokenDir, prefix);
    fs.mkdirSync(stageDir, { recursive: true });
    return documents.map((document, index) => {
      const documentDir = documents.length > 1
        ? path.join(stageDir, String(index + 1).padStart(2, '0'))
        : stageDir;
      fs.mkdirSync(documentDir, { recursive: true });
      const stagedPath = path.join(documentDir, safeFileName(document.fileName));
      fs.copyFileSync(document.sourcePath, stagedPath);
      return {
        ...document,
        stagedPath,
      };
    });
  }

  async function importExpansionDocuments(filePaths, { multiple, label }) {
    try {
      const result = await fileService.importDocument({ multiple, filePaths });
      const rawDocuments = Array.isArray(result?.documents) && result.documents.length
        ? result.documents
        : result?.file_content
          ? [result]
          : [];
      const documents = [];
      const errors = normalizeImportErrors(result, result?.message || `未导入${label}`);
      for (let index = 0; index < rawDocuments.length; index += 1) {
        try {
          documents.push(buildImportedDocument(rawDocuments[index], filePaths[index]));
        } catch (error) {
          errors.push(error.message || String(error));
        }
      }
      return {
        result,
        documents,
        errors,
        canceled: isImportCanceled(result),
      };
    } catch (error) {
      return {
        result: null,
        documents: [],
        errors: [error.message || String(error)],
        canceled: false,
      };
    }
  }

  function buildExpansionPreview({
    tenderRequestedCount,
    tenderDocuments,
    tenderErrors,
    originalPlanDocument,
    originalPlanSuccess = false,
    originalPlanMessage,
    success,
    canceled,
    message,
    token = null,
  }) {
    return {
      success,
      canceled,
      message,
      token,
      tender: {
        success: success && tenderErrors.length === 0 && tenderDocuments.length === tenderRequestedCount,
        requestedCount: tenderRequestedCount,
        documents: tenderDocuments.map(toDocumentPreview),
        errors: tenderErrors,
      },
      originalPlan: originalPlanDocument
        ? {
          ...toDocumentPreview(originalPlanDocument),
          success: originalPlanSuccess,
        }
        : createEmptyOriginalPlanPreview(originalPlanMessage),
    };
  }

  async function prepareExpansionImport({
    tenderFilePaths = [],
    originalPlanFilePaths = [],
  } = {}) {
    const tenderPaths = normalizeFilePaths(tenderFilePaths);
    const originalPaths = normalizeFilePaths(originalPlanFilePaths);
    const invalidTenderPath = tenderPaths.find((filePath) => !isAbsoluteLocalFilePath(filePath));
    const invalidOriginalPath = originalPaths.find((filePath) => !isAbsoluteLocalFilePath(filePath));
    if (!tenderPaths.length || originalPaths.length !== 1 || invalidTenderPath || invalidOriginalPath) {
      const message = invalidTenderPath || invalidOriginalPath
        ? '扩写导入只支持本地绝对路径'
        : !tenderPaths.length
          ? '请至少选择一份招标文件'
          : '原方案必须恰好选择一份文件';
      return buildExpansionPreview({
        tenderRequestedCount: tenderPaths.length,
        tenderDocuments: [],
        tenderErrors: [message],
        originalPlanSuccess: false,
        originalPlanMessage: message,
        success: false,
        canceled: false,
        message,
      });
    }

    const tenderOutcome = await importExpansionDocuments(tenderPaths, {
      multiple: true,
      label: '招标文件',
    });
    const originalOutcome = await importExpansionDocuments(originalPaths, {
      multiple: false,
      label: '原方案',
    });
    const canceled = tenderOutcome.canceled || originalOutcome.canceled;
    const tenderSuccess = !canceled
      && tenderOutcome.result?.success === true
      && tenderOutcome.errors.length === 0
      && tenderOutcome.documents.length === tenderPaths.length;
    const originalPlanSuccess = !canceled
      && originalOutcome.result?.success === true
      && originalOutcome.errors.length === 0
      && originalOutcome.documents.length === 1;
    if (!tenderSuccess || !originalPlanSuccess) {
      const message = canceled
        ? '已取消选择'
        : tenderOutcome.errors[0]
          || originalOutcome.errors[0]
          || '文件解析失败';
      return buildExpansionPreview({
        tenderRequestedCount: tenderPaths.length,
        tenderDocuments: tenderOutcome.documents,
        tenderErrors: tenderOutcome.errors,
        originalPlanSuccess: originalPlanSuccess,
        originalPlanDocument: originalOutcome.documents[0],
        originalPlanMessage: originalOutcome.errors[0] || message,
        success: false,
        canceled,
        message,
      });
    }

    const token = crypto.randomUUID();
    const tokenDir = getImportDir(token);
    try {
      fs.mkdirSync(tokenDir, { recursive: true });
      const tenderDocuments = stageImportedDocuments(tenderOutcome.documents, tokenDir, 'tender');
      const originalPlanDocument = stageImportedDocuments([originalOutcome.documents[0]], tokenDir, 'original-plan')[0];
      const createdAt = new Date().toISOString();
      const metadata = {
        token,
        kind: EXPANSION_IMPORT_KIND,
        status: 'ready',
        createdAt,
        expiresAt: new Date(Date.now() + EXPANSION_IMPORT_TTL_MS).toISOString(),
        tenderDocuments,
        originalPlanDocument,
      };
      writeExpansionMetadata(token, metadata);
      return buildExpansionPreview({
        tenderRequestedCount: tenderPaths.length,
        tenderDocuments,
        tenderErrors: [],
        originalPlanSuccess: true,
        originalPlanDocument,
        success: true,
        canceled: false,
        message: '招标文件和原方案解析完成',
        token,
      });
    } catch (error) {
      try {
        removeImportDir(token);
      } catch {
        // 暂存清理失败由下一次启动的过期清理兜底。
      }
      const message = error.message || String(error);
      return buildExpansionPreview({
        tenderRequestedCount: tenderPaths.length,
        tenderDocuments: tenderOutcome.documents,
        tenderErrors: [message],
        originalPlanSuccess: originalPlanSuccess,
        originalPlanDocument: originalOutcome.documents[0],
        originalPlanMessage: message,
        success: false,
        canceled: false,
        message,
      });
    }
  }

  function cleanupCreatedProject(projectId) {
    if (!projectId) return;
    try {
      bidProjectManager.deleteProject(projectId);
    } catch {
      // 保留原始导入错误，项目删除由项目管理器负责幂等清理。
    }
  }

  async function confirmExpansionImport(token, options = {}) {
    const metadata = readExpansionImportMetadata(token);
    metadata.status = 'consuming';
    writeExpansionMetadata(token, metadata);
    let project;
    let workflowOperation;
    try {
      const tenderDocuments = metadata.tenderDocuments;
      const tenderFileName = tenderDocuments.length > 1
        ? `${tenderDocuments.length} 份招标文件`
        : tenderDocuments[0].fileName;
      project = bidProjectManager.createProject({
        projectName: options.projectName || tenderFileName,
        projectType: EXPANSION_IMPORT_KIND,
        sourceFile: {
          fileName: tenderFileName,
          fileHash: hashText(tenderDocuments.map((document) => document.fileHash).join('|')),
          contentHash: hashText(tenderDocuments.map((document) => document.contentHash).join('|')),
          size: tenderDocuments.reduce((sum, document) => sum + Number(document.size || 0), 0),
          modifiedAt: tenderDocuments[0].modifiedAt,
        },
        sourceFiles: tenderDocuments.map((document) => ({
          fileName: document.fileName,
          fileHash: document.fileHash,
          contentHash: document.contentHash,
          size: document.size,
          modifiedAt: document.modifiedAt,
        })),
      });
      workflowOperation = workflowAnalytics?.startOperation({
        operation: 'project_created',
        workflowKind: EXPANSION_IMPORT_KIND,
        projectId: project.projectId,
        projectName: project.projectName,
        sourceFileNames: [
          ...tenderDocuments.map((document) => document.fileName),
          metadata.originalPlanDocument.fileName,
        ],
      });
      const store = bidProjectManager.getTechnicalPlanStore(project.projectId);
      const tenderResult = await store.importTenderDocument(tenderDocuments.map((document) => document.stagedPath));
      if (!tenderResult?.success) {
        throw new Error(tenderResult?.message || '招标文件导入失败');
      }
      const originalPlanResult = await store.importOriginalPlanDocument([metadata.originalPlanDocument.stagedPath]);
      if (!originalPlanResult?.success) {
        throw new Error(originalPlanResult?.message || '原方案导入失败');
      }
      const state = store.loadTechnicalPlan();
      const sourceMetadata = new Map(tenderDocuments.map((document) => [
        `${document.fileName}\u0000${document.contentHash}`,
        document,
      ]));
      bidProjectManager.replaceProjectSourceFiles(project.projectId, (state.tenderFiles || []).map((source) => {
        const matching = sourceMetadata.get(`${source.fileName}\u0000${source.contentHash}`);
        return {
          sourceId: source.id,
          fileName: source.fileName,
          fileHash: matching?.fileHash,
          contentHash: source.contentHash,
          sourceDocxPath: source.sourceDocxPath,
          markdownPath: source.markdownPath,
          size: matching?.size,
          modifiedAt: matching?.modifiedAt,
        };
      }));
      try {
        removeImportDir(token);
      } catch (error) {
        console.warn('[bid-project-import] 扩写导入已提交，但暂存清理失败', {
          token,
          error: error?.message || String(error),
        });
      }
      const openedProject = bidProjectManager.openProject(project.projectId);
      workflowAnalytics?.finishOperation(workflowOperation, 'succeeded');
      return openedProject;
    } catch (error) {
      workflowAnalytics?.finishOperation(workflowOperation, 'failed', { failureCode: 'parse' });
      cleanupCreatedProject(project?.projectId);
      try {
        removeImportDir(token);
      } catch {
        // 暂存清理失败由启动清理兜底，不覆盖本次导入错误。
      }
      throw error;
    }
  }

  function discardExpansionImport(token) {
    if (!IMPORT_TOKEN_PATTERN.test(String(token || '').trim())) {
      return { success: false, message: '扩写导入暂存 token 无效' };
    }
    const normalizedToken = String(token).trim();
    const dir = getImportDir(normalizedToken);
    const metadataPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) return { success: true };
    let metadata;
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    } catch {
      return { success: false, message: '扩写导入暂存已损坏，无法确认类型' };
    }
    if (metadata?.kind !== EXPANSION_IMPORT_KIND) {
      return { success: false, message: '该 token 不是扩写导入 token' };
    }
    if (metadata.status === 'consuming') {
      return { success: false, message: '扩写导入正在处理中，不能丢弃' };
    }
    try {
      removeImportDir(normalizedToken);
    } catch (error) {
      return { success: false, message: error?.message || '扩写导入暂存清理失败' };
    }
    return { success: true };
  }

  async function prepareImport(filePaths) {
    const result = await fileService.importDocument({ multiple: true, filePaths });
    if (!result?.success || !Array.isArray(result.documents) || !result.documents.length) {
      return { success: false, message: result?.message || '未导入招标文件' };
    }
    const token = crypto.randomUUID();
    const dir = getImportDir(token);
    fs.mkdirSync(dir, { recursive: true });
    const documents = result.documents.map((document, index) => {
      const sourcePath = String(document.source_path || '').trim();
      const fileName = safeFileName(document.file_name || `招标文件${index + 1}`);
      const stagedPath = path.join(dir, `${String(index + 1).padStart(2, '0')}-${fileName}`);
      fs.copyFileSync(sourcePath, stagedPath);
      return {
        fileName: document.file_name || fileName,
        stagedPath,
        sourcePath,
        fileHash: hashFile(sourcePath),
        contentHash: hashText(document.file_content),
        content: document.file_content,
        parserLabel: document.parser_label || null,
        size: fs.statSync(sourcePath).size,
        modifiedAt: fs.statSync(sourcePath).mtime.toISOString(),
      };
    });
    const combinedContent = documents.map((document) => document.content).join('\n\n');
    const metadata = {
      token,
      createdAt: new Date().toISOString(),
      documents,
      fileHash: documents.length === 1 ? documents[0].fileHash : hashText(documents.map((document) => document.fileHash).join('|')),
      contentHash: hashText(combinedContent),
      fileName: documents.length > 1 ? `${documents.length} 份招标文件` : documents[0].fileName,
      parserLabel: documents.length > 1 ? null : documents[0].parserLabel,
      size: documents.reduce((sum, document) => sum + document.size, 0),
    };
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    const matchMap = new Map();
    const matchQueries = [
      { fileHash: metadata.fileHash, contentHash: metadata.contentHash },
      ...documents.map((document) => ({ fileHash: document.fileHash, contentHash: document.contentHash })),
    ];
    matchQueries.forEach((query) => {
      bidProjectManager.getSourceMatches(query).forEach((match) => {
        matchMap.set(match.projectId, match);
      });
    });
    return {
      success: true,
      token,
      fileName: metadata.fileName,
      parserLabel: metadata.parserLabel,
      fileHash: metadata.fileHash,
      contentHash: metadata.contentHash,
      documents: documents.map(({ content, sourcePath, ...document }) => document),
      matches: [...matchMap.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  function discardImport(token) {
    forceRemoveSync(getImportDir(token), {
      trashDir: workspaceTrashDir,
      deferOnFailure: true,
    });
    return { success: true };
  }

  async function confirmImport(token, options = {}) {
    const metadata = readImport(token);
    let project;
    let workflowOperation;
    try {
      project = bidProjectManager.createProject({
        projectName: options.projectName || metadata.fileName,
        projectType: options.projectType || 'technical-plan',
        sectionLabel: options.sectionLabel || '',
        sourceFile: {
          fileName: metadata.fileName,
          fileHash: metadata.fileHash,
          contentHash: metadata.contentHash,
          size: metadata.size,
          modifiedAt: metadata.documents[0]?.modifiedAt,
        },
        sourceFiles: metadata.documents.map((document) => ({
          fileName: document.fileName,
          fileHash: document.fileHash,
          contentHash: document.contentHash,
          size: document.size,
          modifiedAt: document.modifiedAt,
        })),
      });
      workflowOperation = workflowAnalytics?.startOperation({
        operation: 'project_created',
        workflowKind: project.projectType,
        projectId: project.projectId,
        projectName: project.projectName,
        sourceFileNames: metadata.documents.map((document) => document.fileName),
      });
      const store = bidProjectManager.getTechnicalPlanStore(project.projectId);
      await store.importTenderDocument(metadata.documents.map((document) => document.stagedPath));
      const state = store.loadTechnicalPlan();
      const sourceMetadata = new Map(metadata.documents.map((document) => [`${document.fileName}\u0000${document.contentHash}`, document]));
      bidProjectManager.replaceProjectSourceFiles(project.projectId, (state.tenderFiles || []).map((source) => {
        const matching = sourceMetadata.get(`${source.fileName}\u0000${source.contentHash}`);
        return {
          sourceId: source.id,
          fileName: source.fileName,
          fileHash: matching?.fileHash,
          contentHash: source.contentHash,
          sourceDocxPath: source.sourceDocxPath,
          markdownPath: source.markdownPath,
          size: matching?.size,
          modifiedAt: matching?.modifiedAt,
        };
      }));
      discardImport(token);
      const openedProject = bidProjectManager.openProject(project.projectId);
      workflowAnalytics?.finishOperation(workflowOperation, 'succeeded');
      return openedProject;
    } catch (error) {
      workflowAnalytics?.finishOperation(workflowOperation, 'failed', { failureCode: 'parse' });
      if (project?.projectId) bidProjectManager.deleteProject(project.projectId);
      discardImport(token);
      throw error;
    }
  }

  return {
    confirmImport,
    discardImport,
    prepareImport,
    confirmExpansionImport,
    discardExpansionImport,
    prepareExpansionImport,
  };
}

module.exports = {
  createBidProjectImportService,
};
