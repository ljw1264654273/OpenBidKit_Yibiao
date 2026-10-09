const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const pagePath = join(__dirname, 'pages/KnowledgeBasePage.tsx');
const routerPath = join(__dirname, '../../app/AppRouter.tsx');

test('本地知识库分类页可以返回标书知识库目录并保留分类标题', () => {
  const page = readFileSync(pagePath, 'utf8');
  const router = readFileSync(routerPath, 'utf8');

  assert.match(router, /<KnowledgeBasePage\s+knowledgeBaseId=\{knowledgeBaseId\}\s+onSectionChange=\{onSectionChange\}\s*\/>/);
  assert.match(page, /interface KnowledgeBasePageProps\s*\{[^}]*onSectionChange:\s*\(section:\s*SectionId\)\s*=>\s*void;/s);
  assert.match(page, /function KnowledgeBasePage\(\{\s*knowledgeBaseId,\s*onSectionChange\s*\}:\s*KnowledgeBasePageProps\)/);
  assert.match(page, /<button[^>]*className="knowledge-category-back"[^>]*onClick=\{\(\)\s*=>\s*onSectionChange\('bid-knowledge-base'\)\}[^>]*>\s*本地知识库\s*<\/button>/s);
  assert.match(page, /<strong>\{category\.label\}<\/strong>/);
});
