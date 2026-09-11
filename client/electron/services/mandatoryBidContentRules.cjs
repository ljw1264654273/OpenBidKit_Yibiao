const FORMAL_HEADING_TERMINAL_PUNCTUATION = /[。．.，,；;：:、！？!?]+$/u;

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
  normalizeFormalHeadingTitle,
  normalizeOutlineHeadingTitles,
};
