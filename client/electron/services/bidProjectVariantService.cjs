function hasOutlineContent(items) {
  return (Array.isArray(items) ? items : []).some((item) => (
    String(item?.content || '').trim() || hasOutlineContent(item?.children)
  ));
}

function stripOutlineContent(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripOutlineContent);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'content')
    .map(([key, item]) => [key, stripOutlineContent(item)]));
}

function createBidProjectVariantService({ projectManager }) {
  if (!projectManager) throw new Error('标书项目管理服务尚未初始化');

  async function createVariantProject(sourceProjectId) {
    const sourceProject = projectManager.getProject(sourceProjectId);
    if (!sourceProject) throw new Error('未找到第一份标书项目');
    if (sourceProject.projectType !== 'technical-plan' || sourceProject.derivedFromProjectId) {
      throw new Error('仅支持从已完成的普通技术方案再生成一份标书');
    }
    if (sourceProject.status !== 'completed') {
      throw new Error('请先完成第一份标书，再生成同源第二份标书');
    }
    const sourceStore = projectManager.getTechnicalPlanStore(sourceProject.projectId);
    const sourceState = sourceStore?.loadTechnicalPlan?.();
    if (!sourceState?.tenderFile) throw new Error('第一份标书缺少有效招标文件');
    if (!sourceState?.outlineData?.outline?.length || !hasOutlineContent(sourceState.outlineData.outline)) {
      throw new Error('第一份标书尚未生成完整正文');
    }

    const seed = sourceStore.exportVariantSeed();
    const sourceFiles = projectManager.getProjectStore().listProjectSourceFiles(sourceProject.projectId);
    const sourceFile = sourceFiles[0] || {
      fileName: sourceProject.sourceFileName,
      fileHash: sourceProject.sourceFileHash,
      contentHash: sourceProject.sourceContentHash,
      size: sourceProject.sourceFileSize,
      modifiedAt: sourceProject.sourceFileModifiedAt,
    };
    let created = null;
    try {
      created = projectManager.createProject({
        projectName: sourceProject.projectName,
        projectType: 'technical-plan',
        sourceFile,
        sourceFiles,
        sourceGroupId: sourceProject.sourceGroupId,
        derivedFromProjectId: sourceProject.projectId,
        sectionLabel: sourceProject.sectionLabel,
      });
      projectManager.getTechnicalPlanStore(created.projectId).importVariantSeed(seed);
      return projectManager.updateProject(created.projectId, {
        status: 'incomplete',
        currentStep: 'outline-generation',
        uniquenessStatus: 'pending',
        uniquenessResultId: null,
        uniquenessAttempts: 0,
        uniquenessAutoRunRequested: false,
        lastError: null,
      });
    } catch (error) {
      if (created?.projectId) projectManager.deleteProject(created.projectId);
      throw error;
    }
  }

  function getVariantBaselineOutline(projectId) {
    const project = projectManager.getProject(projectId);
    if (!project?.derivedFromProjectId) return null;
    const source = projectManager.getProject(project.derivedFromProjectId);
    if (!source) return null;
    const outlineData = projectManager.getTechnicalPlanStore(source.projectId)?.loadTechnicalPlan?.()?.outlineData;
    return outlineData ? stripOutlineContent(outlineData) : null;
  }

  return {
    createVariantProject,
    getVariantBaselineOutline,
  };
}

module.exports = {
  createBidProjectVariantService,
  hasOutlineContent,
  stripOutlineContent,
};
