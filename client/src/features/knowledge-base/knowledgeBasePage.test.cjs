const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const pagePath = join(__dirname, 'pages/KnowledgeBasePage.tsx');
const routerPath = join(__dirname, '../../app/AppRouter.tsx');
const stylesPath = join(__dirname, '../../styles/feature-knowledge-base.css');

test('本地知识库分类页可以返回标书知识库目录并保留分类标题', () => {
  const page = readFileSync(pagePath, 'utf8');
  const router = readFileSync(routerPath, 'utf8');
  const styles = readFileSync(stylesPath, 'utf8');

  assert.match(router, /<KnowledgeBasePage\s+knowledgeBaseId=\{knowledgeBaseId\}\s+onSectionChange=\{onSectionChange\}\s*\/>/);
  assert.match(page, /interface KnowledgeBasePageProps\s*\{[^}]*onSectionChange:\s*\(section:\s*SectionId\)\s*=>\s*void;/s);
  assert.match(page, /function KnowledgeBasePage\(\{\s*knowledgeBaseId,\s*onSectionChange\s*\}:\s*KnowledgeBasePageProps\)/);
  assert.match(page, /<button[^>]*className="knowledge-category-back"[^>]*onClick=\{\(\)\s*=>\s*onSectionChange\('bid-knowledge-base'\)\}[^>]*>\s*返回知识库目录\s*<\/button>/s);
  assert.match(styles, /\.knowledge-category-back\s*\{[^}]*min-height:\s*var\(--yb-control-height\)[^}]*padding:\s*6px 10px[^}]*background:\s*#fff;[^}]*border:\s*1px solid var\(--yb-border-soft\);[^}]*border-radius:\s*var\(--yb-radius-sm\)/s);
  assert.match(styles, /\.knowledge-category-back:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--yb-primary\)/s);
  assert.match(page, /<strong>\{category\.label\}<\/strong>/);
});
