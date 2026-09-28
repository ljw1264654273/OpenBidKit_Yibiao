function collectLeafItems(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => (
    item?.children?.length ? collectLeafItems(item.children) : [item]
  ));
}

function isTechnicalPlanContentComplete(technicalPlan = {}) {
  if (technicalPlan.contentGenerationTask?.status === 'success') return true;
  if (technicalPlan.contentGenerationTask) return false;

  // 目录增删会删除旧任务记录，但会保留未受影响章节的正文和分节状态。
  const sections = technicalPlan.contentGenerationSections || {};
  const allLeaves = collectLeafItems(technicalPlan.outlineData?.outline);
  const explicitGeneratedLeaves = allLeaves.filter((item) => item?.content_mode === 'ai-generate');
  const generatedLeaves = explicitGeneratedLeaves.length ? explicitGeneratedLeaves : allLeaves;
  if (!generatedLeaves.length) return false;

  return generatedLeaves.every((item) => {
    const section = sections[item.id];
    if (section?.status === 'ignored') return true;
    const content = section && Object.prototype.hasOwnProperty.call(section, 'content')
      ? section.content
      : item.content;
    return section?.status === 'success' && Boolean(String(content || '').trim());
  });
}

module.exports = {
  isTechnicalPlanContentComplete,
};
