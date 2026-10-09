import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readStyle = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

test('全局界面使用紧凑一致的字号与控件尺寸基线', () => {
  const tokens = readStyle('tokens.css');
  const shared = readStyle('shared-components.css');

  assert.match(tokens, /--yb-font-size-body:\s*14px/);
  assert.match(tokens, /--yb-font-size-control:\s*13px/);
  assert.match(tokens, /--yb-control-height:\s*34px/);
  assert.match(tokens, /body\s*\{[^}]*font-size:\s*var\(--yb-font-size-body\)[^}]*line-height:\s*1\.5/s);
  assert.match(shared, /\.primary-action,[\s\S]*?\.danger-action\s*\{[^}]*min-height:\s*var\(--yb-control-height\)[^}]*padding:\s*6px 12px[^}]*font-size:\s*var\(--yb-font-size-control\)/s);
  assert.match(shared, /\.text-button\s*\{[^}]*min-height:\s*28px[^}]*padding:\s*4px 6px[^}]*font-size:\s*var\(--yb-font-size-control\)/s);
  assert.match(shared, /\.floating-toolbar-button\s*\{[^}]*min-height:\s*var\(--yb-control-height\)[^}]*padding:\s*6px 12px[^}]*font-size:\s*var\(--yb-font-size-control\)/s);
});

test('共享页面骨架、弹窗和上传区使用收紧后的层级', () => {
  const layout = readStyle('layout-app-shell.css');
  const dialog = readStyle('shared-dialog.css');
  const upload = readStyle('shared-upload.css');

  assert.match(layout, /\.content-shell\s*\{[^}]*padding:\s*28px 36px/s);
  assert.match(layout, /\.page-stack\s*\{[^}]*gap:\s*20px/s);
  assert.match(dialog, /\.app-dialog-card,[\s\S]*?\.content-regenerate-card\s*\{[^}]*gap:\s*12px[^}]*padding:\s*20px/s);
  assert.match(dialog, /\.app-dialog-card-head h2,[\s\S]*?\.content-regenerate-card-head h2\s*\{[^}]*font-size:\s*20px/s);
  assert.match(upload, /\.upload-page-title h2\s*\{[^}]*font-size:\s*22px/s);
  assert.match(upload, /\.upload-row\s*\{[^}]*min-height:\s*72px[^}]*padding:\s*10px 14px/s);
});

test('主要业务页面采用统一的页面标题与工作区操作密度', () => {
  const technical = readStyle('feature-technical-plan.css');
  const bidProject = readStyle('feature-bid-project.css');
  const exportFormat = readStyle('feature-export-format.css');
  const knowledge = readStyle('feature-knowledge-base.css');

  assert.match(technical, /\.global-facts-reader-head\s*\{[^}]*padding:\s*16px 18px/s);
  assert.match(technical, /\.global-facts-reader-head strong\s*\{[^}]*font-size:\s*20px/s);
  assert.match(technical, /\.global-facts-reader-actions\s*\{[^}]*gap:\s*6px/s);
  assert.match(technical, /\.content-reader-head\s*\{[^}]*padding:\s*16px 18px/s);
  assert.match(technical, /\.content-reader-head strong\s*\{[^}]*font-size:\s*20px/s);
  assert.match(bidProject, /\.bid-project-page-head h1\s*\{[^}]*font-size:\s*24px/s);
  assert.match(exportFormat, /\.export-format-header h2\s*\{[^}]*font-size:\s*22px/s);
  assert.match(knowledge, /\.knowledge-breadcrumb strong\s*\{[^}]*font-size:\s*16px/s);
});

test('独立页签、图标按钮和表单控件沿用统一紧凑密度', () => {
  const shared = readStyle('shared-components.css');
  const settings = readStyle('feature-settings.css');
  const rejection = readStyle('feature-rejection-check.css');
  const duplicate = readStyle('feature-duplicate-check.css');
  const knowledge = readStyle('feature-knowledge-base.css');
  const expansion = readStyle('feature-bid-project-expansion.css');

  assert.match(shared, /\.secondary-menu-row\s*\{[^}]*min-height:\s*72px[^}]*padding:\s*14px 18px/s);
  assert.match(settings, /\.settings-tab\s*\{[^}]*min-height:\s*var\(--yb-control-height\)[^}]*padding:\s*6px 14px[^}]*font-size:\s*var\(--yb-font-size-control\)/s);
  assert.match(settings, /\.export-bullet-option\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/s);
  assert.match(rejection, /\.rejection-check-result-tab\s*\{[^}]*min-height:\s*68px[^}]*padding:\s*12px 16px/s);
  assert.match(duplicate, /\.duplicate-analysis-tab\s*\{[^}]*min-height:\s*68px[^}]*padding:\s*12px 16px/s);
  assert.match(knowledge, /\.knowledge-move-form select\s*\{[^}]*min-height:\s*var\(--yb-control-height\)/s);
  assert.match(knowledge, /\.knowledge-analysis-command input\s*\{[^}]*height:\s*var\(--yb-control-height\)/s);
  assert.match(expansion, /\.expansion-create-head h1\s*\{\s*font-size:\s*24px;/s);
});

test('共享表面使用批准的紧凑圆角阶梯', () => {
  const tokens = readStyle('tokens.css');
  const shared = readStyle('shared-components.css');
  const dialog = readStyle('shared-dialog.css');
  const appShellDialogs = readStyle('app-shell-dialogs.css');
  const upload = readStyle('shared-upload.css');
  const markdown = readStyle('shared-markdown.css');

  assert.match(tokens, /--yb-radius-sm:\s*4px/);
  assert.match(tokens, /--yb-radius-md:\s*6px/);
  assert.match(tokens, /--yb-radius-lg:\s*8px/);
  assert.match(tokens, /--yb-radius-xl:\s*8px/);
  assert.match(tokens, /--yb-radius-pill:\s*999px/);

  assert.match(shared, /\.panel,[\s\S]*?\.empty-panel\s*\{[^}]*border-radius:\s*var\(--yb-radius-xl\)/s);
  assert.match(shared, /\.primary-action,[\s\S]*?\.danger-action\s*\{[^}]*border-radius:\s*var\(--yb-radius-sm\)/s);
  assert.match(dialog, /\.content-regenerate-card textarea\s*\{[^}]*border-radius:\s*var\(--yb-radius-sm\)/s);
  assert.match(dialog, /\.app-dialog-card,[\s\S]*?\.content-regenerate-card\s*\{[^}]*border-radius:\s*var\(--yb-radius-xl\)/s);
  assert.match(appShellDialogs, /\.license-status-card\s*\{[^}]*border-radius:\s*var\(--yb-radius-xl\)/s);
  assert.match(appShellDialogs, /\.offline-license-code-field textarea\s*\{[^}]*border-radius:\s*var\(--yb-radius-md\)/s);
  assert.match(upload, /\.upload-board\s*\{[^}]*border-radius:\s*var\(--yb-radius-xl\)/s);
  assert.match(markdown, /\.markdown-viewer \.markdown-table-scroll\s*\{[^}]*border-radius:\s*var\(--yb-radius-md\)/s);
  assert.match(markdown, /\.mermaid-preview-card\s*\{[^}]*border-radius:\s*var\(--yb-radius-lg\)/s);
});

test('共享圆角基线为开发者与测试页保留原有半径', () => {
  const tokens = readStyle('tokens.css');
  assert.match(tokens, /\.developer-test-page,[\s\S]*?\.developer-multimodal-test-page,[\s\S]*?\.developer-expansion-replace-test-page,[\s\S]*?\.developer-secondary-demo-page,[\s\S]*?html\.token-stats-transparent-root,[\s\S]*?html\.agent-monitor-root\s*\{[^}]*--yb-radius-sm:\s*8px[^}]*--yb-radius-md:\s*12px[^}]*--yb-radius-lg:\s*16px[^}]*--yb-radius-xl:\s*24px/s);
  assert.doesNotMatch(readStyle('shared-components.css'), /\.developer-[\w-]*\s*\{/);
  assert.doesNotMatch(readStyle('shared-dialog.css'), /\.developer-[\w-]*\s*\{/);
  assert.doesNotMatch(readStyle('app-shell-dialogs.css'), /\.developer-[\w-]*\s*\{/);
  assert.doesNotMatch(readStyle('shared-upload.css'), /\.developer-[\w-]*\s*\{/);
  assert.doesNotMatch(readStyle('shared-markdown.css'), /\.developer-[\w-]*\s*\{/);
});

test('知识库页面、空态和弹窗沿用新建标书的克制表面与紧凑圆角', () => {
  const knowledge = readStyle('feature-knowledge-base.css');

  assert.match(knowledge, /\.knowledge-workspace-bar\s*\{[^}]*background:\s*#fff;[^}]*border:\s*1px solid var\(--yb-border-soft\);[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/s);
  assert.match(knowledge, /\.remote-knowledge-page-panel\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/s);
  assert.match(knowledge, /\.knowledge-folder-panel,[\s\S]*?\.knowledge-document-panel,[\s\S]*?\.knowledge-preview-panel\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/s);
  assert.match(knowledge, /\.knowledge-viewer-panel\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*8px;[^}]*box-shadow:\s*none;/s);
  assert.match(knowledge, /\.knowledge-empty-box\s*\{[^}]*background:\s*#fff;[^}]*border-radius:\s*6px/s);
  assert.match(knowledge, /\.knowledge-source-dialog-card\s*\{[^}]*border-radius:\s*8px/s);
  assert.match(knowledge, /\.knowledge-create-folder-form input,[\s\S]*?\.knowledge-create-folder-form select\s*\{[^}]*border-radius:\s*(?:6px|var\(--yb-radius-md\))/s);
});
