# 技术方案目录最小层级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 STEP 01 和 STEP 03 提供同步的默认/三级/四级/五级目录最低层级配置，并让完整目录生成、恢复、最终审核及局部 AI 子目录生成确定性遵守该配置。

**Architecture:** 使用独立的 `0 | 3 | 4 | 5` 项目配置和生效快照，不混入字数控制；SQLite 根表和动态项目表共同迁移。完整目录任务在启动时固化配置，通过 Agent Prompt 与宿主程序树深度校验双重执行；Renderer 的局部 AI 子目录逻辑下沉到 feature service，以递归结构化输出和局部校验处理。

**Tech Stack:** Electron CommonJS Main、React + TypeScript Renderer、SQLite/better-sqlite3、Radix UI、Node test runner、Vite。

---

## 文件结构

- Create `client/src/features/technical-plan/services/outlineMinimumDepth.ts`：层级归一化、文案和组合任务锁定纯函数。
- Create `client/src/features/technical-plan/services/outlineMinimumDepth.test.ts`：纯函数测试。
- Create `client/src/features/technical-plan/services/outlineAiChildren.ts`：局部 AI 子目录 Prompt、递归归一化、编号与校验。
- Create `client/src/features/technical-plan/services/outlineAiChildren.test.ts`：局部递归目录测试。
- Create `client/electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs`：根表与动态项目表 migration 测试。
- Create `client/electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs`：Store、legacy 和 variant seed 测试。
- Create `client/electron/services/taskService.outlineMinimumDepth.test.cjs`：任务 payload 与事件 patch 测试。
- Modify `client/src/shared/types/outline.ts`、`client/src/features/technical-plan/types.ts`、`client/src/shared/types/ipc.ts`：共享类型与 bridge payload。
- Modify `client/electron/services/sqliteDatabase.cjs`、`client/electron/services/technicalPlanStore.cjs`、`client/electron/services/taskService.cjs`、`client/electron/services/outlineGenerationTaskV2.cjs`：Main 持久化和生成约束。
- Modify `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`、`DocumentAnalysisPage.tsx`、`OutlineEditPage.tsx`：状态同步和 UI。
- Modify `client/src/styles/feature-technical-plan.css`：配置布局。
- Modify `client/src/features/technical-plan/services/quickConfig.test.ts`、`workflowLayout.test.ts`、`client/electron/services/outlineGenerationTaskV2.test.cjs`：回归测试。
- Modify `sql/workspace_schema.sql`：同步目标 schema。

### Task 1: 定义最小层级类型与纯函数

**Files:**
- Modify: `client/src/shared/types/outline.ts`
- Create: `client/src/features/technical-plan/services/outlineMinimumDepth.ts`
- Test: `client/src/features/technical-plan/services/outlineMinimumDepth.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('目录最低层级只接受默认、三级、四级、五级', () => {
  assert.equal(normalizeOutlineMinimumDepth(undefined), 0);
  assert.equal(normalizeOutlineMinimumDepth(3), 3);
  assert.equal(normalizeOutlineMinimumDepth(4), 4);
  assert.equal(normalizeOutlineMinimumDepth(5), 5);
  assert.equal(normalizeOutlineMinimumDepth(2), 0);
  assert.equal(formatOutlineMinimumDepth(0), '默认');
  assert.equal(formatOutlineMinimumDepth(5), '五级');
});
```

组合锁定测试分别传入目录生成、目录调整和正文任务的 `running/pausing/paused`，期望均为 `true`；完成和失败状态期望为 `false`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineMinimumDepth.test.ts`

Expected: FAIL，模块或导出不存在。

- [ ] **Step 3: 写最小实现**

```ts
export type OutlineMinimumDepth = 0 | 3 | 4 | 5;
export const DEFAULT_OUTLINE_MINIMUM_DEPTH: OutlineMinimumDepth = 0;
export function normalizeOutlineMinimumDepth(value: unknown): OutlineMinimumDepth {
  return value === 3 || value === 4 || value === 5 ? value : 0;
}
```

实现 `formatOutlineMinimumDepth()` 和 `isOutlineConfigLocked()`，不在页面重复判断。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineMinimumDepth.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add client/src/shared/types/outline.ts client/src/features/technical-plan/services/outlineMinimumDepth.ts client/src/features/technical-plan/services/outlineMinimumDepth.test.ts; git commit -m "feat: add outline minimum depth primitives"`

### Task 2: 迁移 SQLite 根表和动态项目表

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Modify: `sql/workspace_schema.sql`
- Test: `client/electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs`

- [ ] **Step 1: 写失败测试**

测试先创建旧版 `technical_plan_meta` 与 `technical_plan_project_demo_meta`，运行 migration 后读取 `PRAGMA table_info`，断言两表都有 `outline_minimum_depth` 和 `outline_minimum_depth_snapshot`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs`

Expected: FAIL，动态项目表缺列。

- [ ] **Step 3: 写 migration**

根表和 `createTechnicalPlanProjectSchema()` 增加：

```sql
outline_minimum_depth INTEGER NOT NULL DEFAULT 0,
outline_minimum_depth_snapshot INTEGER,
```

新增 `addTechnicalPlanOutlineMinimumDepth(db)`，枚举 `technical_plan_meta` 和 `technical_plan_project_*_meta` 并调用 `addColumnIfMissing()`；schema version 升至 37，健康检查覆盖动态项目表。同步 `sql/workspace_schema.sql`。

- [ ] **Step 4: 运行测试与语法检查**

Run: `cd client; node --test electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs; node --check electron/services/sqliteDatabase.cjs`

Expected: PASS，退出码 0。

- [ ] **Step 5: 提交**

Run: `git add client/electron/services/sqliteDatabase.cjs client/electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs sql/workspace_schema.sql; git commit -m "feat: migrate outline minimum depth storage"`

### Task 3: Store 持久化、legacy 快照和派生项目

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs`
- Test: `client/electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs`

- [ ] **Step 1: 写失败测试**

覆盖默认当前值为 0、保存 5、成功目录快照为 5、已有目录但 NULL 快照加载为 legacy 0、空项目快照为 `undefined`、清空目录清空快照、来源项目五级派生后当前值为 5 且快照为空。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs`

Expected: FAIL，新字段未保存。

- [ ] **Step 3: 写 Store 实现**

Main 侧新增归一化函数并接入默认状态、`saveOutlineConfig()`、partial patch、完整加载和所有清理路径。加载快照使用：

```js
const outlineMinimumDepthSnapshot = meta.outline_minimum_depth_snapshot == null
  ? (outlineData?.outline?.length ? 0 : undefined)
  : normalizeOutlineMinimumDepth(meta.outline_minimum_depth_snapshot);
```

`exportVariantSeed()` 导出当前值；`importVariantSeed()` 写入归一化当前值并强制 snapshot NULL。

- [ ] **Step 4: 运行 Store 回归测试**

Run: `cd client; node --test electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs; node --test electron/services/technicalPlanStore.contentGenerationOptions.test.cjs; node --test electron/services/technicalPlanStore.bidSectionStep.test.cjs; node --check electron/services/technicalPlanStore.cjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

Run: `git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs; git commit -m "feat: persist outline minimum depth settings"`

### Task 4: 扩展任务 payload 和状态传播链

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/shared/types/ipc.ts`
- Modify: `client/electron/services/taskService.cjs`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Test: `client/electron/services/taskService.outlineMinimumDepth.test.cjs`

- [ ] **Step 1: 写失败测试**

断言 `startOutlineGeneration()` 向 runner 传递 `minimum_outline_depth: 5`，初始 patch 保留 `outlineMinimumDepth: 5` 并清空 `outlineMinimumDepthSnapshot`；成功、清空和完整 snapshot patch 都传播新字段。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/taskService.outlineMinimumDepth.test.cjs`

Expected: FAIL，payload/patch 缺字段。

- [ ] **Step 3: 写类型和传播实现**

`TechnicalPlanState`、resume payload、save config payload 和 start payload 增加 `outlineMinimumDepth`、`outlineMinimumDepthSnapshot`、`minimum_outline_depth`。`taskService` 的 user settings、完整 snapshot、各任务 patch 和清理 patch复制字段。`TechnicalPlanHome` 的初始状态、加载、事件合并和 reset 分支同步字段。

正文启动和导航检查必须使用 `snapshot === undefined`，不能用 falsy 判断拒绝默认值 0。

- [ ] **Step 4: 运行测试和 TypeScript 检查**

Run: `cd client; node --test electron/services/taskService.outlineMinimumDepth.test.cjs; npx tsc --noEmit; node --check electron/services/taskService.cjs; node --check electron/preload.cjs`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add client/src/features/technical-plan/types.ts client/src/shared/types/ipc.ts client/electron/services/taskService.cjs client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/electron/services/taskService.outlineMinimumDepth.test.cjs; git commit -m "feat: propagate outline minimum depth through tasks"`

### Task 5: 完整目录 Prompt 与确定性深度校验

**Files:**
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs`
- Test: `client/electron/services/outlineGenerationTaskV2.test.cjs`

- [ ] **Step 1: 写失败测试**

为 `buildOutlineReviewContext()` 增加默认/3/4/5、非 AI 叶子、非技术分支、实际树深度不依赖错误 ID 的测试；断言五级配置下 `1.1.1.1` AI 叶子进入 `minimum_depth.shallow_ai_leaves`。Prompt 测试断言 children/leaf adjustment/review correction 均包含最低层级要求。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs`

Expected: FAIL，`minimum_depth` 不存在。

- [ ] **Step 3: 写校验和 Prompt 实现**

任务开头固化：

```js
const minimumDepth = normalizeOutlineMinimumDepth(
  payload?.minimum_outline_depth ?? storedPlan.outlineMinimumDepth,
);
```

递归技术 branch 根节点，按实际父子结构计算绝对 depth，只检查 `ai-generate` 叶子。`buildOutlineReviewContext()` 返回 `minimum_depth`，最终 `deterministicReviewPassed` 增加该项；复检耗尽后的错误包含配置值、数量和首批标题。成功 checkpoint 写入 `outlineMinimumDepthSnapshot: minimumDepth`。

- [ ] **Step 4: 运行测试和语法检查**

Run: `cd client; node --test electron/services/outlineGenerationTaskV2.test.cjs; node --check electron/services/outlineGenerationTaskV2.cjs`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineGenerationTaskV2.test.cjs; git commit -m "feat: enforce outline minimum depth"`

### Task 6: 局部 AI 子目录递归生成 service

**Files:**
- Create: `client/src/features/technical-plan/services/outlineAiChildren.ts`
- Test: `client/src/features/technical-plan/services/outlineAiChildren.test.ts`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`

- [ ] **Step 1: 写失败测试**

测试一级父节点在五级配置下返回的所有 AI 叶子至少五级；拒绝单子节点、同级重复标题、空泛标题和超过七级；默认模式允许按语义生成直接子节点。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineAiChildren.test.ts`

Expected: FAIL，service 不存在。

- [ ] **Step 3: 写 service 并瘦身组件**

Service 导出：

```ts
export function buildOutlineAiChildrenMessages(input: {
  title: string; description: string; requirement: string;
  parentDepth: number; minimumDepth: OutlineMinimumDepth;
}): AiMessage[];

export function normalizeGeneratedChildren(
  value: unknown,
  options: { parentId: string; parentDepth: number; minimumDepth: OutlineMinimumDepth; startIndex: number },
): OutlineItem[];
```

递归赋点号 ID，父节点删除 content mode，叶子归一化 content mode。`OutlineEditPage.addAiChildren()` 捕获当前配置，调用 service 后再使用现有 `saveOutlineChange(..., 'add-child', [selectedItem.id])`。

- [ ] **Step 4: 运行测试和类型检查**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineAiChildren.test.ts; npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add client/src/features/technical-plan/services/outlineAiChildren.ts client/src/features/technical-plan/services/outlineAiChildren.test.ts client/src/features/technical-plan/pages/OutlineEditPage.tsx; git commit -m "feat: generate nested outline children"`

### Task 7: STEP 01 快速配置 UI

**Files:**
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Test: `client/src/features/technical-plan/services/quickConfig.test.ts`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: 写失败测试**

源码契约测试断言“目录层级”、默认/三级/四级/五级、摘要回显和 `onOutlineMinimumDepthChange` 存在；纯函数测试覆盖目录任务运行时锁定。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/quickConfig.test.ts; node --experimental-strip-types --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL，目录层级行不存在。

- [ ] **Step 3: 写 STEP 01 UI**

`DocumentAnalysisPageProps` 增加当前值、统一锁定状态和保存回调。摘要加入：

```tsx
<span>目录 <b>{formatOutlineMinimumDepth(outlineMinimumDepth)}</b></span>
```

展开面板复用 quick-config pill 渲染 `[0, 3, 4, 5]`。保存通过 `TechnicalPlanHome.saveOutlineConfig()` 带上完整现有目录配置，只替换 `minimumDepth`。

- [ ] **Step 4: 运行测试和构建**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/quickConfig.test.ts; node --experimental-strip-types --test src/features/technical-plan/services/workflowLayout.test.ts; npm run build`

Expected: PASS；允许既有 chunk warning。

- [ ] **Step 5: 提交**

Run: `git add client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/quickConfig.test.ts client/src/features/technical-plan/services/workflowLayout.test.ts; git commit -m "feat: add outline depth quick config"`

### Task 8: STEP 03 配置、快照提示与双向同步

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: 写失败测试**

断言 STEP 03 存在“最小目录层级”、四个选项、`outlineMinimumDepthSnapshot` 失配判断、重新生成提示和启动 payload 的 `minimum_outline_depth`。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL。

- [ ] **Step 3: 写 STEP 03 UI**

打开弹窗时用当前项目值初始化 draft；保存后更新同一项目配置。启动任务传递捕获值。失配判断使用显式比较：

```ts
const depthRequiresRegeneration = Boolean(
  outlineData && outlineMinimumDepthSnapshot !== undefined
  && outlineMinimumDepth !== outlineMinimumDepthSnapshot,
);
```

旧目录由 Store 派生 legacy snapshot 0，不误提示。

- [ ] **Step 4: 运行测试和构建**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/workflowLayout.test.ts; npm run build`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/features/technical-plan/pages/TechnicalPlanHome.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts; git commit -m "feat: configure outline depth in step three"`

### Task 9: 全量自测和完成检查

**Files:**
- Verify: all feature files above.

- [ ] **Step 1: 运行 Renderer 定向测试**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineMinimumDepth.test.ts; node --experimental-strip-types --test src/features/technical-plan/services/outlineAiChildren.test.ts; node --experimental-strip-types --test src/features/technical-plan/services/quickConfig.test.ts; node --experimental-strip-types --test src/features/technical-plan/services/workflowLayout.test.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 运行 Main 定向测试**

Run: `cd client; node --test electron/services/sqliteDatabase.outlineMinimumDepthMigration.test.cjs; node --test electron/services/technicalPlanStore.outlineMinimumDepth.test.cjs; node --test electron/services/taskService.outlineMinimumDepth.test.cjs; node --test electron/services/outlineGenerationTaskV2.test.cjs`

Expected: 全部 PASS。

- [ ] **Step 3: 运行语法检查**

Run: `cd client; node --check electron/preload.cjs; node --check electron/services/sqliteDatabase.cjs; node --check electron/services/technicalPlanStore.cjs; node --check electron/services/taskService.cjs; node --check electron/services/outlineGenerationTaskV2.cjs`

Expected: 全部退出码 0。

- [ ] **Step 4: 运行 native smoke 与完整构建**

Run: `cd client; npm run smoke:electron-native; npm run build`

Expected: 退出码 0；既有 chunk 体积警告允许存在。

- [ ] **Step 5: 检查差异**

Run: `git status --short; git diff --check`

确认未修改用户已有的 `client/package.json` 和 `client/package-lock.json`，没有调试日志、占位文案或临时文件。如有验证性修正，单独提交 `fix: complete outline minimum depth validation`。

