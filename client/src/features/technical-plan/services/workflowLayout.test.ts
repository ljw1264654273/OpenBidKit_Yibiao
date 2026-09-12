import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = (name: string) => {
  const url = new URL(`../components/${name}.tsx`, import.meta.url);
  assert.equal(existsSync(url), true, `${name}.tsx 应存在`);
  return readFileSync(url, 'utf8');
};

test('紧凑任务进度始终显示进度条并通过弹层查看过程', () => {
  const source = componentSource('CompactTaskProgress');

  assert.match(source, /<ProgressBar/);
  assert.match(source, /<Popover\.Trigger asChild>/);
  assert.match(source, /aria-label="查看过程"/);
  assert.match(source, /<Popover\.Content/);
});

test('自适应双栏提供两组标签和容器窄屏切换', () => {
  const source = componentSource('AdaptiveTwoPaneWorkspace');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(source, /role="tablist"/);
  assert.equal((source.match(/role="tab"/g) || []).length, 2);
  assert.equal((source.match(/role="tabpanel"/g) || []).length, 2);
  assert.match(css, /\.adaptive-workspace-shell\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)[^}]*container-type:\s*inline-size/s);
  assert.match(css, /@container\s*\(max-width:\s*759px\)/);
  assert.doesNotMatch(css, /@container\s*\(max-width:\s*759px\)\s*\{[\s\S]*?\.adaptive-workspace-shell\s*\{/s);
});

test('招标解析把常显进度和双栏切换放到公共工作区', () => {
  const source = readFileSync(new URL('../pages/BidAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /progressCollapsed/);
  assert.match(source, /setWorkspacePane\('content'\)/);
});

test('全局事实使用单一编辑预览工作面并保留当前模式', () => {
  const source = readFileSync(new URL('../pages/GlobalFactsPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /progressCollapsed/);
  assert.match(source, /useState<'edit' \| 'preview'>\('edit'\)/);
  assert.match(source, /editorMode === 'preview' \? '编辑' : '预览'/);
  assert.match(source, /editorMode === 'edit' \? \(/);
});

test('正文生成把现有阶段进度原样放入公共命令区', () => {
  const source = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<CompactTaskProgress/);
  assert.match(source, /value=\{displayProgress\}/);
  assert.match(source, /summary=\{displayProgressCount\}/);
  assert.match(source, /status=\{displayProgressLabel\}/);
  assert.match(source, /tone=\{progressTone\}/);
  assert.match(source, /active=\{progressActive\}/);
  assert.match(source, /<AdaptiveTwoPaneWorkspace/);
  assert.doesNotMatch(source, /statsCollapsed/);
  assert.match(source, /setWorkspacePane\('content'\)/);
});

test('正文生成目录支持拖拽调宽并让长标题最多显示两行', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const workspaceSource = componentSource('AdaptiveTwoPaneWorkspace');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(pageSource, /resizableNavigation=\{\{/);
  assert.match(pageSource, /defaultWidth:\s*380/);
  assert.match(pageSource, /title=\{formattedTitle\}/);
  assert.match(workspaceSource, /role="separator"/);
  assert.match(workspaceSource, /onPointerDown=\{startNavigationResize\}/);
  assert.match(workspaceSource, /onKeyDown=\{handleSeparatorKeyDown\}/);
  assert.match(css, /\.adaptive-workspace-grid\.is-resizable\s*\{[^}]*grid-template-columns:\s*var\(--adaptive-navigation-width,\s*380px\)\s+8px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.content-outline-text strong\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*2;[^}]*\}/s);
});

test('选择标书使用局部紧凑上传样式并保留正文阅读器', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /<UploadBoard[^>]*className="technical-document-upload-board"/s);
  assert.match(source, /technical-document-reader-card analysis-markdown-card/);
  assert.match(source, /<MarkdownFullscreenViewer/);
});

test('STEP 01 以解析为主并把快速配置折叠成可展开摘要', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');
  const quickConfig = readFileSync(new URL('./quickConfig.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /quick-config-grid/);
  assert.match(source, /quick-config-collapsible/);
  assert.match(source, /aria-expanded=\{quickConfigExpanded\}/);
  assert.match(source, /localStorage\.getItem\(QUICK_CONFIG_STORAGE_KEY\)[\s\S]*storedValue !== 'false'/);
  assert.match(source, /localStorage/);
  assert.match(quickConfig, /约50-100页/);
  assert.match(quickConfig, /约1200-1500页/);
  assert.doesNotMatch(source, /默认（不控制）/);
  assert.match(source, /isQuickConfigLocked/);
  assert.match(source, /checkBidSections/);
  assert.match(source, /sectionDetectionRequestRef/);
});

test('STEP 01 快速配置和招标文件内容默认展开', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /useState\(\(\) => \{[\s\S]*QUICK_CONFIG_STORAGE_KEY[\s\S]*storedValue !== 'false'/);
  assert.match(source, /const \[documentContentExpanded, setDocumentContentExpanded\] = useState\(true\)/);
  assert.match(source, /aria-expanded=\{documentContentExpanded\}/);
  assert.match(source, /if \(nextExpanded\) updateQuickConfigExpanded\(false\)/);
  assert.match(source, /\{documentContentExpanded && \(/);
});

test('STEP 01 已确认投标范围不再显示重复提示条，展开文件内容会收起快速配置', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(source, /\{bidSectionDetection\?\.hasMultiple && !selectedSectionTitle && \(/);
  assert.doesNotMatch(source, /<strong>\{selectedSectionTitle \? '投标范围已确认'/);
  assert.match(source, /const toggleDocumentContent = \(\) => \{[\s\S]*setDocumentContentExpanded\(nextExpanded\)[\s\S]*if \(nextExpanded\) updateQuickConfigExpanded\(false\)/);
});

test('STEP 01 下一步受快速配置完成状态控制', () => {
  const home = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');

  assert.match(home, /isQuickConfigComplete/);
  assert.match(home, /state\.step === 'document-analysis' && !quickConfigComplete/);
  assert.match(home, /quickConfigMissingItems/);
});

test('STEP 01 上传招标文件成功后重新展开快速配置', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');
  const importFlow = source.slice(
    source.indexOf('const importTenderDocument'),
    source.indexOf('const removeTenderDocument'),
  );

  assert.match(importFlow, /onFileImported\(state, result\.markdown\);[\s\S]*updateQuickConfigExpanded\(true\)/);
  assert.match(importFlow, /updateQuickConfigExpanded\(true\);[\s\S]*setDocumentContentExpanded\(true\)/);
});

test('STEP 01 导入疑似多标段文件后自动启动已有 AI 标段识别任务', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');

  assert.match(
    source,
    /setBidSectionDetection\(result\.bidSectionDetection \|\| null\)[\s\S]*result\.bidSectionDetection\?\.hasMultiple[\s\S]*startBidSectionExtraction\(\)/,
  );
});

test('STEP 01 加载已有招标文件时也会自动启动多标段 AI 识别', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');
  const detectionEffect = source.slice(
    source.indexOf('window.yibiao?.technicalPlan.checkBidSections()'),
    source.indexOf('const resolveDroppedFilePaths'),
  );

  assert.match(
    detectionEffect,
    /checkBidSections\(\)\.then\(\(detection\) => \{[\s\S]*detection\?\.hasMultiple[\s\S]*startBidSectionExtraction\(\)/,
  );
});

test('STEP 02 使用第一步确定的投标范围，正文任务锁定解析入口', () => {
  const source = readFileSync(new URL('../pages/BidAnalysisPage.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');

  assert.match(source, /contentTaskStatus/);
  assert.match(source, /bidSectionMode === 'multiple'[\s\S]*selectedSectionTitle/);
  assert.match(source, /isQuickConfigLocked\(contentTaskStatus\)/);
  assert.doesNotMatch(source, /更换标段/);
  assert.match(home, /<DocumentAnalysisPage[\s\S]*contentTaskStatus=\{state\.contentGenerationTask\?\.status\}/);
  assert.match(home, /<BidAnalysisPage[\s\S]*contentTaskStatus=\{state\.contentGenerationTask\?\.status\}/);
});

test('STEP 02 开始解析直接执行且不再修改多标段', () => {
  const source = readFileSync(new URL('../pages/BidAnalysisPage.tsx', import.meta.url), 'utf8');
  const commandActions = source.slice(
    source.indexOf('<div className="bid-analysis-command-actions">'),
    source.indexOf('</section>', source.indexOf('<div className="bid-analysis-command-actions">')),
  );

  assert.match(commandActions, /onClick=\{\(\) => \{ void startAnalysis\(undefined, effectiveSelectedTaskIds\); \}\}/);
  assert.match(commandActions, /onClick=\{openSettingsDialog\}/);
  assert.doesNotMatch(source, /<strong>投标范围<\/strong>/);
  assert.doesNotMatch(source, /更换标段/);
  assert.doesNotMatch(source, /openSectionSelectorFromConfig|startSectionExtractionOnly|sectionModeWarning/);
  assert.doesNotMatch(source, /<BidSectionSelectorDialog/);
});

test('STEP 03 技术文件结构默认独立成册', () => {
  const page = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../hooks/useTechnicalPlanWorkflow.ts', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../../../../electron/services/technicalPlanStore.cjs', import.meta.url), 'utf8');

  assert.match(page, /outlineMode === 'standalone-technical' \? 'standalone-technical' : 'response-file'/);
  assert.match(home, /outlineMode: 'standalone-technical' as const/);
  assert.match(workflow, /outlineMode: 'standalone-technical'/);
  assert.match(store, /outlineMode: 'standalone-technical'/);
  assert.match(store, /VALUES \(1, 'technical-plan', 'document-analysis', 'key', 'standalone-technical'/);
  assert.match(store, /function defaultOutlineModeForWorkflow[\s\S]*existing-plan-expansion[\s\S]*aligned[\s\S]*standalone-technical/);
  assert.match(store, /outline_mode: defaultOutlineModeForWorkflow\(ensureMetaRow\(\)\.workflow_kind\)/);
});

test('扩写步骤只优化真实占位状态而不伪造业务控件', () => {
  const source = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const placeholder = source.split("state.step === 'expand'")[1]?.split('<AppDialog')[0] || '';

  assert.match(placeholder, /className="plan-step-body technical-plan-expand-page"/);
  assert.match(placeholder, /className="technical-plan-expand-command-bar"[\s\S]*STEP 06[\s\S]*扩写改写/);
  assert.match(placeholder, /technical-plan-expand-placeholder/);
  assert.match(placeholder, /feature-under-development-overlay/);
  assert.doesNotMatch(placeholder, /改写设置|重新生成|保存并完成/);
});

test('窄窗口命令栏把标题、进度和操作分行以保留工作区高度', () => {
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  const responsiveRules = css.match(/@media\s*\(max-width:\s*1199px\)[\s\S]*$/)?.[0] || '';

  assert.match(responsiveRules, /\.bid-analysis-command-bar,[\s\S]*\.global-facts-command-bar,[\s\S]*\.content-generation-command-bar\s*\{[^}]*grid-template-areas:\s*"title title"\s*"meta actions"/s);
  assert.match(responsiveRules, /\.bid-analysis-command-bar\s*>\s*:first-child,[\s\S]*\.global-facts-command-bar\s*>\s*:first-child,[\s\S]*\.content-generation-command-bar\s*>\s*:first-child\s*\{[^}]*grid-area:\s*title/s);
});

test('目录生成状态栏以两行摘要配合同排进度和操作保持紧凑', () => {
  const source = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(source, /<div className="outline-command-title">\s*<span className="section-kicker">STEP 03<\/span>\s*<strong>目录生成<\/strong>\s*<\/div>\s*<p>/s);
  assert.match(css, /\.outline-command-bar:has\(> \.outline-command-summary\)\s*\{[^}]*display:\s*grid;[^}]*grid-template-areas:\s*"summary progress actions";[^}]*padding:\s*8px 12px;/s);
  assert.match(css, /\.outline-command-summary\s*\{[^}]*grid-area:\s*summary;[^}]*display:\s*grid;[^}]*gap:\s*2px;/s);
  assert.match(css, /\.outline-command-progress\s*\{[^}]*grid-area:\s*progress;/s);
  assert.match(css, /\.outline-command-summary\s*~\s*\.outline-command-actions\s*\{[^}]*grid-area:\s*actions;[^}]*flex-wrap:\s*nowrap;/s);
});

test('目录原文面板只展示当前分屏并保留精确原文高亮', () => {
  const source = readFileSync(new URL('../components/TenderSourcePanel.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /MarkdownFullscreenViewer/);
  assert.doesNotMatch(source, /全屏查看招标原文/);
  assert.match(source, /normalizeTableFragments/);
  assert.match(source, /<MarkdownRenderer allowRawHtml highlightSourceAnchor=\{activeSourceItem \? 'primary' : undefined\} preserveTableCellSpans>/);
  assert.doesNotMatch(source, /extractSourceKeywords|selectedItem\?\.description/);
  const rendererSource = readFileSync(new URL('../../../shared/ui/MarkdownRenderer.tsx', import.meta.url), 'utf8');
  assert.match(rendererSource, /highlightAnchoredTextNodes\(root, highlightSourceAnchor\)/);
  assert.match(rendererSource, /preserveTableCellSpans\?: boolean/);
  assert.match(rendererSource, /preserveTableCellSpans = false/);
  assert.match(rendererSource, /preserveTableCellSpans \? getTableCellSpan\(element, 'rowspan'\) : undefined/);
  assert.match(rendererSource, /preserveTableCellSpans \? getTableCellSpan\(element, 'colspan'\) : undefined/);
  const documentAnalysisSource = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(documentAnalysisSource, /preserveTableCellSpans/);
  assert.match(css, /\.outline-source-panel-document\.markdown-viewer \.markdown-table-scroll\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.outline-source-panel-document\.markdown-viewer table\s*\{[^}]*width:\s*100%;[^}]*table-layout:\s*fixed;/s);
});

test('目录详情提供 AI 添加子目录并直接使用 add-child 持久化', () => {
  const source = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const addAiChildren = async/);
  assert.match(source, /window\.yibiao\?\.ai\?\.requestJson/);
  assert.match(source, /'add-child', \[selectedItem\.id\]\)/);
  assert.match(source, /AI 添加子目录/);
});

test('其余活动步骤沿用两行摘要和紧凑命令栏标准', () => {
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(css, /\.technical-document-upload-board \.upload-page-title > div:first-child,[\s\S]*\.bid-analysis-command-bar > :first-child,[\s\S]*\.global-facts-command-bar > :first-child,[\s\S]*\.content-generation-command-bar > :first-child,[\s\S]*\.technical-plan-expand-command-bar > div\s*\{[^}]*display:\s*grid;[^}]*grid-template-areas:\s*"kicker title"\s*"description description";[^}]*gap:\s*2px 10px;/s);
  assert.match(css, /\.bid-analysis-command-bar,[\s\S]*\.global-facts-command-bar,[\s\S]*\.content-generation-command-bar\s*\{[^}]*grid-template-areas:\s*"title meta actions";[^}]*gap:\s*8px 12px;[^}]*padding:\s*8px 12px;/s);
  assert.match(css, /\.technical-workbench :where\(\.bid-analysis-command-actions, \.global-facts-command-actions, \.content-generation-actions\) button\s*\{[^}]*min-height:\s*32px;[^}]*padding:\s*5px 9px;/s);
  assert.match(css, /\.technical-workbench :where\(\.bid-analysis-command-actions, \.global-facts-command-actions, \.content-generation-actions\) \.outline-config-action\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s);
});

test('技术方案工作台使用原型的直角面板和小圆角控件', () => {
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(css, /\.technical-workbench\s*\{[^}]*--technical-workbench-control-radius:\s*6px/s);
  assert.match(css, /\.technical-document-upload-board,[\s\S]*\.bid-analysis-command-bar,[\s\S]*\.outline-command-bar,[\s\S]*\.global-facts-command-bar,[\s\S]*\.content-generation-command-bar,[\s\S]*\.technical-plan-expand-placeholder\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.bid-analysis-task-item,[\s\S]*\.global-facts-item,[\s\S]*\.content-outline-item\s*\{[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /\.technical-workbench\s+:where\(\.primary-action,\s*\.secondary-action,\s*\.danger-action,\s*\.outline-config-action,\s*\.compact-task-progress-trigger\)\s*\{[^}]*border-radius:\s*var\(--technical-workbench-control-radius\)/s);
  assert.match(css, /\.technical-workbench\s+\.outline-command-summary\s*~\s*\.outline-command-actions\s+button\s*\{[^}]*border-radius:\s*var\(--technical-workbench-control-radius\)/s);
  assert.match(css, /\.technical-workbench\s+\.floating-toolbar,[\s\S]*\.technical-workbench\s+\.floating-toolbar-button\s*\{[^}]*border-radius:\s*var\(--yb-radius-pill\)/s);
});
