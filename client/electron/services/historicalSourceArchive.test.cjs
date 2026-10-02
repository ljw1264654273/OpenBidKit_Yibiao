const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { writeHistoricalSourceVersion, readHistoricalSourceVersion } = require('./historicalSourceArchive.cjs');

test('中文路径以 UTF-8 原子保存、按哈希去重并检查损坏', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '易标历史来源-'));
  try {
    const app = { getPath: () => directory };
    const text = '# 五峰村\n原始正文。';
    const first = writeHistoricalSourceVersion(app, text);
    const second = writeHistoricalSourceVersion(app, text);
    assert.deepEqual(first, second);
    assert.equal(path.isAbsolute(first.relativePath), false);
    assert.equal(readHistoricalSourceVersion(app, first), text);
    fs.writeFileSync(path.join(directory, 'workspace', first.relativePath), '损坏', 'utf8');
    assert.throws(() => readHistoricalSourceVersion(app, first), /哈希|损坏/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
