const {
  createTechnicalPlanProjectSchema,
  getTechnicalPlanProjectTablePrefix,
} = require('./sqliteDatabase.cjs');
const { createBidProjectStore } = require('./bidProjectStore.cjs');
const { createTechnicalPlanStore } = require('./technicalPlanStore.cjs');

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

  function openProject(projectId) {
    const project = projectStore.getProject(projectId);
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
    getProject: projectStore.getProject,
    getProjectStore: () => projectStore,
    getSourceMatches: projectStore.getSourceMatches,
    getTechnicalPlanStore,
    listProjects: projectStore.listProjects,
    listSourceGroupProjects: projectStore.listSourceGroupProjects,
    openProject,
    replaceProjectSourceFiles: projectStore.replaceProjectSourceFiles,
    updateProject: projectStore.updateProject,
  };
}

module.exports = {
  createBidProjectManager,
};
