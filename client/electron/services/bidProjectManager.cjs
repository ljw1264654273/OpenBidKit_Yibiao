const {
  createTechnicalPlanProjectSchema,
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

  function openProject(projectId) {
    const project = projectStore.getProject(projectId);
    if (!project) throw new Error('未找到标书项目');
    currentProjectId = project.projectId;
    getTechnicalPlanStore(currentProjectId);
    return project;
  }

  function closeProject(projectId) {
    if (!projectId || currentProjectId === String(projectId)) {
      currentProjectId = null;
    }
  }

  function createProject(options) {
    const project = projectStore.createProject(options);
    currentProjectId = project.projectId;
    getTechnicalPlanStore(currentProjectId);
    return project;
  }

  function deleteProject(projectId) {
    const id = String(projectId || '');
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
