# 新建标书全流程全局滚动实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新建标书 STEP 01 至 STEP 05 改造成吸顶流程卡、页面根级纵向滚动和步骤业务确认区，同时保留专业工作台必要的内部滚动。

**Architecture:** 在技术方案 feature 内新增纯步骤状态模型，统一驱动流程卡、准入状态和底部动作；`TechnicalPlanHome` 只组合现有业务布尔值并继续通过 `switchStep()` 切换。布局通过 `workflowKind="technical-plan"` 对应的根修饰类隔离，新建标书使用页面根滚动，已有方案扩写保留当前锁高布局。

**Tech Stack:** React 19、TypeScript、全局 CSS、Node `node:test`、Vite、Electron Renderer。

**Required Skills:** `@superpowers:test-driven-development`、`@ui-skills-root`、`@superpowers:verification-before-completion`。

---

## 文件结构

- Create: `client/src/features/technical-plan/services/technicalPlanStepNavigation.ts`  
  纯函数：定义五个主步骤、完成/可访问/锁定状态和显示文案，不访问 React、IPC 或 Store。
- Create: `client/src/features/technical-plan/services/technicalPlanStepNavigation.test.ts`  
  行为测试：覆盖顺序解锁、回到已完成步骤、运行中文案和禁止跨步骤跳转。
- Create: `client/src/features/technical-plan/components/TechnicalPlanStageNavigation.tsx`  
  展示吸顶五步流程卡，只接收派生后的展示模型和切换回调。
- Create: `client/src/features/technical-plan/components/TechnicalPlanStageFooter.tsx`  
  展示步骤完成说明和当前唯一主动作，不包含业务条件判断。
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx:78-85, 318-376, 507-574, 984-1100, 1230-1248`  
  组合步骤完成条件、隔离 technical-plan 布局、渲染新组件、复用 `switchStep()` / Word 导出，并在步骤切换后重置根滚动。
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts:590-633`  
  用静态结构测试锁定新骨架、专用修饰类、上下步导航隔离和工作台滚动规则。
- Modify: `client/src/styles/feature-technical-plan.css:1-84, 310-325, 628-630, 1242-1244, 1589-1606, 3803-3806, 5211-5216`  
  新增流程卡、步骤底部动作、页面根滚动和 STEP 02 至 STEP 05 确定高度规则；保留旧布局作为已有方案扩写默认样式。
- Modify: `client/src/styles/feature-bid-project.css:713-761`  
  为技术方案全局滚动版设置项目上下文标题和返回操作，旧上下步操作仅用于非全局滚动版。
- Modify: `client/src/styles/layout-app-shell.css:473-476`  
  仅在全局滚动修饰类存在时移除壳层内边距，由页面自身控制吸顶流程区和内容留白。
- Modify: `client/src/styles/uiDensity.test.ts:48-58`  
  更新密度回归断言，允许 technical-plan 专用根滚动，同时确认默认技术工作台仍为锁高布局。

---

### Task 1: 建立统一的五步状态模型

**Files:**
- Create: `client/src/features/technical-plan/services/technicalPlanStepNavigation.ts`
- Create: `client/src/features/technical-plan/services/technicalPlanStepNavigation.test.ts`

- [ ] **Step 1: 写入失败的状态模型测试**

创建测试并覆盖以下场景：

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node 类型擦除测试需要显式扩展名
import { buildTechnicalPlanStageModels } from './technicalPlanStepNavigation.ts';

test('只开放已满足前置条件的技术方案步骤', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'bid-analysis',
    completed: {
      'document-analysis': true,
      'bid-analysis': false,
      'outline-generation': false,
      'global-facts': false,
      'content-edit': false,
    },
  });

  assert.deepEqual(stages.map(({ state, disabled }) => ({ state, disabled })), [
    { state: 'complete', disabled: false },
    { state: 'current', disabled: false },
    { state: 'locked', disabled: true },
    { state: 'locked', disabled: true },
    { state: 'locked', disabled: true },
  ]);
});

test('运行中文案覆盖默认当前状态且已完成后开放下一步', () => {
  const stages = buildTechnicalPlanStageModels({
    currentStep: 'bid-analysis',
    completed: {
      'document-analysis': true,
      'bid-analysis': true,
      'outline-generation': false,
      'global-facts': false,
      'content-edit': false,
    },
    currentStatusLabel: '解析中',
  });

  assert.equal(stages[1].statusLabel, '解析中');
  assert.equal(stages[2].state, 'available');
  assert.equal(stages[2].disabled, false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run from `client/`:

```powershell
node --test src/features/technical-plan/services/technicalPlanStepNavigation.test.ts
```

Expected: FAIL，提示模块不存在或导出函数不存在。

- [ ] **Step 3: 实现最小纯函数**

实现以下公共形状：

```ts
import type { TechnicalPlanStep } from '../types';

export const TECHNICAL_PLAN_STAGE_DEFINITIONS = [
  { key: 'document-analysis', label: '选择标书' },
  { key: 'bid-analysis', label: '文件解析' },
  { key: 'outline-generation', label: '目录生成' },
  { key: 'global-facts', label: '事实设定' },
  { key: 'content-edit', label: '生成正文' },
] as const satisfies ReadonlyArray<{ key: TechnicalPlanStep; label: string }>;

export type TechnicalPlanStageKey = typeof TECHNICAL_PLAN_STAGE_DEFINITIONS[number]['key'];
export type TechnicalPlanStageVisualState = 'complete' | 'current' | 'available' | 'locked';
export type TechnicalPlanStageCompletion = Record<TechnicalPlanStageKey, boolean>;

export interface TechnicalPlanStageModel {
  key: TechnicalPlanStageKey;
  label: string;
  statusLabel: string;
  state: TechnicalPlanStageVisualState;
  complete: boolean;
  accessible: boolean;
  canProceed: boolean;
  disabled: boolean;
}

export function buildTechnicalPlanStageModels(input: {
  currentStep: TechnicalPlanStep;
  completed: TechnicalPlanStageCompletion;
  currentStatusLabel?: string;
}): TechnicalPlanStageModel[] {
  return TECHNICAL_PLAN_STAGE_DEFINITIONS.map((definition, index) => {
    const complete = input.completed[definition.key];
    const current = definition.key === input.currentStep;
    const prerequisitesComplete = TECHNICAL_PLAN_STAGE_DEFINITIONS
      .slice(0, index)
      .every((previous) => input.completed[previous.key]);
    const accessible = current || complete || prerequisitesComplete;
    const state: TechnicalPlanStageVisualState = current
      ? 'current'
      : complete
        ? 'complete'
        : accessible
          ? 'available'
          : 'locked';

    return {
      ...definition,
      state,
      complete,
      accessible,
      canProceed: complete,
      disabled: !accessible,
      statusLabel: current
        ? input.currentStatusLabel || (complete ? '待验收' : '进行中')
        : complete
          ? '已完成'
          : accessible
            ? '可开始'
            : '待开放',
    };
  });
}
```

如果 `TechnicalPlanStep` 包含 `expand`，保持五步定义的字面量联合类型，不把 STEP 06 纳入模型。

- [ ] **Step 4: 补齐回退与非相邻访问测试**

增加测试：当前步骤回到 STEP 01 时，已经完成的 STEP 02 至 STEP 04 仍可点击；只有全部前置未完成且自身也未完成的步骤被锁定。显式断言 `accessible`、`complete` 和 `canProceed`，后续页面只能复用这些字段，不得重新计算一套卡片准入条件。

- [ ] **Step 5: 运行测试并确认通过**

Run:

```powershell
node --test src/features/technical-plan/services/technicalPlanStepNavigation.test.ts
```

Expected: PASS，所有状态模型测试通过。

- [ ] **Step 6: 提交状态模型**

```powershell
git add client/src/features/technical-plan/services/technicalPlanStepNavigation.ts client/src/features/technical-plan/services/technicalPlanStepNavigation.test.ts
git commit -m "feat: add technical plan stage navigation model"
```

---

### Task 2: 创建流程卡与步骤业务动作组件

**Files:**
- Create: `client/src/features/technical-plan/components/TechnicalPlanStageNavigation.tsx`
- Create: `client/src/features/technical-plan/components/TechnicalPlanStageFooter.tsx`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts:590-633`

- [ ] **Step 1: 写入失败的组件结构测试**

在 `workflowLayout.test.ts` 增加两个组件源码读取断言：

```ts
test('技术方案流程卡展示编号、名称、状态并真实禁用未开放步骤', () => {
  const source = componentSource('TechnicalPlanStageNavigation');
  assert.match(source, /String\(index \+ 1\)\.padStart\(2, '0'\)/);
  assert.match(source, /stage\.statusLabel/);
  assert.match(source, /disabled=\{stage\.disabled\}/);
  assert.match(source, /aria-current=\{stage\.state === 'current' \? 'step' : undefined\}/);
});

test('步骤底部只保留一个与业务状态绑定的主动作', () => {
  const source = componentSource('TechnicalPlanStageFooter');
  assert.match(source, /technical-plan-stage-footer/);
  assert.match(source, /actionLabel/);
  assert.match(source, /disabled=\{disabled\}/);
  assert.equal((source.match(/<button/g) || []).length, 1);
});
```

- [ ] **Step 2: 运行结构测试并确认失败**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: FAIL，两个组件文件尚不存在。

- [ ] **Step 3: 实现流程卡组件**

组件只负责渲染，建议接口：

```tsx
interface TechnicalPlanStageNavigationProps {
  stages: TechnicalPlanStageModel[];
  onStageChange: (step: TechnicalPlanStageKey) => void;
}

export default function TechnicalPlanStageNavigation({ stages, onStageChange }: TechnicalPlanStageNavigationProps) {
  return (
    <section className="technical-plan-stage-panel" aria-label="新建标书流程">
      <nav className="technical-plan-stages" aria-label="流程步骤">
        {stages.map((stage, index) => (
          <button
            type="button"
            key={stage.key}
            className={`technical-plan-stage is-${stage.state}`}
            aria-current={stage.state === 'current' ? 'step' : undefined}
            disabled={stage.disabled}
            onClick={() => onStageChange(stage.key)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{stage.label}</strong>
            <small>{stage.statusLabel}</small>
          </button>
        ))}
      </nav>
    </section>
  );
}
```

- [ ] **Step 4: 实现步骤业务动作组件**

组件 props 只包含 `title`、`description`、`actionLabel`、`disabled`、`tooltip` 和 `onAction`。使用共享 `primary-action`，在按钮禁用时仍通过外层或既有 tooltip 机制提供原因；不要在组件内判断步骤或读取业务状态。

- [ ] **Step 5: 运行结构测试并确认通过**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: PASS，包括新增组件结构测试和仍然有效的旧布局断言；不得通过删除无关断言掩盖失败。

- [ ] **Step 6: 提交展示组件**

```powershell
git add client/src/features/technical-plan/components/TechnicalPlanStageNavigation.tsx client/src/features/technical-plan/components/TechnicalPlanStageFooter.tsx client/src/features/technical-plan/services/workflowLayout.test.ts
git commit -m "feat: add technical plan workflow stage components"
```

---

### Task 3: 将新骨架接入 TechnicalPlanHome

**Files:**
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx:78-85, 318-376, 507-574, 984-1100, 1230-1248`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts:590-633`

- [ ] **Step 1: 将旧布局测试改成新旧工作流分支测试并确认失败**

断言必须覆盖：

```ts
assert.match(home, /workflowKind === 'technical-plan'/);
assert.match(home, /TechnicalPlanStageNavigation/);
assert.match(home, /TechnicalPlanStageFooter/);
assert.match(home, /technical-workbench-global-scroll/);
assert.match(home, /pageScrollRef/);
assert.match(home, /scrollTo\(\{ top: 0/);
assert.match(home, /navigationActions\.map/); // 已有方案扩写仍保留旧导航
assert.match(home, /!useGlobalScrollLayout[\s\S]*navigationActions/);
assert.match(home, /!targetStage\?\.accessible/);
```

同时删除“所有 technical-workbench 均由项目状态栏承载首页/上下步”的旧断言，替换为“仅非全局滚动工作流保留旧导航”。

增加 DOM 源码顺序断言，确保 global-scroll 分支中 `TechnicalPlanStageNavigation`、远程知识异常入口、项目上下文、`technical-step-module`、`TechnicalPlanStageFooter` 按规格顺序出现。用各节点源码索引比较，不只断言节点存在。

- [ ] **Step 2: 运行定向测试并确认失败**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: FAIL，缺少新组件接入、根修饰类和滚动复位。

- [ ] **Step 3: 在页面集中计算步骤完成状态**

在现有 `requiredBidAnalysisReady`、`bidSectionReady`、`globalFactsReady` 等布尔值之后计算：

```ts
const isGlobalFactsReadyForContent = globalFactsReady && !globalFactsHasPlaceholder && !isGlobalFactsAdjusting;
const stageCompletion: TechnicalPlanStageCompletion = {
  'document-analysis': Boolean(state.tenderFile)
    && (!requiresOriginalPlan || Boolean(state.originalPlanFile))
    && quickConfigComplete,
  'bid-analysis': bidAnalysisReady,
  'outline-generation': Boolean(
    state.outlineData
    && state.outlineWordControlSnapshot
    && state.outlineMinimumDepthSnapshot !== undefined
  ),
  'global-facts': isGlobalFactsReadyForContent,
  'content-edit': Boolean(state.outlineData && hasGeneratedContent(state.outlineData.outline || [])),
};
```

生成 `currentStatusLabel` 时只复用现有任务状态：解析中、生成中、调整中、已暂停或待验收。不添加新的任务语义。把该完成映射传入 `buildTechnicalPlanStageModels()` 后，流程卡、底部动作和目标步骤准入都只读取返回模型的 `complete`、`canProceed`、`accessible`。

- [ ] **Step 4: 用同一份模型驱动流程卡和底部动作**

调用 `buildTechnicalPlanStageModels()`。定义 `useGlobalScrollLayout = workflowKind === 'technical-plan' && state.step !== 'expand'`；只有该条件成立时渲染 `TechnicalPlanStageNavigation`、`TechnicalPlanStageFooter` 和 `technical-workbench-global-scroll` 修饰类。点击流程卡和前四步业务动作都调用现有 `switchStep()`。

在 `switchStep()` 开头读取目标 `targetStage`。当 `useGlobalScrollLayout` 为真、目标属于五个主步骤且 `targetStage.accessible` 为假时，显示现有信息 Toast 并立即返回。后续原有的排序离开确认、缺失解析项定位、待填写事实定位和持久化逻辑继续执行，不删除已有守卫。由此流程卡、底部动作或任何非相邻调用都不能绕过同一份准入结果。

底部动作配置：

```ts
const currentStage = stageModels.find((stage) => stage.key === state.step);
const stageFooterAction = state.step === 'content-edit'
  ? { label: isExporting ? '导出中...' : '导出 Word', onAction: () => setExportDialogOpen(true), disabled: exportWordAction.disabled, tooltip: exportWordAction.tooltip }
  : currentStage ? {
      label: {
        'document-analysis': '进入文件解析',
        'bid-analysis': '确认解析结果，进入目录生成',
        'outline-generation': '确认目录，进入事实设定',
        'global-facts': '确认事实设定，进入正文生成',
      }[currentStage.key],
      onAction: () => void goToOffset(1),
      disabled: !currentStage.canProceed,
      tooltip: nextTooltip,
    } : null;
```

STEP 06 因 `useGlobalScrollLayout` 为假，不渲染新流程卡、底部动作或全局滚动修饰类；技术方案五步流程卡也不包含 STEP 06。上述 `currentStage` 收窄后再索引动作标签，避免用包含 `expand` 的 `TechnicalPlanStep` 直接索引四步映射。

为 footer 同时派生左侧说明，使用当前模型的 `canProceed` 选择就绪/未就绪文案：

```ts
const stageFooterCopy = currentStage ? {
  title: currentStage.canProceed ? '当前步骤已具备进入下一环节的条件' : '完成当前步骤后继续',
  description: currentStage.canProceed
    ? `${currentStage.label}已完成，请确认后继续。`
    : nextTooltip,
} : null;
```

STEP 05 使用“正文可导出 / 请先生成正文”的对应标题和 `exportWordAction.tooltip`。实例化 `TechnicalPlanStageFooter` 时完整传入 `title`、`description`、动作配置；不得留下未赋值 props。

- [ ] **Step 5: 调整项目上下文区**

技术方案全局滚动版显示：

- `新建标书 · 当前步骤名称`；
- `bidProject?.projectName || '新建标书'`；
- 同源序号（存在时）；
- “返回我的标书”。

不渲染 `navigationActions`。已有方案扩写继续使用现有紧凑 context bar 和通用导航按钮。

按明确 DOM 顺序重排 global-scroll 分支：`TechnicalPlanStageNavigation` → 远程知识异常入口（存在时）→ 项目上下文区 → `technical-step-module` → `TechnicalPlanStageFooter`。Dialog/Popover 门户保持在页面节点之后。非 global-scroll 分支继续保持原顺序与行为。

- [ ] **Step 6: 增加步骤切换滚动复位**

为根容器增加 `pageScrollRef`，仅在 technical-plan 工作流的 `state.step` 改变后调用：

```ts
useEffect(() => {
  if (!useGlobalScrollLayout) return;
  pageScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
}, [state.step, useGlobalScrollLayout]);
```

不得操作 `window` 或 `document.body` 滚动。

- [ ] **Step 7: 运行定向测试与 TypeScript 构建**

Run:

```powershell
node --test src/features/technical-plan/services/technicalPlanStepNavigation.test.ts src/features/technical-plan/services/workflowLayout.test.ts
npm run build
```

Expected: 测试 PASS；构建可能仅有既有 chunk 体积警告，退出码必须为 0。

- [ ] **Step 8: 提交页面接入**

```powershell
git add client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/services/workflowLayout.test.ts
git commit -m "feat: add new bid workflow navigation shell"
```

---

### Task 4: 实现页面根滚动、吸顶流程卡和统一表面

**Files:**
- Modify: `client/src/styles/feature-technical-plan.css:1-84, 310-325`
- Modify: `client/src/styles/feature-bid-project.css:713-761`
- Modify: `client/src/styles/layout-app-shell.css:473-476`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts:610-633`
- Modify: `client/src/styles/uiDensity.test.ts:48-58`

- [ ] **Step 1: 写入失败的布局 CSS 测试**

新增或更新断言：

```ts
assert.match(technicalCss, /\.technical-workbench-global-scroll\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto/s);
assert.match(technicalCss, /\.technical-plan-stage-panel\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:/s);
assert.match(technicalCss, /\.technical-plan-stages\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
assert.match(technicalCss, /\.technical-workbench-global-scroll \.technical-step-module\s*\{[^}]*overflow:\s*visible/s);
const globalStepContentCss = technicalCss.slice(
  technicalCss.indexOf('.technical-workbench-global-scroll .technical-step-content'),
  technicalCss.indexOf('/* global-scroll workspaces */'),
);
assert.match(globalStepContentCss, /overflow:\s*visible/);
assert.match(shellCss, /\.content-shell:has\(\.technical-workbench-global-scroll\)\s*\{[^}]*padding:\s*0/s);
```

在 `uiDensity.test.ts` 保留默认 `.technical-workbench { overflow: hidden; }` 断言，同时新增专用修饰类覆盖为页面根滚动，证明已有方案扩写没有被全局改写。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts src/styles/uiDensity.test.ts
```

Expected: FAIL，缺少新 CSS 选择器。

- [ ] **Step 3: 添加 technical-plan 专用根滚动样式**

保留 `.technical-workbench` 现有锁高规则，新增更具体的覆盖：

```css
.technical-workbench-global-scroll {
  display: flex;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.content-shell:has(.technical-workbench-global-scroll) {
  padding: 0;
}

.technical-workbench-global-scroll > :where(.bid-project-context-bar, .remote-knowledge-task-action, .technical-step-module, .technical-plan-stage-footer) {
  margin-inline: 36px;
}
```

为最后一个内容块提供正常底部留白，不为任何覆盖式工具条预留空间。

- [ ] **Step 4: 添加吸顶五步流程卡样式**

流程区规则与确认效果图一致：不透明表面、底边线、`position: sticky`、五等分网格；步骤卡使用 `is-complete`、`is-current`、`is-available`、`is-locked`。状态必须通过颜色和文字共同表达。卡片圆角不超过 8px。

窄宽度规则：

```css
@media (max-width: 900px) {
  .technical-plan-stages {
    grid-template-columns: repeat(5, minmax(138px, 1fr));
    overflow-x: auto;
  }

  .technical-workbench-global-scroll > :where(.bid-project-context-bar, .remote-knowledge-task-action, .technical-step-module, .technical-plan-stage-footer) {
    margin-inline: 18px;
  }
}
```

- [ ] **Step 5: 展开 technical-plan 步骤内容外层**

仅在 `.technical-workbench-global-scroll` 下覆盖。为让静态测试和实现保持一致，步骤模块使用独立规则；步骤内容相关选择器可分组，但在其后保留 `/* global-scroll workspaces */` 边界注释供测试截取：

```css
.technical-workbench-global-scroll .technical-step-module {
  display: block;
  min-height: auto;
  flex: 0 0 auto;
  overflow: visible;
  background: transparent;
  border: 0;
}

.technical-workbench-global-scroll .technical-step-content,
.technical-workbench-global-scroll .technical-step-content > .plan-step-body,
.technical-workbench-global-scroll .technical-step-content > .document-analysis-page {
  height: auto;
  overflow: visible;
}

/* global-scroll workspaces */
```

隐藏该分支原有 `.technical-step-navigation`，因为新的吸顶流程卡已经承担导航；已有方案扩写继续显示旧导航。

- [ ] **Step 6: 样式化项目上下文和步骤底部动作**

项目上下文使用两列：左侧项目标题/步骤说明，右侧“返回我的标书”；同源序号作为次级信息。底部动作区使用白色表面和成功色左边线，右侧仅一个主按钮，窄宽度时纵向堆叠。

- [ ] **Step 7: 运行样式测试**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts src/styles/uiDensity.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交页面骨架样式**

```powershell
git add client/src/styles/feature-technical-plan.css client/src/styles/feature-bid-project.css client/src/styles/layout-app-shell.css client/src/features/technical-plan/services/workflowLayout.test.ts client/src/styles/uiDensity.test.ts
git commit -m "style: add global scrolling new bid layout"
```

---

### Task 5: 给 STEP 02 至 STEP 05 建立确定的工作台高度

**Files:**
- Modify: `client/src/styles/feature-technical-plan.css:628-630, 1242-1244, 1589-1606, 3803-3806, 5211-5216`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: 写入失败的工作台高度断言**

```ts
assert.match(technicalCss, /\.technical-workbench-global-scroll\s*\{[^}]*--technical-stage-workspace-height:\s*clamp\(620px,\s*calc\(100dvh - 260px\),\s*820px\)/s);
const workspaceHeightCss = technicalCss.slice(
  technicalCss.indexOf('/* global-scroll workspaces */'),
  technicalCss.indexOf('/* global-scroll responsive */'),
);
for (const className of ['bid-analysis-workspace', 'outline-workspace-shell', 'global-facts-workspace', 'content-generation-workspace']) {
  assert.match(workspaceHeightCss, new RegExp(`\\.${className}`));
}
assert.match(workspaceHeightCss, /height:\s*var\(--technical-stage-workspace-height\)/);
```

同时断言工作台内部关键列表/面板仍有 `overflow: auto`，不把三栏或双栏内容全部展开到页面文档流。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: FAIL，高度变量和专用选择器不存在。

- [ ] **Step 3: 添加共享高度变量和四个工作台覆盖**

```css
.technical-workbench-global-scroll {
  --technical-stage-workspace-height: clamp(620px, calc(100dvh - 260px), 820px);
}

.technical-workbench-global-scroll :where(
  .bid-analysis-workspace,
  .outline-workspace-shell,
  .global-facts-workspace,
  .content-generation-workspace
) {
  height: var(--technical-stage-workspace-height);
  min-height: 0;
}

/* global-scroll responsive */
```

步骤页面根节点在全局滚动分支改为自然高度，但各工作台内部继续使用 `minmax(0, 1fr)` 和现有滚动容器。不要改动 `AdaptiveTwoPaneWorkspace` 的容器查询逻辑。

- [ ] **Step 4: 处理 STEP 01 长文预览**

确认 STEP 01 根节点不再自滚动；仅 Markdown 文件预览保留现有最大高度和 `overflow: auto`。若当前预览依赖父级 `height: 100%`，在 global-scroll 修饰类下给预览一个明确的 `max-height`，避免招标原文无限拉长页面。

- [ ] **Step 5: 运行定向测试和完整 technical-plan 测试**

Run:

```powershell
node --test src/features/technical-plan/services/technicalPlanStepNavigation.test.ts src/features/technical-plan/services/workflowLayout.test.ts src/features/technical-plan/services/quickConfig.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交工作台滚动边界**

```powershell
git add client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts
git commit -m "style: preserve technical workbench scroll boundaries"
```

---

### Task 6: 构建、桌面验证与回归收尾

**Files:**
- Test: `client/src/features/technical-plan/services/technicalPlanStepNavigation.test.ts`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`
- Test: `client/src/styles/uiDensity.test.ts`
- Verify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Verify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: 运行定向测试**

Run from `client/`:

```powershell
node --test src/features/technical-plan/services/technicalPlanStepNavigation.test.ts src/features/technical-plan/services/workflowLayout.test.ts src/styles/uiDensity.test.ts
```

Expected: PASS，退出码 0。

- [ ] **Step 2: 运行客户端构建**

```powershell
npm run build
```

Expected: `tsc --noEmit && vite build` 成功；仅既有 chunk 体积警告可接受。

- [ ] **Step 3: 启动桌面客户端**

```powershell
npm run dev
```

Expected: Vite 监听 `http://127.0.0.1:5173`，Electron 主窗口打开。若 5173 已占用，先确认是否为本仓库已有开发会话；由于 `--strictPort` 不得静默改端口。

- [ ] **Step 4: 手动验证新建标书五步**

在 `1440x920` 和 `1040x720`、侧栏展开/收起状态下确认：

- 页面只有一条纵向主滚动轴，流程卡始终吸顶；
- STEP 01 普通内容连续滚动，长 Markdown 预览仍局部滚动；
- STEP 02 至 STEP 05 工作台高度稳定，内部列表、目录、预览和编辑器可滚动；
- 已完成/可开始步骤可点击，待开放步骤不可点击；
- 切换步骤后页面回到顶部；
- 底部每步只有一个业务动作，无通用首页/上一步/下一步；
- Dialog、Popover、全屏预览和 Word 导出不被流程栏遮挡。

- [ ] **Step 5: 回归已有方案扩写**

打开 `existing-plan-expansion`，确认仍使用原锁高布局、旧步骤导航和内部工作台滚动；上传原方案、切换步骤和返回项目列表正常。

- [ ] **Step 6: 检查差异与用户已有修改**

```powershell
git status --short
git diff --check
git diff -- client/src/features/technical-plan client/src/styles/feature-technical-plan.css client/src/styles/feature-bid-project.css client/src/styles/layout-app-shell.css client/src/styles/uiDensity.test.ts
```

只检查和提交本计划文件；不得修改或提交当前工作树中已有的历史标书适配相关用户改动。

- [ ] **Step 7: 修复验证中发现的问题并重跑相关检查**

任何布局修复先补充或更新对应断言，再执行定向测试和 `npm run build`。完成前使用 `@superpowers:verification-before-completion` 核对实际命令输出。

- [ ] **Step 8: 提交验证修复（如有）**

```powershell
git add client/src/features/technical-plan/services/technicalPlanStepNavigation.ts client/src/features/technical-plan/services/technicalPlanStepNavigation.test.ts client/src/features/technical-plan/components/TechnicalPlanStageNavigation.tsx client/src/features/technical-plan/components/TechnicalPlanStageFooter.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/features/technical-plan/services/workflowLayout.test.ts client/src/styles/feature-technical-plan.css client/src/styles/feature-bid-project.css client/src/styles/layout-app-shell.css client/src/styles/uiDensity.test.ts
git commit -m "fix: finalize new bid workflow layout"
```

若验证未产生额外修改，不创建空提交。
