import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';

test('knowledge bases are exposed as flat top-level navigation entries', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/menuConfig.ts'), 'utf8');
  const catalogSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/knowledge-base/knowledgeBaseCatalog.ts'),
    'utf8',
  );
  const expectedNavigationIds = [
    'document-knowledge-base',
    'national-standard-knowledge-base',
    'provincial-standard-knowledge-base',
    'municipal-standard-knowledge-base',
    'industry-standard-knowledge-base',
    'enterprise-knowledge-base',
    'remote-knowledge-base',
    'image-knowledge-base',
  ];

  assert.match(source, /KNOWLEDGE_BASE_CATALOG/);
  expectedNavigationIds.slice(0, 6).forEach((navigationId) => {
    assert.match(catalogSource, new RegExp(navigationId));
  });
  assert.match(catalogSource, /label:\s*'国标文档'/);
  assert.match(catalogSource, /label:\s*'省标文档'/);
  assert.match(catalogSource, /label:\s*'市标文档'/);
  assert.match(catalogSource, /label:\s*'行业标文档'/);
  assert.match(catalogSource, /label:\s*'企业文档'/);
  assert.match(source, /id:\s*'remote-knowledge-base'/);
  assert.match(source, /id:\s*'image-knowledge-base'/);
  assert.doesNotMatch(source, /id:\s*'knowledge-base'/);
  assert.match(source, /document:\s*'文档'/);
  assert.match(source, /'national-standard':\s*'国标'/);
  assert.match(source, /'provincial-standard':\s*'省标'/);
  assert.match(source, /'municipal-standard':\s*'市标'/);
  assert.match(source, /'industry-standard':\s*'行业标'/);
  assert.match(source, /enterprise:\s*'企业'/);
  assert.match(
    source,
    /description:\s*`管理\$\{knowledgeBaseDescriptionLabels\[item\.id\]\}资料、文件夹和可复用知识条目`/,
  );
  assert.doesNotMatch(source, /item\.label\.replace\(\/知识库\$\//);
});
