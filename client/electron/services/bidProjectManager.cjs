const {
  createTechnicalPlanProjectSchema,
  getTechnicalPlanProjectTablePrefix,
} = require('./sqliteDatabase.cjs');
const { createBidProjectStore } = require('./bidProjectStore.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');
const { calculateContentFingerprint } = require('./bidProjectVariantDeduplicationTask.cjs');
const { isTechnicalPlanContentComplete } = require('./technicalPlanContentState.cjs');

function createBidProjectManager({
  app,
  db,
  fileService,
  agentService,
  taskLogStore,
  configStore,
}) {
  const projectStore = createBidProjectStore({ app, db });
  const technicalPlanStores = new Map();
  let currentProjectId = null;

  function getTechnicalPlanStore(projectId) {
    const id = String(projectId || currentProjectId || '').trim();
    if (!id) return null;
    if (!technicalPlanStores.has(id)) {
      createTechnicalPlanProjectSchema(db, id);
      technicalPlanStores.set(id, createTechnicalPlanStore({
        app,
        db,
        fileService,
        agentService,
        taskLogStore,
        configStore,
        projectId: id,
        onContentChanged({ origin } = {}) {
          const project = projectStore.getProject(id);
          if (!project?.derivedFromProjectId) return;
          if (origin !== 'variant-deduplication') {
            technicalPlanStores.get(id)?.updateTechnicalPlanWithoutReload?.({
              variantDeduplicationTask: null,
            });
          }
          projectStore.updateProject(id, {
            status: 'incomplete',
            uniquenessStatus: 'pending',
            uniquenessResultId: null,
            ...(origin === 'manual' ? { uniquenessAutoRunRequested: false } : {}),
            lastError: null,
          });
        },
      }));
    }
    return technicalPlanStores.get(id);
  }

  function syncProjectWorkflowKind(project, store) {
    const workflowKind = project.projectType === 'existing-plan-expansion'
      ? 'existing-plan-expansion'
      : 'technical-plan';
    const state = store.loadTechnicalPlan?.();
    if (state?.workflowKind === workflowKind) return;
    if (typeof store.syncWorkflowKind === 'function') {
      store.syncWorkflowKind(workflowKind);
    }
  }

  function refreshProjectUniqueness(project) {
    if (!project?.derivedFromProjectId) return project;
    const sourceProject = projectStore.getProject(project.derivedFromProjectId);
    if (!sourceProject) {
      return projectStore.validateProjectUniqueness(project.projectId, {}).project;
    }
    if (project.uniquenessStatus !== 'passed' && project.status !== 'completed') return project;
    const sourceStore = getTechnicalPlanStore(sourceProject.projectId);
    const derivedStore = getTechnicalPlanStore(project.projectId);
    return projectStore.validateProjectUniqueness(project.projectId, {
      sourceFingerprint: calculateContentFingerprint(sourceStore),
      derivedFingerprint: calculateContentFingerprint(derivedStore),
      contentGenerationSucceeded: isTechnicalPlanContentComplete(derivedStore.loadTechnicalPlan()),
    }).project;
  }

  function getProject(projectId) {
    return refreshProjectUniqueness(projectStore.getProject(projectId));
  }

  function listProjects(filters) {
    // 列表是高频 IPC 读操作，不能为每个派生项目同步加载完整正文并计算指纹。
    // 正文变更会由技术方案 Store 立即使查重状态失效，导出前还会执行一次最终校验。
    return projectStore.listProjects(filters);
  }

  function openProject(projectId) {
    const project = getProject(projectId);
    if (!project) throw new Error('未找到标书项目');
    currentProjectId = project.projectId;
    const store = getTechnicalPlanStore(currentProjectId);
    syncProjectWorkflowKind(project, store);
    return project;
  }

  function closeProject(projectId) {
    if (!projectId || currentProjectId === String(projectId)) {
      currentProjectId = null;
    }
  }

  function quoteSqliteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  function deleteTechnicalPlanProjectSchema(projectId) {
    const prefix = getTechnicalPlanProjectTablePrefix(projectId);
    const tableNames = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND substr(name, 1, ?) = ?
    `).all(prefix.length, prefix).map((row) => row.name);
    if (!tableNames.length) return;

    const tableSet = new Set(tableNames);
    const childrenByParent = new Map(tableNames.map((name) => [name, new Set()]));
    for (const childTable of tableNames) {
      const foreignKeys = db.prepare(
        `PRAGMA foreign_key_list(${quoteSqliteIdentifier(childTable)})`,
      ).all();
      for (const foreignKey of foreignKeys) {
        if (tableSet.has(foreignKey.table) && foreignKey.table !== childTable) {
          childrenByParent.get(foreignKey.table).add(childTable);
        }
      }
    }

    const visited = new Set();
    const dropOrder = [];
    function visit(tableName) {
      if (visited.has(tableName)) return;
      visited.add(tableName);
      for (const childTable of childrenByParent.get(tableName) || []) {
        visit(childTable);
      }
      dropOrder.push(tableName);
    }
    tableNames.forEach(visit);

    const drop = db.transaction(() => {
      for (const tableName of dropOrder) {
        db.prepare(`DROP TABLE IF EXISTS ${quoteSqliteIdentifier(tableName)}`).run();
      }
    });
    drop();
  }

  function createProject(options) {
    const project = projectStore.createProject(options);
    currentProjectId = project.projectId;
    const store = getTechnicalPlanStore(currentProjectId);
    syncProjectWorkflowKind(project, store);
    return project;
  }

  function deleteProject(projectId) {
    const id = String(projectId || '');
    deleteTechnicalPlanProjectSchema(id);
    technicalPlanStores.delete(id);
    const result = projectStore.deleteProject(id);
    if (currentProjectId === id) currentProjectId = null;
    return result;
  }

  return {
    closeProject,
    createProject,
    deleteProject,
    getCurrentProjectId: () => currentProjectId,
    getProject,
    getProjectStore: () => projectStore,
    getSourceMatches: projectStore.getSourceMatches,
    getTechnicalPlanStore,
    listProjects,
    listProjectSourceFiles: projectStore.listProjectSourceFiles,
    listSourceGroupProjects: projectStore.listSourceGroupProjects,
    openProject,
    replaceProjectSourceFiles: projectStore.replaceProjectSourceFiles,
    updateProject: projectStore.updateProject,
  };
}

module.exports = {
  createBidProjectManager,
};
