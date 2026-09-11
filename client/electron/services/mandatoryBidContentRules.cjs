const FORMAL_HEADING_TERMINAL_PUNCTUATION = /[。．.，,；;：:、！？!?]+$/u;
const MANDATORY_SCHEDULE_RULE_PROMPT = `强制进度计划规则：
1. 招标文件规定的工期、服务期限和交付节点是硬性边界，任何计划都不得超出。
2. 计划可以紧凑，可采用并行推进、交叉作业和压缩安排，不评估实际能否完成，也不得以“更现实”为由延长招标期限。
3. 全部工作、验收和成果交付都必须在招标要求期限内完成。
4. 招标文件未给出绝对日期时，使用合同签订、合同生效或项目启动后的相对时间。
5. 不得把实施工作安排在开标、中标或合同生效前，不得自行编造绝对日期。`;

function normalizeFormalHeadingTitle(value) {
  return String(value || '').trim().replace(FORMAL_HEADING_TERMINAL_PUNCTUATION, '').trimEnd();
}

function normalizeOutlineHeadingTitles(outlineData) {
  if (!outlineData || typeof outlineData !== 'object') return outlineData;

  const normalizeItems = (items) => (Array.isArray(items) ? items.map((item) => ({
    ...item,
    title: normalizeFormalHeadingTitle(item?.title),
    ...(Array.isArray(item?.children) ? { children: normalizeItems(item.children) } : {}),
  })) : []);

  return {
    ...outlineData,
    outline: normalizeItems(outlineData.outline),
  };
}

module.exports = {
  MANDATORY_SCHEDULE_RULE_PROMPT,
  normalizeFormalHeadingTitle,
  normalizeOutlineHeadingTitles,
};
