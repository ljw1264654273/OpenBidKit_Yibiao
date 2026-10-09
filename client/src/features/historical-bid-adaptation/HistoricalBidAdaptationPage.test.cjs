const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const pagePath = join(__dirname, 'pages/HistoricalBidAdaptationPage.tsx');
const stylePath = join(__dirname, '../../styles/feature-historical-bid-adaptation.css');
const routerPath = join(__dirname, '../../app/AppRouter.tsx');
const menuPath = join(__dirname, '../../app/menuConfig.ts');
const analyticsPath = join(__dirname, '../../../../analytics/dashboard/public/src/pages/traffic.js');

test('历史标书适配以独立一级菜单进入独立页面', () => {
  assert.equal(existsSync(pagePath), true, '应提供独立的历史标书适配页面');
  const router = readFileSync(routerPath, 'utf8');
  const menu = readFileSync(menuPath, 'utf8');
  const analytics = readFileSync(analyticsPath, 'utf8');

  assert.match(menu, /id:\s*'historical-bid-adaptation'[\s\S]*label:\s*'以标写标'/);
  assert.match(router, /case\s+'historical-bid-adaptation'/);
  assert.match(analytics, /'historical-bid-adaptation':\s*'以标写标'/);
});

test('页面展示六阶段且新项目只开放上传材料', () => {
  assert.equal(existsSync(pagePath), true, '应提供独立的历史标书适配页面');
  const page = readFileSync(pagePath, 'utf8');

  for (const label of ['上传材料', '招标基线', '差异确认', '目录适配', '正文迁移', '审核导出']) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /aria-current=\{current \? 'step' : undefined\}/);
  assert.match(page, /!projectReady && index > 0/);
  assert.match(page, /完成材料上传后开放招标基线/);
});

test('页面根容器占满工作区并在内部滚动', () => {
  assert.equal(existsSync(stylePath), true, '应提供历史标书适配页面样式');
  const css = readFileSync(stylePath, 'utf8');
  const pageRule = css.match(/\.historical-adaptation-page\s*\{(?<body>[^}]*)\}/s);

  assert.ok(pageRule?.groups?.body, '应定义历史标书适配页面根容器样式');
  assert.match(pageRule.groups.body, /height:\s*100%;/);
  assert.match(pageRule.groups.body, /min-height:\s*0;/);
  assert.match(pageRule.groups.body, /overflow:\s*auto;/);
});

test('项目创建后开放招标基线并保留材料回看入口', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /import BidAnalysisPage/);
  assert.match(page, /variant="tender-baseline"/);
  assert.match(page, /onClick=\{\(\) => onStageChange\(index\)\}/);
  assert.match(page, /onContinue=\{\(\) => onStageChange\(1\)\}/);
  assert.match(page, /disabled=\{disabled\}/);
});

test('招标基线订阅项目后台任务并合并持久化结果', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /taskBridge\.onTaskEvent/);
  assert.match(page, /eventProjectId !== projectId/);
  assert.match(page, /taskType !== 'bid-analysis'/);
  assert.match(page, /bidAnalysisTasks:/);
  assert.match(page, /taskBridge\.getActiveTasks/);
});

test('招标基线进度更新使用函数式合并以保留实时任务状态', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /onProgressChange=\{\(progress\) => onStateChange\(\(previous\) =>/);
  assert.doesNotMatch(page, /onProgressChange=\{\(progress\) => onStateChange\(\{ \.\.\.state,/);
});

test('完整招标基线开放差异确认且差异确认后开放目录适配', () => {
  const page = readFileSync(pagePath, 'utf8');

  assert.match(page, /import AdaptationDifferencePage/);
  assert.match(page, /baselineComplete && index === 2/);
  assert.match(page, /differenceComplete && index === 3/);
  assert.match(page, /differenceComplete/);
  assert.match(page, /historicalAdaptationDifferenceTask/);
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');
  assert.match(component, /historicalAdaptationDifferences/);
});

test('差异确认页面支持类型筛选编辑及逐项处理', () => {
  const componentPath = join(__dirname, 'components/AdaptationDifferencePage.tsx');
  assert.equal(existsSync(componentPath), true, '应提供独立差异确认组件');
  const component = readFileSync(componentPath, 'utf8');

  for (const label of ['全部差异', '待确认', '删除内容', '名称地点替换', '数据更新', '工期进度更新', '其他人工判断']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /saveHistoricalAdaptationDifferences/);
  assert.match(component, /开始差异分析/);
  assert.match(component, /确认此项/);
  assert.match(component, /无需处理/);
  for (const label of ['正文影响范围', '目标动作', '旧值', '新值', '证据类型', '置信度', '旧内容证据', '添加替换映射']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /content_change_scope/);
  assert.match(component, /target_action/);
  assert.match(component, /replacements\.map/);
  assert.match(component, /getDifferenceConfirmationError/);
  assert.match(component, /showToast\(validationError, 'error'\)/);
});

test('差异确认默认展示系统推荐，高级字段按需展开', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');

  assert.match(component, /buildDifferenceRecommendation/);
  assert.match(component, /系统推荐处理方案/);
  assert.match(component, /确认此项（按系统推荐）/);
  assert.match(component, /高级编辑（技术字段）/);
  assert.match(component, /recommendation\.requiresAdvancedReview/);
});

test('差异确认页面允许逐行编辑并归一化旧内容证据', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');

  assert.match(component, /aria-label="旧内容证据"[\s\S]*value=\{\(draft\.old_content_evidence \|\| \[\]\)\.join\('\\n'\)\}/);
  assert.ok(component.includes('split(/\\r?\\n/)'));
  assert.match(component, /\.map\(\(evidence\) => evidence\.trim\(\)\)[\s\S]*\.filter\(Boolean\)/);
});

test('差异确认页面按动作要求匹配证据类型并禁止 review 映射', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');

  assert.match(component, /target_action === 'replace'[\s\S]*evidence_kind !== 'exact-value'/);
  assert.match(component, /target_action === 'remove' \|\| item\.target_action === 'rewrite-fragment'[\s\S]*evidence_kind !== 'locked-range'/);
  assert.match(component, /target_action === 'remove' \|\| item\.target_action === 'rewrite-fragment'[\s\S]*content_change_scope !== 'none'/);
  assert.match(component, /target_action === 'review'[\s\S]*isContextualEvidence/);
  assert.match(component, /target_action === 'review'[\s\S]*replacements\.length/);
  assert.match(component, /isContextualEvidence[\s\S]*confidence === 'high'/);
  assert.match(component, /draft\.evidence_kind/);
  assert.match(component, /draft\.confidence/);
  assert.match(component, /evidence_kind === 'contextual'[\s\S]*content_change_scope !== 'none'/);
  assert.match(component, /const changeTargetAction = \(id: string, target_action: HistoricalAdaptationTargetAction\)[\s\S]*content_change_scope: 'none'[\s\S]*replacements: \[\]/);
  assert.match(component, /确定替换必须使用“精确值”证据类型/);
  assert.match(component, /删除或局部重写必须使用“锁定范围”证据类型/);
  assert.match(component, /人工复核差异必须使用“上下文复核”证据类型/);
  assert.doesNotMatch(component, /必须使用 exact-value|必须使用 locked-range|必须使用 contextual/);
});

test('差异确认页面明确展示单项确认状态并支持批量确认待确认项', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationDifferencePage.tsx'), 'utf8');

  assert.match(component, /确认全部待确认项/);
  assert.match(component, /批量确认差异/);
  assert.match(component, /<AppDialog/);
  assert.match(component, /item\.decision === 'confirmed'[\s\S]*已确认/);
  assert.match(component, /className="historical-adaptation-difference-confirmed-action"/);
  assert.match(component, /item\.decision === 'pending' \|\| item\.id === recentlyConfirmedId/);
  assert.match(component, /disabled=\{running \|\| bulkSaving \|\| Boolean\(savingId\) \|\| pendingCount === 0\}/);
  const styles = readFileSync(join(__dirname, '../../styles/feature-historical-bid-adaptation.css'), 'utf8');
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*historical-adaptation-difference-workbench \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*historical-adaptation-difference-editor \{ grid-template-columns: minmax\(150px, \.55fr\) minmax\(280px, 1\.45fr\); \}/);
});

test('目录适配页面支持生成、三栏核对、编辑和确认验收', () => {
  const componentPath = join(__dirname, 'components/AdaptationOutlinePage.tsx');
  assert.equal(existsSync(componentPath), true, '应提供独立目录适配组件');
  const component = readFileSync(componentPath, 'utf8');

  for (const label of ['原目录', '已删除目录', '适配后目录', '变更依据', '关联差异', '增加一级目录', '增加子目录', '上移', '下移', '删除', '保存编辑', '确认目录']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /startHistoricalAdaptationOutline/);
  assert.match(component, /saveHistoricalAdaptationOutline/);
  assert.match(component, /confirmHistoricalAdaptationOutline/);
  assert.match(component, /historicalAdaptationOutlineChanges/);
});

test('环节四订阅目录任务，确认后开放环节五', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /taskType !== 'historical-adaptation-outline'/);
  assert.match(page, /historicalAdaptationOutlineTask/);
  assert.match(page, /activeStage === 3/);
  assert.match(page, /outlineComplete/);
  assert.match(page, /!contentComplete && index === 5/);
  assert.match(page, /!outlineComplete && index === 4/);
});

test('正文迁移页面支持迁移方案、人工策略、恢复默认和阶段确认', () => {
  const componentPath = join(__dirname, 'components/AdaptationContentPage.tsx');
  assert.equal(existsSync(componentPath), true, '应提供独立正文迁移组件');
  const component = readFileSync(componentPath, 'utf8');
  for (const label of ['适配目录', '历史原文 / 迁移依据', '迁移后正文', '直接迁移', '局部改写', '定向改写', '保存人工修改', '按此方式迁移本章', '选择尚未应用', '建立/更新迁移', '恢复默认处理方式', '运行一致性检查', '确认本阶段']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /onPreparePlan/);
  assert.match(component, /saveHistoricalAdaptationContentStrategy/);
  assert.match(component, /resetHistoricalAdaptationContentStrategies/);
  assert.doesNotMatch(component, /批量设为直接迁移/);
  assert.match(component, /getHistoricalAdaptationContentReadiness/);
  assert.match(component, /startHistoricalAdaptationContentCheck/);
  assert.match(component, /startHistoricalAdaptationContent/);
  assert.match(component, /saveHistoricalAdaptationChapterContent/);
  assert.match(component, /confirmHistoricalAdaptationContent/);
  assert.match(component, /确认本章已处理/);
  assert.match(component, /confirmHistoricalAdaptationContentItem/);
  assert.doesNotMatch(component, /allConfirmed/);
  assert.match(component, /allowRawHtml=\{false\}/);
});

test('来源快照失效的已迁移章节也能进行人工确认', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  const confirmationCondition = component.slice(component.indexOf('const selectedNeedsManualConfirmation ='), component.indexOf('const strategyChanged ='));
  assert.match(confirmationCondition, /finding\.code === 'source-stale'/);
  assert.match(confirmationCondition, /finding\.node_ids\.includes\(selectedItem\.node_id\)/);
  assert.match(component, /selectedNeedsManualConfirmation \? <button/);
  assert.match(component, /onClick=\{\(\) => \{ void confirmChapter\(\); \}\}>\{chapterConfirming \? '确认中\.\.\.' : '确认本章已处理'\}/);
});

test('一致性问题显示章节路径并定位目录，阻断章节具有独立背景', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  const css = readFileSync(stylePath, 'utf8');
  assert.match(component, /finding\.node_ids\.map\(\(nodeId\) =>/);
  assert.match(component, /entry\.path\.join\(' \/ '\)/);
  assert.match(component, /requestNavigation\(\{ type: 'chapter', nodeId: finding\.node_ids\[0\], reveal: true \}\)/);
  assert.match(component, /setChapterFilter\('all'\)/);
  assert.match(component, /outlineListRef\.current/);
  assert.match(component, /workbenchRef\.current\?\.scrollIntoView/);
  assert.match(component, /check\.findings\.filter\(\(finding\) => finding\.blocking\)/);
  assert.match(component, /has-check-blocker/);
  assert.match(css, /\.adaptation-content-outline-list > button\.has-check-blocker\s*\{[^}]*background:/);
  assert.match(css, /\.adaptation-content-outline-list > button\.is-selected\.has-check-blocker\s*\{[^}]*background:/);
});

test('正文一致性检查展示稳定阶段、自动修复结果和任务失败', () => {
  const componentPath = join(__dirname, 'components/AdaptationContentPage.tsx');
  const component = readFileSync(componentPath, 'utf8');
  const types = readFileSync(join(__dirname, '../technical-plan/types.ts'), 'utf8');

  for (const label of ['预检中', '提取全文事实', '检查跨章节口径', '自动修复第', '复查全文', '自动修复成功', '仍有阻断', '人工处理']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /historicalAdaptationContentCheck\.stage/);
  assert.match(component, /auto_repaired_count/);
  assert.match(component, /manual_count/);
  assert.match(types, /rule_engine_version\?: number/);
  assert.match(component, /checkTask\?\.status === 'error'/);
  assert.match(component, /checkTask\?\.error/);
  assert.doesNotMatch(component, /checkTask\?\.message/);
  assert.match(component, /checkRunning\s*\?\s*Math\.min\(99,\s*Number\(checkTask\?\.progress/);
  assert.match(component, /progressValue\}%/);
  assert.match(component, /checkAdvisoryCount = check\.findings\.filter\(\(finding\) => !finding\.blocking\)\.length/);
  assert.match(component, /checkStage === 'precheck'/);
});

test('正文迁移发现待核实或待补充时提示导出后人工处理并要求显式确认', () => {
  const componentPath = join(__dirname, 'components/AdaptationContentPage.tsx');
  const component = readFileSync(componentPath, 'utf8');

  assert.match(component, /待核实|待补充/);
  assert.match(component, /导出 Word 后.*人工处理/);
  assert.match(component, /确认保留.*继续/);
  assert.match(component, /pendingPlaceholderConfirmation/);
  assert.match(component, /待处理占位符/);
});

test('空历史正文选择定向改写时按指定章节生成推荐提纲', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  assert.match(component, /isEmptyHistoricalSource/);
  assert.match(component, /handleStrategyModeChange/);
  assert.match(component, /recommendationsOnly:\s*true/);
  assert.match(component, /includeNodeId:\s*selectedItem\.node_id/);
  assert.match(component, /历史原文为空/);
  assert.match(component, /推荐提纲生成失败/);
});

test('正文迁移保护人工正文，明确确认后才允许覆盖', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  assert.match(component, /content_origin === 'manual'/);
  assert.match(component, /title="覆盖人工正文"/);
  assert.match(component, /forceOverwriteManual:\s*true/);
  assert.match(component, /确认覆盖并迁移/);
});

test('建立方案由 Main 自动启动，Renderer 不重复启动且提供未完成章节重试', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  const prepare = component.slice(component.indexOf('const preparePlan ='), component.indexOf('const resetStrategies ='));
  assert.match(prepare, /onPreparePlan/);
  assert.match(prepare, /saveHistoricalAdaptationContentStrategy/);
  assert.match(prepare, /includeNodeId/);
  assert.doesNotMatch(prepare, /当前选择尚未应用，请先点击/);
  assert.match(prepare, /content_origin === 'manual'/);
  assert.doesNotMatch(prepare, /startHistoricalAdaptationContent/);
  assert.match(component, /retryHistoricalAdaptationContent/);
  assert.match(component, /重试未完成章节/);
  assert.doesNotMatch(component, /执行待处理迁移|一键迁移待处理章节/);
  assert.equal((component.match(/tasks\.startHistoricalAdaptationContent\(/g) || []).length, 1);
});

test('方案响应重放等待期间的迁移事件，不让旧快照覆盖新正文', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /pendingContentPlanEvents\.current\?\.push\(event\)/);
  assert.match(page, /replayHistoricalAdaptationContentEvents\(nextState, events\)/);
});

test('人工覆盖确认在任何策略写入前，恢复默认不启动覆盖迁移', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  const single = component.slice(component.indexOf('const migrateChapter ='), component.indexOf('const runConsistencyCheck ='));
  assert.ok(single.indexOf("content_origin === 'manual'") < single.indexOf('saveHistoricalAdaptationContentStrategy'));
  assert.match(single, /setPendingManualOverwrite\(migration\);\s*return;/);
  const reset = component.slice(component.indexOf('const resetStrategies ='), component.indexOf('const migrateChapter ='));
  assert.doesNotMatch(reset, /startHistoricalAdaptationContent|forceOverwriteManual/);
});

test('对比只使用按章节读取的不可变原文，缺来源禁用伪对比', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  assert.match(component, /getHistoricalAdaptationSourceSection\(\{ projectId, nodeId/);
  assert.match(component, /compareRenderedContent/);
  assert.doesNotMatch(component, /selectedItem\.source_excerpt|selectedItem\?\.source_excerpt/);
  assert.match(component, /sourceSection\?\.available/);
  assert.match(component, /disabled=\{!hasHistoricalSource\}/);
});

test('任务事件实际使用纯函数合并章节局部 patch', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /applyHistoricalAdaptationContentPatch/);
  assert.match(page, /applyHistoricalAdaptationContentPatch\(previous, event\)/);
});

test('历史适配正文支持选区或整章扩写缩写，普通正文页不启用入口', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  const menu = readFileSync(join(__dirname, '../technical-plan/components/ContentAiRewriteMenu.tsx'), 'utf8');
  const regularPage = readFileSync(join(__dirname, '../technical-plan/pages/ContentEditPage.tsx'), 'utf8');

  assert.match(menu, /扩写/);
  assert.match(menu, /缩写/);
  assert.match(component, /ContentAiRewriteMenu/);
  assert.match(component, /ContentAiRewriteDrawer/);
  assert.match(component, /enableLengthEditing/);
  assert.doesNotMatch(regularPage, /enableLengthEditing/);
});

test('正文迁移页面离开未保存草稿前明确确认且禁止直接确认阶段', () => {
  const page = readFileSync(pagePath, 'utf8');
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');

  assert.match(component, /const dirty = Boolean/);
  assert.match(component, /requestNavigation\(\{ type: 'chapter'/);
  assert.match(component, /requestNavigation\(\{ type: 'back' \}\)/);
  assert.match(component, /if \(dirty\)[\s\S]*当前章节有未保存修改，请先保存/);
  assert.match(component, /title="当前章节有未保存修改"/);
  assert.match(component, /放弃修改并继续/);
  assert.match(component, /selectedItem\.error/);
  assert.match(component, /const unsaved = dirty \|\| strategyChanged/);
  assert.match(component, /onDirtyChange\(unsaved\)/);
  assert.match(page, /const \[contentDirty, setContentDirty\]/);
  assert.match(page, /const \[pendingStage, setPendingStage\]/);
  assert.match(page, /onStageChange=\{requestStageChange\}/);
  assert.match(page, /onDirtyChange=\{setContentDirty\}/);
  assert.match(page, /放弃修改并切换/);
});

test('环节五订阅正文迁移任务，确认后开放环节六', () => {
  const page = readFileSync(pagePath, 'utf8');
  assert.match(page, /taskType !== 'historical-adaptation-content'/);
  assert.match(page, /taskType !== 'historical-adaptation-content-check'/);
  assert.match(page, /historicalAdaptationContentTask/);
  assert.match(page, /historicalAdaptationContentCheckTask/);
  assert.match(page, /activeStage === 4/);
  assert.match(page, /contentComplete/);
  assert.match(page, /activeStage === 5/);
  assert.match(page, /!contentComplete && index === 5/);
});

test('事实 bridge 未加载时向用户提供完整重启客户端的修复路径', () => {
  const component = readFileSync(join(__dirname, 'components/AdaptationContentPage.tsx'), 'utf8');
  assert.match(component, /typeof window\.yibiao\.technicalPlan\.getHistoricalAdaptationContentFacts !== 'function'/);
  assert.match(component, /请完全退出并重新打开客户端/);
  assert.match(component, /typeof window\.yibiao\.technicalPlan\.saveHistoricalAdaptationContentFactOverrides !== 'function'/);
});

test('环节六支持自动终审、问题处置、人工验收与门禁 Word 导出', () => {
  const componentPath = join(__dirname, 'components/AdaptationReviewExportPage.tsx');
  assert.equal(existsSync(componentPath), true, '应提供独立审核导出组件');
  const component = readFileSync(componentPath, 'utf8');
  const page = readFileSync(pagePath, 'utf8');

  for (const label of ['运行终审', 'P0', 'P1', 'P2', '确认终审', '导出 Word']) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /runHistoricalAdaptationReview/);
  assert.match(component, /setHistoricalAdaptationReviewFinding/);
  assert.match(component, /confirmHistoricalAdaptationReview/);
  assert.match(component, /assertHistoricalAdaptationExportAllowed/);
  assert.match(component, /WordExportDialog/);
  assert.match(component, /historical_adaptation:\s*true/);
  assert.match(page, /!contentComplete && index === 5/);
  assert.match(page, /contentComplete && index === 5/);
});
