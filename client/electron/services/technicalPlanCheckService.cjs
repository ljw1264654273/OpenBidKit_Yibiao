const path = require('node:path');
const { toDocumentLines } = require('./technicalPlanCheckDocumentAdapter.cjs');

const INPUT_ROLES = Object.freeze({
  tender: { field: 'tenderFile', label: '招标文件', lines: 'tenderLines' },
  requirements: { field: 'requirementsFile', label: '采购需求文件', lines: 'requirementLines' },
  scoring: { field: 'scoringFile', label: '主观分评分标准', lines: 'scoreLines' },
  proposal: { field: 'proposalFile', label: '投标技术方案', lines: 'proposalLines' },
});
const INPUT_EXTENSIONS = ['docx', 'pdf', 'doc', 'wps'];

function normalizedPath(filePath) {
  if (process.platform === 'win32') return path.win32.resolve(String(filePath)).toLowerCase();
  return path.posix.resolve(String(filePath));
}

function assertNotRunning(state) {
  if (['running', 'queued', 'pausing'].includes(state.checkTask?.status)) {
    throw new Error('技术方案检查正在执行，请等待完成后再替换文件或输出位置');
  }
}

function validateInput(file, role) {
  const label = INPUT_ROLES[role].label;
  if (!file?.path) throw new Error(`请先选择${label}`);
  if (!INPUT_EXTENSIONS.includes(path.extname(file.path).slice(1).toLowerCase())) {
    throw new Error(`${label}格式不支持，请选择 DOCX、PDF、DOC 或 WPS 文件`);
  }
}

function validateOutput(state) {
  if (!state.outputPath) throw new Error('请先选择检查记录输出位置');
  if (path.extname(state.outputPath).toLowerCase() !== '.docx') {
    throw new Error('检查记录输出格式必须为 DOCX');
  }
  const output = normalizedPath(state.outputPath);
  if (Object.values(INPUT_ROLES).some(({ field }) => state[field]?.path && normalizedPath(state[field].path) === output)) {
    throw new Error('检查记录输出位置不能与输入文件相同，请重新选择输出位置');
  }
}

function throwIfAborted(signal) {
  signal?.throwIfAborted();
}

function createTechnicalPlanCheckService({
  app, configStore, technicalPlanCheckStore,
  dialog, shell, parseDocumentWithConfig, withLegacyWordDocxFile,
}) {
  const systemDialog = dialog || require('electron').dialog;
  const systemShell = shell || require('electron').shell;
  const parseDocument = parseDocumentWithConfig || require('./fileService.cjs').parseDocumentWithConfig;

  function loadState() {
    return technicalPlanCheckStore.loadState();
  }

  async function selectInput(role) {
    const documentRole = INPUT_ROLES[role];
    if (!documentRole) throw new Error('请选择有效的技术方案检查文件角色');
    assertNotRunning(loadState());
    const selection = await systemDialog.showOpenDialog({
      title: `选择${documentRole.label}`,
      properties: ['openFile'],
      filters: [{ name: 'Word / PDF 文档', extensions: INPUT_EXTENSIONS }],
    });
    const state = loadState();
    if (selection.canceled || !selection.filePaths.length) return state;
    assertNotRunning(state);
    const filePath = selection.filePaths[0];
    const file = { path: filePath, name: path.basename(filePath) };
    validateInput(file, role);
    return technicalPlanCheckStore.saveSelection(role, file);
  }

  async function selectOutput() {
    const state = loadState();
    assertNotRunning(state);
    const selection = await systemDialog.showSaveDialog({
      title: '选择检查记录输出位置',
      defaultPath: state.outputPath || undefined,
      filters: [{ name: 'Word 文档', extensions: ['docx'] }],
    });
    const currentState = loadState();
    if (selection.canceled || !selection.filePath) return currentState;
    assertNotRunning(currentState);
    validateOutput({ ...currentState, outputPath: selection.filePath });
    return technicalPlanCheckStore.saveOutputPath(selection.filePath);
  }

  async function openReport() {
    const state = loadState();
    if (!state.reportPath) throw new Error('暂无检查记录，请先执行技术方案检查');
    const error = await systemShell.openPath(state.reportPath);
    if (error) throw new Error(`无法打开检查记录：${error}`);
    return { success: true };
  }

  async function prepareDocuments(state, callback, { signal, onStage } = {}) {
    for (const role of Object.keys(INPUT_ROLES)) validateInput(state[INPUT_ROLES[role].field], role);
    validateOutput(state);
    throwIfAborted(signal);
    const config = configStore.load();
    const provider = config.components?.file_parser?.provider || 'local';
    const localConfig = { ...config, components: { ...config.components, file_parser: { ...config.components?.file_parser, provider: 'local' } } };
    const documents = {};
    for (const [role, { field, lines }] of Object.entries(INPUT_ROLES)) {
      throwIfAborted(signal);
      onStage?.(role);
      const filePath = state[field].path;
      const isPdf = path.extname(filePath).toLowerCase() === '.pdf';
      const options = { preserveImages: false, signal };
      let markdown;
      try {
        markdown = await parseDocument(app, filePath, isPdf ? localConfig : config, options);
      } catch (error) {
        throwIfAborted(signal);
        if (!isPdf || error.code !== 'pdf_text_layer_missing') throw error;
        if (!['mineru-accurate-api', 'mineru-agent-api'].includes(provider)) {
          const notice = new Error('PDF 未检测到可选中文字层，请在设置的文件解析中配置 MinerU 精准解析 API（填写 Token）或 MinerU-Agent 轻量解析 API 后重试，或改用带文字层的 PDF / Word 文件');
          notice.code = error.code;
          throw notice;
        }
        markdown = await parseDocument(app, filePath, config, options);
      }
      throwIfAborted(signal);
      documents[lines] = toDocumentLines(markdown);
    }
    const proposalPath = state.proposalFile.path;
    const extension = path.extname(proposalPath).toLowerCase();
    if (extension === '.doc' || extension === '.wps') {
      const convert = withLegacyWordDocxFile || (await import('./doc2markdown/convert.mjs')).withLegacyWordDocxFile;
      // 格式扫描在转换回调内运行，临时 DOCX 只在此生命周期中有效。
      const outcome = await convert(proposalPath, async (proposalDocxPath) => {
        // 转换助手会重试回调异常，业务失败需在临时文件清理后原样抛出。
        try {
          throwIfAborted(signal);
          return { success: true, result: await callback({ documents, proposalDocxPath }) };
        } catch (error) {
          return { success: false, error };
        }
      });
      if (!outcome.success) throw outcome.error;
      return outcome.result;
    }
    throwIfAborted(signal);
    return callback({ documents, proposalDocxPath: extension === '.docx' ? proposalPath : null });
  }

  return { selectInput, selectOutput, loadState, openReport, prepareDocuments };
}

module.exports = { createTechnicalPlanCheckService };
