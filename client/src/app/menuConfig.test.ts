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
  assert.match(source, /id:\s*'remote-knowledge-base'/);
  assert.match(source, /id:\s*'image-knowledge-base'/);
  assert.doesNotMatch(source, /id:\s*'knowledge-base'/);
});
