const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getWorkspaceDir } = require('../utils/paths.cjs');

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeFileName(value) {
  return String(value || '招标文件').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '招标文件';
}

function createBidProjectImportService({ app, fileService, bidProjectManager }) {
  const importsDir = path.join(getWorkspaceDir(app), 'bid-project-imports');
  fs.mkdirSync(importsDir, { recursive: true });
  for (const entry of fs.readdirSync(importsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      fs.rmSync(path.join(importsDir, entry.name), { recursive: true, force: true });
    } catch {
      // 重启时清理暂存失败不阻断后续导入，下一次启动继续尝试。
    }
  }

  function getImportDir(token) {
    return path.join(importsDir, String(token || '').replace(/[^a-zA-Z0-9_-]/g, ''));
  }

  function readImport(token) {
    const dir = getImportDir(token);
    const metadataPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) throw new Error('导入暂存已失效，请重新选择招标文件');
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
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
    fs.rmSync(getImportDir(token), { recursive: true, force: true });
    return { success: true };
  }

  async function confirmImport(token, options = {}) {
    const metadata = readImport(token);
    let project;
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
      return bidProjectManager.openProject(project.projectId);
    } catch (error) {
      if (project?.projectId) bidProjectManager.deleteProject(project.projectId);
      discardImport(token);
      throw error;
    }
  }

  return {
    confirmImport,
    discardImport,
    prepareImport,
  };
}

module.exports = {
  createBidProjectImportService,
};
