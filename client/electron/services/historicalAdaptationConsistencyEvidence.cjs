// 只选择资料原文，不生成新事实；全文指纹由 Store 维护。
function baselineRecords(baseline) {
  if (Array.isArray(baseline)) return baseline;
  if (!baseline || typeof baseline !== 'object') return [];
  return Object.entries(baseline).map(([id, value]) => typeof value === 'string'
    ? { id, title: id, content: value } : { ...value, id: value?.id || id, title: value?.label || value?.title || id });
}

function queryTerms(query) {
  const tokens = new Set(String(query || '').match(/[a-zA-Z0-9_.%-]{2,}|[\p{Script=Han}]{2,}/gu) || []);
  for (const token of [...tokens]) {
    if (!/[\p{Script=Han}]/u.test(token)) continue;
    tokens.delete(token);
    for (let i = 0; i < token.length - 1; i++) tokens.add(token.slice(i, i + 2));
  }
  return [...tokens];
}

function sourceExcerpts(source, query, limit = 4500) {
  const terms = queryTerms(query);
  const lines = String(source || '').split(/\n+/u).flatMap((line) => {
    const chunks = [];
    for (let start = 0; start < line.length; start += 800) chunks.push(line.slice(start, start + 800));
    return chunks;
  }).filter((line) => line.trim());
  const ranked = lines.map((content, index) => ({ content, index,
    score: terms.reduce((sum, term) => sum + (content.includes(term) ? 1 : 0), 0)
      + (/项目名称|服务期限|采购预算|采购需求|成果要求/u.test(content) ? 2 : 0) }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = [];
  let used = 0;
  for (const entry of ranked) {
    if (used + entry.content.length > limit) continue;
    selected.push(entry);
    used += entry.content.length + 1;
  }
  return selected.sort((a, b) => a.index - b.index).map((entry) => entry.content).join('\n');
}

function sourceEvidence(context, chapters = [], extraQuery = '') {
  const query = [extraQuery, ...chapters.map((chapter) => [chapter.path, chapter.content].join('\n'))].join('\n');
  const analysis = typeof context.baseline === 'string' ? context.baseline : baselineRecords(context.baseline).filter((item) => !item.status || item.status === 'success')
    .map((item) => `${item.label || item.title || item.id || ''}：${item.content || item.value || ''}`).join('\n');
  const nodeIds = new Set(chapters.map((chapter) => String(chapter.node_id)));
  const sourceById = new Map((context.sourceAvailability || []).filter((source) => source.available)
    .map((source) => [String(source.node_id), source.content]));
  const historical = (context.items || []).filter((item) => nodeIds.has(String(item.node_id)))
    .map((item) => sourceById.get(String(item.node_id)) || item.source_content || item.source_excerpt || '').filter(Boolean).join('\n');
  return {
    tender_analysis: sourceExcerpts(analysis, query, 4500),
    tender_original: sourceExcerpts(context.tenderMarkdown, query, 5000),
    historical_original: sourceExcerpts(historical || context.originalPlanMarkdown, query, 2500),
  };
}

module.exports = { baselineRecords, sourceExcerpts, sourceEvidence };
