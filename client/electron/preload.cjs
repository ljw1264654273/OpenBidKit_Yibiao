const { contextBridge, ipcRenderer, webUtils } = require('electron');

const bridge = {
  appName: '园测 投标工具箱',
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getGpuHardwareAccelerationStatus: () => ipcRenderer.invoke('app:get-gpu-hardware-acceleration-status'),
  saveGpuHardwareAccelerationPreference: (enabled) => ipcRenderer.invoke('app:save-gpu-hardware-acceleration-preference', enabled),
  startGpuHardwareAccelerationTrial: () => ipcRenderer.invoke('app:start-gpu-hardware-acceleration-trial'),
  relaunchWithGpuHardwareAccelerationDisabled: () => ipcRenderer.invoke('app:relaunch-with-gpu-hardware-acceleration-disabled'),
  requiredOnlineServices: {
    getStatus: () => ipcRenderer.invoke('required-online-services:get-status'),
  },
  getLatestVersion: () => ipcRenderer.invoke('app:get-latest-version'),
  getUpdateDownloadUrl: () => ipcRenderer.invoke('app:get-update-download-url'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  checkUpdate: () => ipcRenderer.invoke('app:check-update'),
  startUpdate: () => ipcRenderer.invoke('app:start-update'),
  quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-progress', listener);
    return () => ipcRenderer.removeListener('app:update-progress', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-downloaded', listener);
    return () => ipcRenderer.removeListener('app:update-downloaded', listener);
  },
  onUpdateError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:update-error', listener);
    return () => ipcRenderer.removeListener('app:update-error', listener);
  },
  database: {
    getStatus: () => ipcRenderer.invoke('workspace-database:get-status'),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('workspace-database:status', listener);
      return () => ipcRenderer.removeListener('workspace-database:status', listener);
    },
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    listModels: (config) => ipcRenderer.invoke('config:list-models', config),
    getModelInfo: (modelName) => ipcRenderer.invoke('config:get-model-info', modelName),
    getRemoteKnowledgeDefault: () => ipcRenderer.invoke('config:get-remote-knowledge-default'),
    openConfigFolder: () => ipcRenderer.invoke('config:open-config-folder'),
  },
  remoteKnowledge: {
    testConnection: (config) => ipcRenderer.invoke('remote-knowledge:test-connection', config),
    getEndpointFingerprint: () => ipcRenderer.invoke('remote-knowledge:get-endpoint-fingerprint'),
    listKnowledgeBases: () => ipcRenderer.invoke('remote-knowledge:list-knowledge-bases'),
    listDocuments: (input) => ipcRenderer.invoke('remote-knowledge:list-documents', input),
    getPendingDecision: () => ipcRenderer.invoke('remote-knowledge:get-pending-decision'),
    resolveDecision: (input) => ipcRenderer.invoke('remote-knowledge:resolve-decision', input),
    onDecision: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('remote-knowledge:decision', listener);
      ipcRenderer.send('remote-knowledge:subscribe-decisions');
      return () => {
        ipcRenderer.removeListener('remote-knowledge:decision', listener);
        void ipcRenderer.invoke('remote-knowledge:unsubscribe-decisions').catch(() => undefined);
      };
    },
  },
  license: {
    getStatus: () => ipcRenderer.invoke('license:get-status'),
    refresh: () => ipcRenderer.invoke('license:refresh'),
    importOfflineFile: () => ipcRenderer.invoke('license:import-offline-file'),
    activateOfflineCode: (code) => ipcRenderer.invoke('license:activate-offline-code', code),
  },
  ai: {
    chat: (request) => ipcRenderer.invoke('ai:chat', request),
    requestJson: (request) => ipcRenderer.invoke('ai:request-json', request),
    testImageModel: (config) => ipcRenderer.invoke('ai:test-image-model', config),
    onHttpError: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('ai:http-error', listener);
      return () => ipcRenderer.removeListener('ai:http-error', listener);
    },
  },
  autoConfirmation: {
    getState: () => ipcRenderer.invoke('auto-confirmation:get-state'),
    setEnabled: (enabled) => ipcRenderer.invoke('auto-confirmation:set-enabled', enabled),
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('auto-confirmation:state', listener);
      ipcRenderer.send('auto-confirmation:subscribe');
      return () => ipcRenderer.removeListener('auto-confirmation:state', listener);
    },
  },
  agent: {
    run: (payload) => ipcRenderer.invoke('agent:run', payload),
    selfCheck: () => ipcRenderer.invoke('agent:self-check'),
    exportSelfCheckReport: (payload) => ipcRenderer.invoke('agent:export-self-check-report', payload),
    getStatus: () => ipcRenderer.invoke('agent:get-status'),
    restart: (reason) => ipcRenderer.invoke('agent:restart', reason),
    getPendingQuestion: () => ipcRenderer.invoke('agent:get-pending-question'),
    answerQuestion: (payload) => ipcRenderer.invoke('agent:answer-question', payload),
    suppressQuestionAutoAnswer: (payload) => ipcRenderer.invoke('agent:suppress-question-auto-answer', payload),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:status', listener);
      ipcRenderer.send('agent:subscribe');
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    onQuestion: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:question-state', listener);
      ipcRenderer.send('agent:subscribe');
      return () => ipcRenderer.removeListener('agent:question-state', listener);
    },
  },
  developerTokenStats: {
    openWindow: () => ipcRenderer.invoke('developer-token-stats:open-window'),
    get: () => ipcRenderer.invoke('developer-token-stats:get'),
    reset: () => ipcRenderer.invoke('developer-token-stats:reset'),
    onChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('developer-token-stats:changed', listener);
      return () => ipcRenderer.removeListener('developer-token-stats:changed', listener);
    },
  },
  developerAgentMonitor: {
    openWindow: () => ipcRenderer.invoke('developer-agent-monitor:open-window'),
    openWorkspace: (workspaceDir) => ipcRenderer.invoke('developer-agent-monitor:open-workspace', workspaceDir),
    attach: () => ipcRenderer.invoke('developer-agent-monitor:attach'),
    detach: () => ipcRenderer.invoke('developer-agent-monitor:detach'),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('developer-agent-monitor:event', listener);
      return () => ipcRenderer.removeListener('developer-agent-monitor:event', listener);
    },
  },
  developerExpansionReplaceTest: {
    run: (payload) => ipcRenderer.invoke('developer-expansion-replace-test:run', payload),
  },
  file: {
    selectDuplicateCheckFiles: (options) => ipcRenderer.invoke('file:select-duplicate-check-files', options),
    /** 把拖拽进来的 File 对象换成本地绝对路径，供各上传区拖拽导入使用 */
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
  knowledgeBase: {
    list: (options) => ipcRenderer.invoke('knowledge-base:list', options),
    createFolder: (name, knowledgeBaseId) => ipcRenderer.invoke('knowledge-base:create-folder', name, knowledgeBaseId),
    renameFolder: (folderId, name) => ipcRenderer.invoke('knowledge-base:rename-folder', folderId, name),
    reorderFolder: (draggedFolderId, targetFolderId, position) => ipcRenderer.invoke('knowledge-base:reorder-folder', draggedFolderId, targetFolderId, position),
    deleteFolder: (folderId) => ipcRenderer.invoke('knowledge-base:delete-folder', folderId),
    deleteDocument: (documentId) => ipcRenderer.invoke('knowledge-base:delete-document', documentId),
    moveDocument: (documentId, targetFolderId, targetDocumentId, position) => ipcRenderer.invoke('knowledge-base:move-document', documentId, targetFolderId, targetDocumentId, position),
    uploadDocuments: (folderId) => ipcRenderer.invoke('knowledge-base:upload-documents', folderId),
    retryDocument: (documentId) => ipcRenderer.invoke('knowledge-base:retry-document', documentId),
    startMatching: (documentId, batchSize) => ipcRenderer.invoke('knowledge-base:start-matching', documentId, batchSize), // batchSize 已忽略
    readMarkdown: (documentId) => ipcRenderer.invoke('knowledge-base:read-markdown', documentId),
    readItems: (documentId) => ipcRenderer.invoke('knowledge-base:read-items', documentId),
    readAnalysis: (documentId) => ipcRenderer.invoke('knowledge-base:read-analysis', documentId),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('knowledge-base:event', listener);
      return () => ipcRenderer.removeListener('knowledge-base:event', listener);
    },
  },
  technicalPlan: {
    loadState: (payload) => ipcRenderer.invoke('technical-plan:load-state', payload),
    importTenderDocument: (payload) => ipcRenderer.invoke('technical-plan:import-tender-document', payload),
    removeTenderDocument: (payload) => ipcRenderer.invoke('technical-plan:remove-tender-document', payload),
    importOriginalPlanDocument: (payload) => ipcRenderer.invoke('technical-plan:import-original-plan-document', payload),
    checkBidSections: (payload) => ipcRenderer.invoke('technical-plan:check-bid-sections', payload),
    selectBidSection: (payload) => ipcRenderer.invoke('technical-plan:select-bid-section', payload),
    readTenderMarkdown: (payload) => ipcRenderer.invoke('technical-plan:read-tender-markdown', payload),
    readTenderSourceMarkdown: (payload) => ipcRenderer.invoke('technical-plan:read-tender-source-markdown', payload),
    readOriginalPlanMarkdown: (payload) => ipcRenderer.invoke('technical-plan:read-original-plan-markdown', payload),
    updateStep: (payload) => ipcRenderer.invoke('technical-plan:update-step', payload),
    saveBidAnalysisConfig: (payload) => ipcRenderer.invoke('technical-plan:save-bid-analysis-config', payload),
    saveOutlineConfig: (payload) => ipcRenderer.invoke('technical-plan:save-outline-config', payload),
    saveOutlineSelection: (payload) => ipcRenderer.invoke('tasks:confirm-outline-selection', payload),
    saveOutline: (outlineData) => ipcRenderer.invoke('technical-plan:save-outline', outlineData),
    saveOutlineNodeKnowledge: (payload) => ipcRenderer.invoke('technical-plan:save-outline-node-knowledge', payload),
    saveGlobalFactsConfig: (payload) => ipcRenderer.invoke('technical-plan:save-global-facts-config', payload),
    saveGlobalFacts: (payload) => ipcRenderer.invoke('technical-plan:save-global-facts', payload),
    saveContentGenerationOptions: (payload) => ipcRenderer.invoke('technical-plan:save-content-generation-options', payload),
    saveChapterContent: (payload) => ipcRenderer.invoke('technical-plan:save-chapter-content', payload),
    previewIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:preview-illustration-review-item', payload),
    saveIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:save-illustration-review-item', payload),
    adjustIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:adjust-illustration-review-item', payload),
    confirmIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:confirm-illustration-review-item', payload),
    resetIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:reset-illustration-review-item', payload),
    convertMermaidIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:convert-mermaid-illustration-review-item', payload),
    skipIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:skip-illustration-review-item', payload),
    adoptIllustrationReviewItem: (payload) => ipcRenderer.invoke('technical-plan:adopt-illustration-review-item', payload),
    previewMermaidReviewItem: (payload) => ipcRenderer.invoke('technical-plan:preview-mermaid-review-item', payload),
    saveMermaidReviewCode: (payload) => ipcRenderer.invoke('technical-plan:save-mermaid-review-code', payload),
    adjustMermaidReviewCode: (payload) => ipcRenderer.invoke('technical-plan:adjust-mermaid-review-code', payload),
    confirmMermaidReviewItem: (payload) => ipcRenderer.invoke('technical-plan:confirm-mermaid-review-item', payload),
    skipMermaidReviewItem: (payload) => ipcRenderer.invoke('technical-plan:skip-mermaid-review-item', payload),
    clear: (payload) => ipcRenderer.invoke('technical-plan:clear', payload),
    openBidTemplate: (payload) => ipcRenderer.invoke('technical-plan:open-bid-template', payload),
  },
  bidProject: {
    list: (filters) => ipcRenderer.invoke('bid-project:list', filters),
    get: (projectId) => ipcRenderer.invoke('bid-project:get', projectId),
    open: (projectId) => ipcRenderer.invoke('bid-project:open', projectId),
    close: (projectId) => ipcRenderer.invoke('bid-project:close', projectId),
    create: (options) => ipcRenderer.invoke('bid-project:create', options),
    update: (projectId, patch) => ipcRenderer.invoke('bid-project:update', projectId, patch),
    delete: (projectId) => ipcRenderer.invoke('bid-project:delete', projectId),
    sourceGroup: (projectId) => ipcRenderer.invoke('bid-project:source-group', projectId),
    prepareImport: (filePaths) => ipcRenderer.invoke('bid-project:prepare-import', filePaths),
    confirmImport: (token, options) => ipcRenderer.invoke('bid-project:confirm-import', token, options),
    discardImport: (token) => ipcRenderer.invoke('bid-project:discard-import', token),
    prepareExpansionImport: (payload) => ipcRenderer.invoke('bid-project:prepare-expansion-import', payload),
    confirmExpansionImport: (token, options) => ipcRenderer.invoke('bid-project:confirm-expansion-import', token, options),
    discardExpansionImport: (token) => ipcRenderer.invoke('bid-project:discard-expansion-import', token),
    readContent: (projectId) => ipcRenderer.invoke('bid-project:read-content', projectId),
    compareContent: (payload) => ipcRenderer.invoke('bid-project:compare-content', payload),
    listRecentDuplicateSummaries: (projectIds) => ipcRenderer.invoke('bid-project:recent-duplicate-summaries', projectIds),
    loadDuplicateResult: (resultId) => ipcRenderer.invoke('bid-project:load-duplicate-result', resultId),
    loadDuplicateResultPage: (resultId, offset, limit) => ipcRenderer.invoke('bid-project:load-duplicate-result-page', resultId, offset, limit),
    loadLatestDuplicateResult: (projectId) => ipcRenderer.invoke('bid-project:load-latest-duplicate-result', projectId),
    updateDuplicateMatchDecision: (payload) => ipcRenderer.invoke('bid-project:update-duplicate-match-decision', payload),
    rewriteDuplicateMatch: (payload) => ipcRenderer.invoke('bid-project:rewrite-duplicate-match', payload),
    replaceContent: (projectId, payload) => ipcRenderer.invoke('bid-project:replace-content', projectId, payload),
    exportWord: (projectId, options) => ipcRenderer.invoke('bid-project:export-word', projectId, options),
  },
  feasibilityReport: {
    loadState: () => ipcRenderer.invoke('feasibility-report:load-state'),
    importSourceDocuments: (filePaths) => ipcRenderer.invoke('feasibility-report:import-source-documents', filePaths),
    removeSourceDocument: (sourceId) => ipcRenderer.invoke('feasibility-report:remove-source-document', sourceId),
    readSourceMarkdown: (sourceId) => ipcRenderer.invoke('feasibility-report:read-source-markdown', sourceId),
    readCombinedSourceMarkdown: () => ipcRenderer.invoke('feasibility-report:read-combined-source-markdown'),
    updateStep: (step) => ipcRenderer.invoke('feasibility-report:update-step', step),
    saveProjectInfo: (projectInfo) => ipcRenderer.invoke('feasibility-report:save-project-info', projectInfo),
    saveAnalysis: (markdown) => ipcRenderer.invoke('feasibility-report:save-analysis', markdown),
    saveOutlineConfig: (payload) => ipcRenderer.invoke('feasibility-report:save-outline-config', payload),
    saveOutline: (payload) => ipcRenderer.invoke('feasibility-report:save-outline', payload),
    saveKeyParameters: (markdown) => ipcRenderer.invoke('feasibility-report:save-key-parameters', markdown),
    saveChapterContent: (payload) => ipcRenderer.invoke('feasibility-report:save-chapter-content', payload),
    clear: () => ipcRenderer.invoke('feasibility-report:clear'),
  },
  duplicateCheck: {
    loadState: () => ipcRenderer.invoke('duplicate-check:load-state'),
    saveFiles: (payload) => ipcRenderer.invoke('duplicate-check:save-files', payload),
    saveUiState: (payload) => ipcRenderer.invoke('duplicate-check:save-ui-state', payload),
    updateState: (partial) => ipcRenderer.invoke('duplicate-check:update-state', partial),
    exportExcel: (request) => ipcRenderer.invoke('duplicate-check:export-excel', request),
    clear: () => ipcRenderer.invoke('duplicate-check:clear'),
  },
  rejectionCheck: {
    loadState: () => ipcRenderer.invoke('rejection-check:load-state'),
    importDocument: (role, filePaths) => ipcRenderer.invoke('rejection-check:import-document', role, filePaths),
    importTenderFromTechnicalPlan: () => ipcRenderer.invoke('rejection-check:import-tender-from-technical-plan'),
    removeDocument: (role, documentId) => ipcRenderer.invoke('rejection-check:remove-document', role, documentId),
    saveUiState: (payload) => ipcRenderer.invoke('rejection-check:save-ui-state', payload),
    updateState: (partial) => ipcRenderer.invoke('rejection-check:update-state', partial),
    exportExcel: (request) => ipcRenderer.invoke('rejection-check:export-excel', request),
    clear: () => ipcRenderer.invoke('rejection-check:clear'),
  },
  templates: {
    list: () => ipcRenderer.invoke('templates:list'),
    get: (templateId) => ipcRenderer.invoke('templates:get', templateId),
    create: (config) => ipcRenderer.invoke('templates:create', config),
    update: (templateId, config) => ipcRenderer.invoke('templates:update', templateId, config),
    delete: (templateId) => ipcRenderer.invoke('templates:delete', templateId),
    import: () => ipcRenderer.invoke('templates:import'),
    export: (config) => ipcRenderer.invoke('templates:export', config),
  },
  tasks: {
    startBidSectionExtraction: (payload) => ipcRenderer.invoke('tasks:start-bid-section-extraction', payload),
    resetBidSectionDownstream: (payload) => ipcRenderer.invoke('tasks:reset-bid-section-downstream', payload),
    startBidAnalysis: (payload) => ipcRenderer.invoke('tasks:start-bid-analysis', payload),
    startOutlineGeneration: (payload) => ipcRenderer.invoke('tasks:start-outline-generation', payload),
    suppressOutlineSelectionAutoConfirmation: (payload) => ipcRenderer.invoke('tasks:suppress-outline-selection-auto-confirmation', payload),
    startGlobalFactsGeneration: (payload) => ipcRenderer.invoke('tasks:start-global-facts-generation', payload),
    startContentGeneration: (payload) => ipcRenderer.invoke('tasks:start-content-generation', payload),
    pauseContentGeneration: (payload) => ipcRenderer.invoke('tasks:pause-content-generation', payload),
    startRejectionItemsExtraction: (payload) => ipcRenderer.invoke('tasks:start-rejection-items-extraction', payload),
    startRejectionCheck: (payload) => ipcRenderer.invoke('tasks:start-rejection-check', payload),
    startDuplicateAnalysis: (payload) => ipcRenderer.invoke('tasks:start-duplicate-analysis', payload),
    startFeasibilityAnalysis: (payload) => ipcRenderer.invoke('tasks:start-feasibility-analysis', payload),
    startFeasibilityOutline: (payload) => ipcRenderer.invoke('tasks:start-feasibility-outline', payload),
    startFeasibilityParameters: (payload) => ipcRenderer.invoke('tasks:start-feasibility-parameters', payload),
    startFeasibilityContent: (payload) => ipcRenderer.invoke('tasks:start-feasibility-content', payload),
    pauseFeasibilityContent: (payload) => ipcRenderer.invoke('tasks:pause-feasibility-content', payload),
    startFeasibilityHumanWriting: (payload) => ipcRenderer.invoke('tasks:start-feasibility-human-writing', payload),
    getActiveTasks: () => ipcRenderer.invoke('tasks:get-active'),
    onTaskEvent: (callback) => {
      ipcRenderer.send('tasks:subscribe');
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('tasks:event', listener);
      return () => ipcRenderer.removeListener('tasks:event', listener);
    },
  },
  export: {
    exportWord: (payload) => ipcRenderer.invoke('export:word', payload),
    openFile: (filePath) => ipcRenderer.invoke('export:open-file', filePath),
    onWordExportProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('export:word-progress', listener);
      return () => ipcRenderer.removeListener('export:word-progress', listener);
    },
  },
  systemFonts: {
    list: () => ipcRenderer.invoke('system-fonts:list'),
  },
};

contextBridge.exposeInMainWorld('yibiao', bridge);

contextBridge.exposeInMainWorld('yibiaoClient', {
  appName: bridge.appName,
  platform: bridge.platform,
});
