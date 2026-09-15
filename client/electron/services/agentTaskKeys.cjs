function getProjectAgentTaskKey(baseKey, projectId) {
  const id = String(projectId || '').trim();
  return id ? `${baseKey}:${id}` : baseKey;
}

module.exports = {
  getProjectAgentTaskKey,
};
