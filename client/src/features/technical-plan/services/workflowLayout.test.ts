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

test('第五步已生成状态悬停显示 AI 改写并直接打开改写弹窗', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(pageSource, /status === 'success' \? ' is-rewriteable' : ''/);
  assert.match(pageSource, /<span className="content-outline-status-label">\{statusLabels\[status\]\}<\/span>/);
  assert.match(pageSource, /content-outline-rewrite-label/);
  assert.match(pageSource, />AI改写<\/span>/);
  assert.match(pageSource, /setRequirementItem\(item\)/);
  assert.doesNotMatch(pageSource, /confirmRegenerateItem/);
  assert.doesNotMatch(pageSource, /<Popover\.Root/);
  assert.doesNotMatch(pageSource, /重新生成此小节\?/);
  assert.match(css, /\.content-outline-item em\.is-rewriteable\s*\{[^}]*min-width:\s*52px;[^}]*text-align:\s*center;/s);
  assert.match(css, /\.content-outline-item em\.is-rewriteable:hover \.content-outline-status-label/);
  assert.match(css, /\.content-outline-item em\.is-rewriteable:hover \.content-outline-rewrite-label/);
  assert.doesNotMatch(css, /\.content-regenerate-popover/);
});

test('第五步正文预览统一普通正文并让正文层次字体字号服从模板', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  const previewUsages = pageSource.match(/className="markdown-viewer content-generation-output export-format-preview[^"]*"/g) || [];
  const previewCssStart = css.indexOf('/* 第五步正文预览');
  const previewCssEnd = css.indexOf('.content-generation-empty', previewCssStart);
  const previewCss = css.slice(previewCssStart, previewCssEnd);

  assert.equal(previewUsages.length, 2);
  assert.ok(previewUsages.every((usage) => usage.includes('technical-plan-content-preview')));
  assert.match(css, /\.technical-plan-content-preview\s*>\s*p:not\(\.markdown-figure-caption\)\s*\{[^}]*font-family:\s*var\(--ef-body-font[^}]*font-size:\s*var\(--ef-body-size[^}]*line-height:\s*var\(--ef-body-line-height/s);
  assert.match(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+:where\(h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\)\s*\{[^}]*font-family:\s*var\(--ef-body-font[^}]*font-size:\s*var\(--ef-body-size[^}]*font-weight:\s*400/s);
  assert.match(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+:where\(h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6\)\s+strong/s);
  assert.match(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+(?:ul|ol)[\s\S]*font-weight:\s*400/);
  assert.doesNotMatch(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+(?:ul|ol)[\s\S]*font-family:\s*var\(--ef-body-font/);
  assert.doesNotMatch(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+(?:ul|ol)[\s\S]*font-size:\s*var\(--ef-body-size/);
  assert.match(previewCss, /\.markdown-viewer\.export-format-preview\.technical-plan-content-preview\s+(?:ul|ol)[\s\S]*line-height:\s*var\(--ef-body-line-height/);
  assert.match(previewCss, /\.technical-plan-content-preview\s*>\s*p:not\(\.markdown-figure-caption\)\s+strong/);
  assert.match(previewCss, /\.technical-plan-content-preview\s*>\s*p:not\(\.markdown-figure-caption\)\s+b/);
  assert.match(css, /\.technical-plan-content-preview[\s\S]*font-weight:\s*600/);
  assert.doesNotMatch(css, /\.markdown-viewer\.export-format-preview\s+(?:strong|b)\s*\{/);
});

test('第五步正文预览启用正文层次结构纠正，避免历史编号破坏嵌套列表', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const rendererSource = readFileSync(new URL('../../../shared/ui/MarkdownRenderer.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /normalizeOrderedListStructure/);
  assert.match(rendererSource, /normalizeOrderedListStructure\?: boolean/);
  assert.match(rendererSource, /normalizeOrderedListMarkers\(children\)/);
});

test('第五步提供统一图片审核和 AI 重绘操作区', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /图片审核/);
  assert.match(pageSource, /confirmIllustrationReviewItem/);
  assert.match(pageSource, /skipIllustrationReviewItem/);
  assert.match(pageSource, /adoptIllustrationReviewItem/);
  assert.match(pageSource, /adjustIllustrationReviewItem/);
  assert.match(pageSource, /AI 重绘当前图片/);
  assert.match(pageSource, /AI 重绘要求/);
  assert.match(pageSource, /当前图片效果/);
  assert.match(pageSource, /AI 重绘候选/);
  assert.match(pageSource, /采用重绘结果/);
  assert.match(pageSource, /allowRawHtml=\{false\}/);
  assert.match(pageSource, /renderMermaid/);
  assert.doesNotMatch(pageSource, /流程图代码/);
  assert.doesNotMatch(pageSource, /AI 调整代码/);
  assert.doesNotMatch(pageSource, /重绘备注/);
  assert.doesNotMatch(pageSource, /AI 调整流程图/);
  assert.doesNotMatch(pageSource, /单图 AI 重绘/);
  assert.doesNotMatch(pageSource, /批量 AI 重绘/);
  assert.match(homeSource, /onPlanPatched/);
  assert.match(homeSource, /setState\(\(prev\) => \(\{ \.\.\.prev, \.\.\.patch \}\)\)/);
});

test('图片审核确认后保留弹窗并继续选择下一张待确认图', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const confirmStart = pageSource.indexOf('const confirmMermaidReviewItem = async');
  const confirmEnd = pageSource.indexOf('const skipMermaidReviewItem = async', confirmStart);
  const confirmSource = pageSource.slice(confirmStart, confirmEnd);

  assert.match(pageSource, /redrawCandidateCount/);
  assert.match(pageSource, /selectNextPendingMermaidReviewItem/);
  assert.match(confirmSource, /selectNextPendingMermaidReviewItem\(item\.item_id\)/);
  assert.doesNotMatch(confirmSource, /setMermaidReviewOpen\(false\)/);
  assert.match(pageSource, /redrawCurrentIllustration/);
  assert.match(confirmSource, /convertMermaidIllustrationReviewItem/);
  assert.match(confirmSource, /item\.kind === 'mermaid'/);
});

test('Mermaid 审核入口跟随对应章节状态按钮并按章节定位', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /getMermaidReviewItemsForSection/);
  assert.match(pageSource, /openMermaidReviewForSection/);
  assert.match(pageSource, /openMermaidReviewForSection\(item\.id\)/);
  assert.match(pageSource, /content-outline-mermaid-review-action/);
  assert.match(pageSource, /审核图片/);
  assert.match(pageSource, /mermaidReviewItemsForSection\.length/);
  assert.doesNotMatch(pageSource, /<button type="button" className="primary-action" onClick=\{\(\) => setMermaidReviewOpen\(true\)\}>\s*审核 Mermaid 图/);
});

test('第五步三类图片都保留审核入口并兼容历史缺少 review_status 的图片项', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /const mermaidReviewItems = useMemo\(\(\) => \(contentIllustrationPlan\?\.items \|\| \[\]\)/);
  assert.match(pageSource, /const getMermaidReviewStatus = \(item: ContentIllustrationPlanItem\)/);
  assert.match(pageSource, /getMermaidReviewStatus\(item\) === 'pending'/);
  assert.match(pageSource, /流程图先审核/);
  assert.doesNotMatch(pageSource, /是否将 Mermaid 改用 AI 图片重绘/);
  assert.doesNotMatch(pageSource, /\.filter\(\(item\) => item\.kind === 'mermaid' && item\.generation\?\.review_status\)/);
});

test('图片汇总条提供审核全部总入口并优先打开待确认图', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /const openAllMermaidReview = \(\) =>/);
  assert.match(pageSource, /openAllMermaidReview/);
  assert.match(pageSource, /className="primary-action content-mermaid-review-all-action"/);
  assert.match(pageSource, /审核全部（\{mermaidReviewItems\.length\}）/);
  assert.match(pageSource, /sectionReviewItems\.find\(\(item\) => getMermaidReviewStatus\(item\) === 'pending'\)/);
});

test('图片审核弹窗不再提供流程图代码编辑区', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.doesNotMatch(pageSource, /流程图代码/);
  assert.doesNotMatch(pageSource, /mermaidReviewDraftCode/);
  assert.match(pageSource, /handleMermaidAiInstructionPaste/);
  assert.match(pageSource, /adjustIllustrationReviewItem/);
  assert.match(pageSource, /AI 重绘当前图片/);
  assert.match(pageSource, /AI 重绘要求/);
  assert.match(css, /\.content-mermaid-ai-inline-bar/);
  assert.match(css, /\.content-mermaid-ai-input/);
});

test('图片审核的确认动作不再串联旧的单图或批量重绘任务', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const confirmStart = pageSource.indexOf('const confirmMermaidReviewItem = async');
  const confirmEnd = pageSource.indexOf('const skipMermaidReviewItem = async', confirmStart);
  const confirmSource = pageSource.slice(confirmStart, confirmEnd);

  assert.doesNotMatch(confirmSource, /startIllustrationRedraw/);
  assert.doesNotMatch(confirmSource, /redrawConfirmedIllustrations/);
  assert.match(confirmSource, /confirmIllustrationReviewItem/);
});

test('通用图片重绘请求覆盖 AI 配图、流程图和 PPT 图', () => {
  const reviewSource = readFileSync(new URL('../../../../electron/services/contentIllustrationReview.cjs', import.meta.url), 'utf8');
  const generationSource = readFileSync(new URL('../../../../electron/services/contentIllustrationGeneration.cjs', import.meta.url), 'utf8');

  assert.match(reviewSource, /generateAiRedrawCandidate/);
  assert.match(reviewSource, /generateMermaidRedrawCandidateFromCode/);
  assert.match(reviewSource, /convertMermaidIllustrationReviewItem/);
  assert.match(reviewSource, /generateHtmlRedrawCandidate/);
  assert.match(reviewSource, /saveIllustrationRedrawCandidate/);
  assert.match(generationSource, /buildAiRedrawPrompt\(execution, options\.instruction\)/);
  assert.match(generationSource, /buildHtmlRedrawPrompt\(execution, originalHtml, instruction\)/);
});

test('流程图图片化不再先调用文本模型修改 Mermaid 代码', () => {
  const reviewSource = readFileSync(new URL('../../../../electron/services/contentIllustrationReview.cjs', import.meta.url), 'utf8');
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const convertStart = reviewSource.indexOf('async function convertMermaidIllustrationReviewItem');
  const convertEnd = reviewSource.indexOf('async function adjustIllustrationReviewItem', convertStart);
  const convertSource = reviewSource.slice(convertStart, convertEnd);
  assert.match(convertSource, /generateMermaidRedrawCandidateFromCode/);
  assert.doesNotMatch(convertSource, /adjustMermaidReviewCode/);
  assert.match(pageSource, /convertMermaidIllustrationReviewItem/);
  assert.match(pageSource, /流程已确认，待生成 AI 图片/);
});

test('流程图审核阶段优先显示 Mermaid 结构，采用候选后才显示最终 AI 图片', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  assert.match(pageSource, /selectedMermaidReviewItem\?\.kind === 'mermaid' && selectedMermaidReviewCode && !selectedMermaidReviewItem\.generation\?\.asset_url/);
  assert.match(pageSource, /重新生成 AI 图片/);
  assert.match(pageSource, /采用重绘结果/);
});

test('图片审核弹窗保留 B 布局和流程图预览高度', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  const reviewCss = css.slice(css.indexOf('.content-mermaid-review-card'), css.indexOf('/* 进度条已迁移到共享'));

  assert.match(pageSource, /mermaidPreviewZoom/);
  assert.match(pageSource, /setMermaidPreviewZoom/);
  assert.match(pageSource, /aria-label="缩小流程图预览"/);
  assert.match(pageSource, /aria-label="放大流程图预览"/);
  assert.match(pageSource, /style=\{mermaidPreviewZoomStyle\}/);
  assert.match(reviewCss, /height:\s*min\(920px,\s*calc\(100vh\s*-\s*24px\)\)/);
  assert.match(reviewCss, /\.content-mermaid-review-grid\s*\{[^}]*height:\s*100%/s);
  assert.match(reviewCss, /\.content-mermaid-review-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.doesNotMatch(reviewCss, /\.content-mermaid-review-left\s*\{/);
  assert.match(reviewCss, /\.content-mermaid-ai-inline-bar\s*\{[^}]*grid-column:\s*1\s+\/\s*-1[^}]*grid-template-columns:/s);
  assert.match(reviewCss, /\.content-mermaid-ai-input\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(reviewCss, /\.content-mermaid-review-preview-panel\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(reviewCss, /\.content-mermaid-review-preview-scale\s*\{[^}]*transform-origin:\s*top left/s);
  assert.match(pageSource, /content-illustration-review-current/);
  assert.match(pageSource, /content-illustration-review-candidate/);
});

test('Mermaid 审核预览使用固定画布并支持滚轮缩放和拖拽平移', () => {
  const pageSource = readFileSync(new URL('../pages/ContentEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  const reviewCss = css.slice(css.indexOf('.content-mermaid-review-card'), css.indexOf('/* 进度条已迁移到共享'));

  assert.match(pageSource, /MERMAID_PREVIEW_ZOOM_MAX\s*=\s*5/);
  assert.match(pageSource, /mermaidPreviewPan/);
  assert.match(pageSource, /handleMermaidPreviewWheel/);
  assert.match(pageSource, /handleMermaidPreviewPointerDown/);
  assert.match(pageSource, /handleMermaidPreviewPointerMove/);
  assert.match(pageSource, /handleMermaidPreviewPointerUp/);
  assert.match(pageSource, /适应窗口/);
  assert.match(pageSource, /onWheel=\{handleMermaidPreviewWheel\}/);
  assert.match(pageSource, /onPointerDown=\{handleMermaidPreviewPointerDown\}/);
  assert.match(pageSource, /onPointerMove=\{handleMermaidPreviewPointerMove\}/);
  assert.match(pageSource, /onPointerUp=\{handleMermaidPreviewPointerUp\}/);
  assert.match(reviewCss, /\.content-mermaid-review-preview\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(reviewCss, /\.content-mermaid-review-preview-scale\s*\{[^}]*height:\s*100%;[^}]*transform:\s*translate3d\(var\(--content-mermaid-preview-pan-x,\s*0px\),\s*var\(--content-mermaid-preview-pan-y,\s*0px\),\s*0\)\s+scale\(var\(--content-mermaid-preview-zoom,\s*1\)\)/s);
  assert.match(reviewCss, /\.content-mermaid-review-preview-scale\s+\.mermaid-preview-card\s*\{[^}]*height:\s*100%/s);
  assert.match(reviewCss, /\.content-mermaid-review-preview\.is-dragging/s);
});

test('Word 导出核对提示不把表格等普通警告误写成图片提示', () => {
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const dialogSource = readFileSync(new URL('../../export-format/components/WordExportDialog.tsx', import.meta.url), 'utf8');
  const exportServiceSource = readFileSync(new URL('../../../../electron/services/exportService.cjs', import.meta.url), 'utf8');

  assert.match(dialogSource, /条内容提示，请打开导出的 Word 核对。/);
  assert.doesNotMatch(dialogSource, /条图片提示，请打开导出的 Word 核对。/);
  assert.match(homeSource, /<WordExportDialog/);
  assert.match(exportServiceSource, /Word 已导出，但有 \$\{buildResult\.warnings\.length\} 处内容需要核对，请打开文档查看。/);
  assert.doesNotMatch(exportServiceSource, /处图片未能插入/);
});

test('正文生成把导出 Word 放在上一步后面且不再渲染悬浮工具条', () => {
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const navigationStart = homeSource.indexOf("const navigationActions = state.step === 'content-edit'");
  const navigationEnd = homeSource.indexOf('return (', navigationStart);
  const navigationSource = homeSource.slice(navigationStart, navigationEnd);

  assert.match(navigationSource, /\?\s*\[previousStepAction,\s*exportWordAction\]/);
  assert.doesNotMatch(homeSource, /<FloatingToolbar/);
  assert.doesNotMatch(homeSource, /toolbarGroups/);
});

test('正文未生成时禁止导出空目录，并复用统一 Word 导出弹窗', () => {
  const homeSource = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const dialogSource = readFileSync(new URL('../../export-format/components/WordExportDialog.tsx', import.meta.url), 'utf8');

  assert.match(homeSource, /<WordExportDialog/);
  assert.match(homeSource, /!hasGeneratedContent\(state\.outlineData\?\.outline \|\| \[\]\)/);
  assert.match(homeSource, /正文尚未生成，生成正文后才可导出/);
  assert.match(dialogSource, /<Dialog\.Title>选择导出模板<\/Dialog\.Title>/);
  assert.match(dialogSource, /打开文件/);
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

test('选择标书正文阅读器把长内容限制在内部滚动区域', () => {
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.technical-document-reader-content\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.technical-document-reader-content\s*>\s*\.markdown-fullscreen-frame\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s,
  );
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

test('STEP 01 图片设置只提供四种图片模式并显示中文摘要', () => {
  const source = readFileSync(new URL('../pages/DocumentAnalysisPage.tsx', import.meta.url), 'utf8');
  const imageConfig = readFileSync(new URL('./imageConfig.ts', import.meta.url), 'utf8');

  assert.match(source, /IMAGE_PRESET_LABELS/);
  assert.match(source, /applyImagePreset/);
  assert.match(imageConfig, /增强图文/);
  assert.match(imageConfig, /丰富图文/);
  assert.match(imageConfig, /基础配图/);
  assert.match(imageConfig, /纯文字/);
  assert.match(imageConfig, /自定义/);
  assert.match(source, /role="radiogroup" aria-label="图片模式"/);
  assert.doesNotMatch(source, /\['useAiImages', 'AI 配图'\]/);
  assert.doesNotMatch(source, /\['useMermaidImages', 'Mermaid 图'\]/);
  assert.doesNotMatch(source, /\['useHtmlImages', 'HTML 图'\]/);
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

test('项目状态栏承载流程导航且不再渲染底部悬浮工具条', () => {
  const home = readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  const contextBarStart = home.indexOf('<header className="bid-project-context-bar">');
  const contextBar = home.slice(contextBarStart, home.indexOf('</header>', contextBarStart));

  assert.match(contextBar, /className="bid-project-context-actions"/);
  assert.match(contextBar, /navigationActions\.map/);
  assert.match(contextBar, /aria-label=\{action\.label\}/);
  assert.doesNotMatch(home, /<FloatingToolbar/);
  assert.doesNotMatch(home, /const toolbarGroups =/);
  assert.doesNotMatch(home, /technical-plan-reset/);
  assert.doesNotMatch(home, /id:\s*'home'/);
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
    source.indexOf('window.yibiao?.technicalPlan.checkBidSections('),
    source.indexOf('const resolveDroppedFilePaths'),
  );

  assert.match(
    detectionEffect,
    /checkBidSections\(projectId \? \{ projectId \} : undefined\)\.then\(\(detection\) => \{[\s\S]*detection\?\.hasMultiple[\s\S]*startBidSectionExtraction\(\)/,
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
  assert.match(source, /<MarkdownFullscreenViewer/);
  assert.match(source, /showFullscreen=\{false\}/);
  assert.match(source, /全屏查看标书原文/);
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
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  assert.match(source, /const addAiChildren = async/);
  assert.match(source, /window\.yibiao\?\.ai\?\.requestJson/);
  assert.match(source, /'add-child', \[selectedItem\.id\]\)/);
  assert.match(source, /AI 添加子目录/);
  const detailActionIndex = source.indexOf('className="outline-detail-actions"', source.indexOf('className="outline-detail-source-action"'));
  const aiChildrenBoxIndex = source.indexOf('className="outline-ai-children-box"');
  assert.ok(detailActionIndex > -1 && aiChildrenBoxIndex > detailActionIndex, 'AI 子目录填写区应在详情按钮下方展开');
  assert.match(css, /\.outline-workspace-shell \.outline-detail-actions button\s*\{[^}]*min-height:\s*30px;[^}]*padding:\s*6px 10px;[^}]*font-size:\s*12px;/s);
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
