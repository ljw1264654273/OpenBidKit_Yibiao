const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('远程知识服务地址必须以 http:// 或 https:// 开头');
  return text;
}

function getEndpointFingerprint(baseUrl) {
  return crypto.createHash('sha256').update(normalizeBaseUrl(baseUrl)).digest('hex');
}

function getBundledDefaultPath() {
  // 开发模式（electron .）下 process.defaultApp 在现代 Electron 已废弃不可靠，
  // 改用「打包资源是否存在」来判断：优先取 electron/resources 下的源码回退文件，
  // 不存在再回退到打包 resourcesPath。这样 dev / 打包两条链路都正确，且不依赖 process.defaultApp。
  const devPath = path.join(__dirname, '..', 'resources', 'default-remote-knowledge.json');
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  return path.join(process.resourcesPath, 'default-remote-knowledge.json');
}

function loadBundledRemoteKnowledgeDefault() {
  return JSON.parse(fs.readFileSync(getBundledDefaultPath(), 'utf-8'));
}

function normalizeRemoteKnowledgeConfig(value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  const defaults = fallback && typeof fallback === 'object' ? fallback : loadBundledRemoteKnowledgeDefault();
  return {
    base_url: normalizeBaseUrl(source.base_url || defaults.base_url),
    api_key: typeof source.api_key === 'string' ? source.api_key.trim() : String(defaults.api_key || '').trim(),
  };
}

module.exports = {
  getEndpointFingerprint,
  loadBundledRemoteKnowledgeDefault,
  normalizeBaseUrl,
  normalizeRemoteKnowledgeConfig,
};
