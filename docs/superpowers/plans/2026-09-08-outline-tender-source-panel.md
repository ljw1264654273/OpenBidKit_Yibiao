# 目录生成页标书原文联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将技术方案 STEP 03 改为紧凑状态栏和“标书原文 / 目录结构 / 目录项详情”三栏联动页面，并保证目录变更后原文关联即时一致。

**Architecture:** 复用目录任务现有 `score_coverage_map` 作为目录节点到评分原文的权威映射，复用 `readTenderMarkdown()` 取得当前标段 Markdown，通过纯函数做精确或空白归一化定位。`TechnicalPlanHome` 继续持有 Markdown 和任务快照，`OutlineEditPage` 编排三栏与窄窗口标签，专用 `TenderSourcePanel` 只负责展示；Store 返回和 AI 调整事件补齐最新目录任务快照。

**Tech Stack:** Electron CommonJS Main、React 19、TypeScript、全局 CSS、Radix Dialog、Node `node:test`、better-sqlite3 Electron native 测试。

---

## 文件结构

**新增文件**

- `client/src/features/technical-plan/services/outlineSourceMatcher.ts`：覆盖记录筛选、后代聚合、确定性原文定位和上下文截取纯函数。
- `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`：纯函数行为测试。
- `client/src/features/technical-plan/components/TenderSourcePanel.tsx`：标书原文栏的加载、空态、多来源切换、高亮和全文查看。

**修改文件**

- `client/electron/services/technicalPlanStore.cjs`：`saveOutline()` 返回更新后的 `outlineGenerationTask`。
- `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`：验证保存目录后的返回快照已同步覆盖映射。
- `client/electron/services/outlineAdjustmentTask.cjs`：AI 调整完成事件携带最新 `outlineGenerationTask`。
- `client/electron/services/outlineAdjustmentTask.test.cjs`：验证 AI 调整事件的同步契约。
- `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`：扩展 Markdown 加载范围、传递加载状态、合并 AI 调整后的目录任务快照。
- `client/src/features/technical-plan/pages/OutlineEditPage.tsx`：紧凑状态栏、三栏编排、排序冻结、窄窗口标签和关联摘要。
- `client/src/styles/feature-technical-plan.css`：三等分、紧凑进度、原文栏、过程浮层、容器查询和最小窗口样式。

**不修改**

- `client/electron/preload.cjs`
- `client/electron/ipc/technicalPlanIpc.cjs`
- `client/src/shared/types/ipc.ts`
- `client/electron/services/sqliteDatabase.cjs`
- `sql/workspace_schema.sql`
- Analytics Worker 和 Dashboard

### Task 1: 用纯函数建立目录节点与原文的确定性关联

**Files:**

- Create: `client/src/features/technical-plan/services/outlineSourceMatcher.ts`
- Create: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`
- Reference: `client/src/features/technical-plan/types.ts:20-38`
- Reference: `client/src/shared/types/outline.ts:10-22`

- [ ] **Step 1: 写覆盖记录筛选和文本定位的失败测试**

测试至少声明以下固定输入：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node 类型擦除测试需要显式扩展名
import {
  collectOutlineSourceRecords,
  locateOutlineSourceText,
} from './outlineSourceMatcher.ts';

const outline = [{
  id: '1',
  title: '总体方案',
  description: '',
  children: [{ id: '1.1', title: '建设目标', description: '', content_mode: 'ai-generate' as const }],
}];

const records = [
  {
    source_id: 'R1-C1-P1',
    source_kind: 'response-point' as const,
    source_text: '建设目标与技术路线',
    node_ids: ['1.1'],
    coverage_location: 'title' as const,
    user_override: 'none' as const,
    supplement_kind: 'none' as const,
  },
  {
    source_id: 'S1',
    source_kind: 'professional-supplement' as const,
    source_text: '总体架构设计',
    node_ids: ['1.2'],
    coverage_location: 'title' as const,
    user_override: 'none' as const,
    supplement_kind: 'overall-introduction' as const,
  },
];

test('父节点汇总后代的招标原文且保留记录顺序', () => {
  assert.deepEqual(
    collectOutlineSourceRecords(outline, '1', records).tenderRecords.map((item) => item.source_id),
    ['R1-C1-P1'],
  );
});

test('空白归一化匹配能够映射回原 Markdown 范围', () => {
  const markdown = '## 技术要求\n\n建设目标\n与   技术路线。\n\n下一段。';
  const result = locateOutlineSourceText(markdown, '建设目标 与 技术路线');
  assert.equal(result.status, 'located');
  assert.equal(markdown.slice(result.matchStart, result.matchEnd).replace(/\s+/g, ' '), '建设目标 与 技术路线');
  assert.match(result.contextBefore, /技术要求/);
});

test('未命中时只返回保存的评分原文而不猜测相似段落', () => {
  const result = locateOutlineSourceText('完全不同的正文', '建设目标');
  assert.deepEqual(result, { status: 'unlocated', sourceText: '建设目标' });
});
```

继续补齐以下测试：直接节点优先于后代、按 `source_id` 去重、不同 `source_id` 的同文记录保留、`professional-supplement`/`user-supplement` 分类、空 `node_ids` 与 `coverage_location=none` 排除，以及 `user_override='removed'` 即使异常残留 `node_ids` 也必须排除。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
```

Expected: FAIL，提示无法找到 `outlineSourceMatcher.ts` 或导出函数不存在。

- [ ] **Step 3: 实现最小纯函数 API**

创建以下公开类型和函数：

```ts
import type { OutlineItem } from '../../../shared/types';
import type { ScoreCoverageRecord } from '../types';

export interface OutlineSourceRecordSet {
  tenderRecords: ScoreCoverageRecord[];
  supplementRecords: ScoreCoverageRecord[];
  scope: 'direct' | 'descendants' | 'none';
}

export type LocatedOutlineSource =
  | {
      status: 'located';
      sourceText: string;
      matchStart: number;
      matchEnd: number;
      contextStart: number;
      contextEnd: number;
      contextBefore: string;
      matchedText: string;
      contextAfter: string;
    }
  | { status: 'unlocated'; sourceText: string };

export function collectOutlineSourceRecords(
  outline: OutlineItem[],
  nodeId: string,
  records: ScoreCoverageRecord[],
): OutlineSourceRecordSet;

export function locateOutlineSourceText(markdown: string, sourceText: string): LocatedOutlineSource;
```

实现约束：

- 招标原文种类仅为 `requirement`、`criterion`、`response-point`。
- 先收集直接 `node_ids`；直接记录为空时才收集后代 ID。
- 归一化函数逐字符维护 `normalizedIndex -> originalIndex` 映射，只合并连续空白，不改变标点和文字。
- 上下文以匹配段落前后各一个 Markdown 段落为边界；最多限制到合理字符数，例如前后各 600 字符。
- 禁止关键词、编辑距离和 AI 模糊匹配。

- [ ] **Step 4: 运行纯函数测试并确认通过**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
```

Expected: PASS，所有目录筛选、分类和定位测试通过。

- [ ] **Step 5: 提交纯函数和测试**

```powershell
git add client/src/features/technical-plan/services/outlineSourceMatcher.ts client/src/features/technical-plan/services/outlineSourceMatcher.test.ts
git commit -m "feat: match outline nodes to tender sources"
```

### Task 2: 让目录保存和 AI 调整返回最新覆盖映射快照

**Files:**

- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs:2414-2488`
- Modify: `client/electron/services/outlineAdjustmentTask.test.cjs`
- Modify: `client/electron/services/outlineAdjustmentTask.cjs:206-239`

- [ ] **Step 1: 为 Store 返回值补充失败断言**

在每种保存原因的关键断言中接住返回值，先验证返回快照而不是重新 `loadTechnicalPlan()`：

```js
const saved = store.saveOutline({
  outlineData: sortedOutline,
  reason: 'sort',
  idMap: { '1': '1', '1.1': '1.2', '1.2': '1.1' },
});
assert.deepEqual(
  saved.outlineGenerationTask.stats.score_coverage_map.records[0].node_ids,
  ['1.2', '1.1'],
);
```

再为 `edit`、`delete` 和 `add-child` 返回值分别断言 `user_override`、`node_ids` 和新增 `U1` 记录。

- [ ] **Step 2: 为 AI 调整事件补充失败断言**

修改 `outlineAdjustmentTask.test.cjs` 的 Store stub：

```js
const updatedOutlineTask = {
  task_id: 'outline-score-map',
  type: 'outline-generation',
  status: 'success',
  progress: 100,
  stats: { score_coverage_map: { version: 1, coverage_mode: 'legacy-structure-only', records: [] } },
};

saveOutline: (request) => ({
  outlineData: request.outlineData,
  outlineGenerationTask: updatedOutlineTask,
}),
```

在任务结束后断言：

```js
assert.equal(
  checkpointCalls.at(-1).result.technicalPlanPatch.outlineGenerationTask,
  updatedOutlineTask,
);
```

- [ ] **Step 3: 运行两个测试并确认失败**

Run:

```powershell
cd client
node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/outlineAdjustmentTask.test.cjs
```

Expected: FAIL，Store 返回值缺少 `outlineGenerationTask`，AI 调整 patch 也缺少该字段。

- [ ] **Step 4: 实现 Store 返回快照**

在 `technicalPlanStore.saveOutline()` 完成 transaction 后读取一次最新任务：

```js
const savedOutlineGenerationTask = loadTask('outline-generation');
return {
  outlineData: savedOutlineData,
  outlineGenerationTask: savedOutlineGenerationTask,
  // 保留现有 contentGenerationTask/runtime/illustration patch
};
```

不要在 Renderer 重写 `updateScoreCoverageForOutlineSave()`。

- [ ] **Step 5: 实现 AI 调整事件同步**

在 `outlineAdjustmentTask.cjs` 最终 checkpoint 中补充：

```js
technicalPlanPatch: {
  outlineData: saved.outlineData,
  outlineGenerationTask: saved.outlineGenerationTask,
  contentGenerationTask: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentIllustrationPlan: undefined,
  contentGenerationRuntime: undefined,
},
```

- [ ] **Step 6: 运行 Main 定向测试和语法检查**

Run:

```powershell
cd client
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/outlineAdjustmentTask.cjs
node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/outlineAdjustmentTask.test.cjs
```

Expected: 两个 `node --check` 无输出且退出 0；两个测试 PASS。

- [ ] **Step 7: 提交任务快照同步**

```powershell
git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs client/electron/services/outlineAdjustmentTask.cjs client/electron/services/outlineAdjustmentTask.test.cjs
git commit -m "fix: sync outline source coverage snapshots"
```

### Task 3: 创建标书原文展示组件

**Files:**

- Create: `client/src/features/technical-plan/components/TenderSourcePanel.tsx`
- Modify: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`
- Reference: `client/src/shared/ui/MarkdownFullscreenViewer.tsx`
- Reference: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx:366-379`

- [ ] **Step 1: 先补齐组件需要的展示模型测试**

在 matcher 中增加组合函数，使 React 组件不负责业务判断：

```ts
export interface OutlineSourceViewItem {
  sourceId: string;
  kind: 'requirement' | 'criterion' | 'response-point';
  status: 'located' | 'unlocated';
  sourceText: string;
  contextBefore: string;
  matchedText: string;
  contextAfter: string;
}

export function buildOutlineSourceViewItems(
  outline: OutlineItem[],
  nodeId: string,
  records: ScoreCoverageRecord[],
  markdown: string,
): { items: OutlineSourceViewItem[]; supplementKind?: 'professional' | 'user'; scope: 'direct' | 'descendants' | 'none' };
```

测试定位成功、未定位、只有专业补充、只有人工新增和父节点后代聚合五种返回结果。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
```

Expected: FAIL，`buildOutlineSourceViewItems` 尚未导出。

- [ ] **Step 3: 实现展示模型组合函数**

复用 Task 1 的两个纯函数，不在组合函数里重新实现筛选或定位。`unlocated` 项的 `matchedText` 使用保存的 `sourceText`，上下文为空。

- [ ] **Step 4: 创建 `TenderSourcePanel`**

组件公开接口：

```tsx
interface TenderSourcePanelProps {
  selectedItem: OutlineItem | null;
  outline: OutlineItem[];
  coverageRecords: ScoreCoverageRecord[];
  outlineExpansionMode: OutlineExpansionMode;
  markdown: string;
  loading: boolean;
  error: string;
  sorting: boolean;
  onRetry: () => void;
}
```

组件要求：

- 用 `useMemo` 生成 view items，用本地 `activeIndex` 切换多处原文。
- `selectedItem?.id`、records 或 Markdown 变化时把 `activeIndex` 复位为 0。
- 栏头显示“标书原文”和“N 处 · X/N”。
- 上一处/下一处使用图标或明确的可访问名称，单条和边界位置禁用。
- 正常片段按 `contextBefore`、`<mark>{matchedText}</mark>`、`contextAfter` 渲染为纯文本，保留换行。
- 根据 `source_kind` 在片段底部显示稳定的中文来源类型标签：`requirement` 为“招标要求”、`criterion` 为“评分标准”、`response-point` 为“响应要点”。
- `unlocated` 显示“评分原文，未定位到正文上下文”，不展示伪造上下文。
- `professional-supplement`、`user-supplement`、未选择目录、没有映射、加载中和读取失败分别提供清晰中文状态。
- `outlineExpansionMode='original-only'` 且没有评分覆盖映射时显示“当前目录来自原方案，暂无招标原文关联”，不把原方案内容当作招标原文。
- 排序时覆盖冻结提示，禁用来源切换和全文入口。
- 使用 `MarkdownFullscreenViewer` 的 `fullscreenChildren` 配合 `<MarkdownRenderer allowRawHtml={false}>` 查看完整招标 Markdown；普通栏内不用原始 HTML。
- 读取失败的重试按钮调用 `onRetry`，并由上层 Toast 提供错误信息。

- [ ] **Step 5: 运行 matcher 测试和 TypeScript 构建**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
npm run build
```

Expected: matcher 测试 PASS；构建退出 0，仅允许既有 chunk 体积警告。

- [ ] **Step 6: 提交原文组件**

```powershell
git add client/src/features/technical-plan/services/outlineSourceMatcher.ts client/src/features/technical-plan/services/outlineSourceMatcher.test.ts client/src/features/technical-plan/components/TenderSourcePanel.tsx
git commit -m "feat: add tender source panel"
```

### Task 4: 接入 Markdown 状态、覆盖映射和目录变更同步

**Files:**

- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx:156-168, 635-763, 1072-1094, 1324-1341`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx:18-35, 331-398, 1256-1442`
- Modify: `client/src/features/technical-plan/services/outlineSourceMatcher.test.ts`

- [ ] **Step 1: 增加主页源码契约的失败测试**

在 matcher 测试文件增加轻量源码契约，防止两个工作流入口漏传数据：

```ts
import fs from 'node:fs';

test('技术方案主页在目录步骤加载并传递招标 Markdown', () => {
  const source = fs.readFileSync(new URL('../pages/TechnicalPlanHome.tsx', import.meta.url), 'utf8');
  assert.match(source, /state\.step !== 'document-analysis'\s*&&\s*state\.step !== 'outline-generation'/);
  assert.match(source, /setTenderMarkdownLoading/);
  assert.match(source, /tenderMarkdownLoading=\{tenderMarkdownLoading\}/);
  assert.match(source, /onReloadTenderMarkdown=\{loadTenderMarkdown\}/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
```

Expected: FAIL，当前读取 effect 仍只允许 `document-analysis`，且尚未提供 loading/retry props。

- [ ] **Step 3: 扩展 `TechnicalPlanHome` 的 Markdown 加载状态**

在现有 `tenderMarkdown` 旁增加：

```ts
const [tenderMarkdownLoading, setTenderMarkdownLoading] = useState(false);
const [tenderMarkdownError, setTenderMarkdownError] = useState('');
```

把读取逻辑提取为 `useCallback`，以 `tenderFile.contentHash` 或 `updatedAt` 识别内容版本，避免在两个步骤来回切换时重复读取。允许加载的步骤固定为 `document-analysis` 和 `outline-generation`。失败时设置错误并调用 `showToast(..., 'error')`；effect cleanup 只阻止过期 Promise 回写。

向 `OutlineEditPage` 传入：

```tsx
tenderMarkdown={tenderMarkdown}
tenderMarkdownLoading={tenderMarkdownLoading}
tenderMarkdownError={tenderMarkdownError}
onReloadTenderMarkdown={loadTenderMarkdown}
```

- [ ] **Step 4: 合并 AI 调整后的目录任务快照**

在 `outline-adjustment` 事件分支增加：

```ts
outlineGenerationTask: hasOwnField(technicalPlan, 'outlineGenerationTask')
  ? trimTaskLogs(technicalPlan.outlineGenerationTask)
  : prev.outlineGenerationTask,
```

人工编辑、添加、删除和保存排序继续依赖 `saveOutline()` 返回 patch 的现有展开合并，不在 Renderer 改写 coverage map。

- [ ] **Step 5: 接入 `TenderSourcePanel` 与详情关联摘要**

在 `OutlineEditPageProps` 增加 Markdown 四项 props。向 `TenderSourcePanel` 同时传入已有的 `outlineExpansionMode`，用于区分“已有方案扩写”的 `original-only` 专用空态。计算：

```ts
const coverageRecords = task?.stats?.score_coverage_map?.records || [];
```

用 `TenderSourcePanel` 替换现有 `.outline-progress-panel`。在目录详情只读态增加“已关联 N 处原文”按钮；按钮使用 matcher 的记录计数，不自行搜索 Markdown，并在窄窗口时切换到原文标签。

目录树也复用 `collectOutlineSourceRecords()` 的直接/后代聚合结果：在进入 `renderItem()` 前用 `useMemo` 为全部节点建立关联数量 Map，避免每次渲染重复遍历整棵树。关联数量大于 0 时在节点标题旁显示 `Link2` 图标和可访问文案（例如 `aria-label="已关联 2 处招标原文"`），并通过 `title` 提供同样提示；图标与文字/可访问名称共同表达状态，不能只靠颜色。排序期间沿用冻结后的已保存 Map，不根据草稿 ID 猜测关联。

排序期间传入 `sorting=true`，显示冻结提示。保存或放弃排序后由最新 props 自动恢复。

- [ ] **Step 6: 运行定向测试和构建**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
npm run build
```

Expected: 测试 PASS；构建退出 0。

- [ ] **Step 7: 提交页面数据接入**

```powershell
git add client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/features/technical-plan/services/outlineSourceMatcher.test.ts
git commit -m "feat: connect outline selection to tender sources"
```

### Task 5: 实现紧凑状态栏、横向三等分和窄窗口标签

**Files:**

- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx:351-391, 1256-1372`
- Modify: `client/src/styles/feature-technical-plan.css:2265-2315, 3431-3650`

- [ ] **Step 1: 增加布局源码契约测试并确认失败**

在 `outlineSourceMatcher.test.ts` 增加：

```ts
test('目录页保留三栏、紧凑过程入口和窄窗口标签', () => {
  const page = fs.readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');
  assert.match(page, /outline-workspace-tabs/);
  assert.match(page, /outline-source-panel/);
  assert.match(page, /outline-process-popover/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@container[^\{]*\(max-width:\s*899px\)/);
});
```

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
```

Expected: FAIL，布局类和容器查询尚不存在。

- [ ] **Step 2: 把标题与进度合并为紧凑状态栏**

调整 `outline-command-bar` 为标题、进度、操作三列：

- 标题保留 STEP、标题和一行配置摘要，但缩小间距与字号。
- 进度区始终展示 `ProgressBar`、百分比和 `statusText`。
- 把 `progressCollapsed` 默认值改为 `true`。
- “过程”按钮设置 `aria-expanded`，展开 `.outline-process-popover`，其中完整保留 `statusMessage`、耗时、停滞提示、错误和 `progressLogs`。
- 过程浮层覆盖在三栏上方，不增加页面网格行高度。
- 等待一级目录确认、打开投标模版、设置和重新生成按钮行为不变。

- [ ] **Step 3: 实现三栏和分栏标签状态**

在 `OutlineEditPage` 增加：

```ts
type OutlineWorkspacePane = 'source' | 'outline' | 'detail';
const [activeWorkspacePane, setActiveWorkspacePane] = useState<OutlineWorkspacePane>('outline');
```

DOM 结构：

```tsx
<section className="outline-workspace-shell">
  <div className="outline-workspace-tabs" role="tablist" aria-label="目录工作区">
    {/* 三个原生 button，使用 role=tab、aria-selected、aria-controls */}
  </div>
  <section className="outline-generation-workspace">
    <TenderSourcePanel ... />
    <section className="outline-tree-panel ..." />
    <aside className="outline-detail-panel ..." />
  </section>
</section>
```

每个面板在标签模式下根据 `activeWorkspacePane` 添加 `is-active-pane`。点击目录不自动切换标签；详情中的原文关联按钮切换到 `source`。

- [ ] **Step 4: 实现 CSS 三等分和容器查询**

核心规则：

```css
.outline-workspace-shell {
  container-type: inline-size;
  min-width: 0;
  min-height: 0;
}

.outline-generation-workspace {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  height: 100%;
}

.outline-workspace-tabs {
  display: none;
}

@container (max-width: 899px) {
  .outline-workspace-tabs {
    display: flex;
  }

  .outline-generation-workspace {
    display: block;
  }

  .outline-generation-workspace > [role='tabpanel'] {
    display: none;
    height: 100%;
  }

  .outline-generation-workspace > .is-active-pane {
    display: grid;
  }
}
```

补齐：

- 三栏内部滚动和 `min-height: 0`。
- 原文 `<mark>`、来源状态、切换按钮、加载和空态。
- 紧凑状态栏与过程浮层。
- 窄窗口标签的选中、焦点和触摸目标。
- `FloatingToolbar` 不改结构、不增加底部占位，只确认三栏关键按钮不会被遮挡。
- CSS 使用现有 `--yb-*` token；不引入 Tailwind、硬编码新主题或大面积装饰渐变。

- [ ] **Step 5: 运行布局契约测试和构建**

Run:

```powershell
cd client
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts
npm run build
```

Expected: 测试 PASS；构建退出 0，仅允许既有 chunk 警告。

- [ ] **Step 6: 提交视觉布局**

```powershell
git add client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/outlineSourceMatcher.test.ts
git commit -m "feat: prioritize the outline three-pane workspace"
```

### Task 6: 完整回归与桌面交互验收

**Files:**

- Verify only unless defects are found.

- [ ] **Step 1: 运行全部相关自动验证**

Run:

```powershell
cd client
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/outlineAdjustmentTask.cjs
node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs electron/services/outlineGenerationTaskV2.test.cjs
node --experimental-strip-types --test src/features/technical-plan/services/outlineSourceMatcher.test.ts src/features/technical-plan/services/outlineDepth.test.ts
npm run smoke:electron-native
npm run build
```

Expected: 所有命令退出 0；`npm run build` 只允许既有 chunk 体积警告。

- [ ] **Step 2: 启动 Electron 并验证生成技术方案入口**

Run:

```powershell
cd client
npm run dev
```

在默认 `1440×920` 窗口验证：

- 标题和进度仅占紧凑状态栏高度，过程默认折叠且展开内容完整。
- 主体严格横向三等分，左原文、中目录、右详情。
- 点击一级、父级和叶子目录时原文正确切换；父级可汇总后代来源。
- 多来源上一处/下一处可用，全文查看正常。
- 未定位、专业补充、人工新增和无映射状态不展示猜测内容。
- 编辑、添加、删除后关联计数即时更新。
- 排序未保存时冻结关联；保存后更新；放弃后恢复。
- `FloatingToolbar` 保持现有悬浮位置，不遮挡三栏关键操作。

- [ ] **Step 3: 验证窄窗口和已有方案扩写入口**

将窗口调为 `1040×720`，分别展开和收起应用侧栏：

- 工作区低于 `900px` 时显示三个标签，一次只显示一个面板。
- 不出现上中下堆叠，也不出现文字或按钮重叠。
- 标签切换、目录选择、原文序号和详情内容保持一致。
- 宽度恢复后回到横向三栏，再缩窄时恢复最近标签。

切换到“已有方案扩写”：

- `ai-complement` 有覆盖映射时正常显示招标原文。
- `original-only` 无覆盖映射时显示“当前目录来自原方案，暂无招标原文关联”。
- 不把原方案内容标记为招标原文。

- [ ] **Step 4: 检查工作树并提交必要的验收修复**

Run:

```powershell
git status --short
git diff --check
```

如果手动验收发现并修复缺陷，重复 Step 1 的自动验证后单独提交：

```powershell
git add <仅本功能修复文件>
git commit -m "fix: polish outline tender source workflow"
```

若无修复，不创建空提交。
