const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getWorkspaceDir, getHistoricalSourceVersionsDir } = require('../utils/paths.cjs');

function sourceHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function writeHistoricalSourceVersion(app, content) {
  const body = String(content || '');
  const hash = sourceHash(body);
  const directory = getHistoricalSourceVersionsDir(app);
  const filename = `${hash}.md`;
  const absolutePath = path.join(directory, filename);
  const reference = { hash, relativePath: path.relative(getWorkspaceDir(app), absolutePath) };
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(absolutePath)) {
    readHistoricalSourceVersion(app, reference);
    return reference;
  }
  const temporaryPath = path.join(directory, `.${hash}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, body, 'utf8');
    fs.renameSync(temporaryPath, absolutePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return reference;
}

function readHistoricalSourceVersion(app, reference) {
  const hash = String(reference?.hash || '');
  const expectedPath = path.join(getHistoricalSourceVersionsDir(app), `${hash}.md`);
  if (!/^[a-f0-9]{64}$/u.test(hash) || path.resolve(getWorkspaceDir(app), reference?.relativePath || '') !== expectedPath) {
    throw new Error('历史来源路径或哈希无效');
  }
  const content = fs.readFileSync(expectedPath, 'utf8');
  if (sourceHash(content) !== hash) throw new Error('历史来源快照已损坏：哈希不匹配');
  return content;
}

module.exports = { sourceHash, writeHistoricalSourceVersion, readHistoricalSourceVersion };
