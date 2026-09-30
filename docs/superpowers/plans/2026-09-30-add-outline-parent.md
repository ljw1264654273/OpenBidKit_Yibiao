# 标书目录添加父目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在标书生成第三步为任意目录项原位添加一个新父目录，并在七级限制内保留原子树的正文、关联和评分映射。

**Architecture:** 新建纯 TypeScript 树操作模块负责子树深度判断和原位包裹，`OutlineEditPage` 只负责按钮、保存和编辑状态。Renderer 与 Main 的保存协议新增 `add-parent`，Main 通过完整 `idMap` 迁移原节点持久化数据，并把新父节点登记为用户补充目录。

**Tech Stack:** React 19、TypeScript、Electron CommonJS、better-sqlite3、Node test runner、Vite

---

## 文件结构

- Create: `client/src/features/technical-plan/services/outlineParent.ts` - 纯树变换、子树最大深度和可添加判断。
- Create: `client/src/features/technical-plan/services/outlineParent.test.ts` - 根节点、嵌套节点、兄弟顺序和七级边界单元测试。
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx` - 接入添加父目录按钮、保存编排和编辑状态。
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts` - 校验页面入口和 `add-parent` 协议调用。
- Modify: `client/src/features/technical-plan/types.ts` - 扩展 `SaveOutlineReason`。
- Modify: `client/electron/services/technicalPlanStore.cjs` - 接受 `add-parent` 并维护评分覆盖映射。
- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs` - 验证新父节点评分记录与旧节点映射。
- Modify: `client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs` - 验证正文、节点状态、图片引用迁移及整体任务失效。

### Task 1: 纯树变换与七级限制

**Files:**
- Create: `client/src/features/technical-plan/services/outlineParent.ts`
- Create: `client/src/features/technical-plan/services/outlineParent.test.ts`

- [ ] **Step 1: 编写失败测试**

覆盖以下断言：

```ts
test('原位包裹根节点并保留兄弟顺序和完整子树', () => {
  const result = insertOutlineParent(outline, '2', {
    id: '__outline_parent__',
    title: '新目录项',
    description: '请编辑描述',
  });
  assert.equal(result?.[1].id, '__outline_parent__');
  assert.equal(result?.[1].children?.[0].id, '2');
  assert.equal(result?.[1].children?.[0].children?.[0].id, '2.1');
  assert.equal(result?.[2].id, '3');
});

test('原位包裹嵌套节点', () => {
  const result = insertOutlineParent(outline, '1.2', parent);
  assert.equal(result?.[0].children?.[1].id, parent.id);
  assert.equal(result?.[0].children?.[1].children?.[0].id, '1.2');
});

test('只有整棵子树下移后不超过七级时才允许添加父目录', () => {
  assert.equal(canAddOutlineParent(nodeWithDeepestId('1.2.3.4.5.6')), true);
  assert.equal(canAddOutlineParent(nodeWithDeepestId('1.2.3.4.5.6.7')), false);
});

test('找不到节点时返回 null', () => {
  assert.equal(insertOutlineParent(outline, 'missing', parent), null);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineParent.test.ts`

Expected: FAIL，提示 `outlineParent.ts` 或导出函数不存在。

- [ ] **Step 3: 实现最小纯函数**

在 `outlineParent.ts` 导出：

```ts
export function getOutlineSubtreeMaxDepth(item: OutlineItem): number;
export function canAddOutlineParent(item: OutlineItem): boolean;
export function insertOutlineParent(
  items: OutlineItem[],
  itemId: string,
  parent: Omit<OutlineItem, 'children'>,
): OutlineItem[] | null;
```

`getOutlineSubtreeMaxDepth` 遍历当前节点及后代的规范编号，以 `outlineDepth()` 求最大值；`canAddOutlineParent` 要求最大值小于 `MAX_OUTLINE_DEPTH`。`insertOutlineParent` 在命中层级用 `{ ...parent, children: [item] }` 原位替换，未命中返回 `null`，不修改输入数组和节点。

- [ ] **Step 4: 运行测试并确认通过**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineParent.test.ts`

Expected: PASS，4 个场景全部通过。

- [ ] **Step 5: 提交纯函数**

```powershell
git add client/src/features/technical-plan/services/outlineParent.ts client/src/features/technical-plan/services/outlineParent.test.ts
git commit -m "feat: add outline parent tree transform"
```

### Task 2: Renderer 页面交互与保存协议

**Files:**
- Modify: `client/src/features/technical-plan/types.ts:17`
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx:20,1349-1510,2348-2358`
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts:785`

- [ ] **Step 1: 编写失败的页面结构测试**

在 `workflowLayout.test.ts` 增加断言：

```ts
test('目录详情可原位添加父目录并使用 add-parent 持久化', () => {
  const source = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const addParentItem = async/);
  assert.match(source, /insertOutlineParent/);
  assert.match(source, /'add-parent'/);
  assert.match(source, />添加父目录<\/button>/);
  assert.match(source, /canAddOutlineParent\(selectedItem\)/);
  assert.match(source, /idMap\[newParentTemporaryId\]/);
  assert.match(source, /setEditTitle\(newParent\.title\)/);
  assert.match(source, /setEditDescription\(newParent\.description\)/);
  assert.match(source, /父目录已添加/);
});
```

- [ ] **Step 2: 运行相关 Renderer 测试并确认失败**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL，找不到添加父目录处理函数和按钮。

- [ ] **Step 3: 扩展 Renderer 保存原因**

将 `SaveOutlineReason` 增加 `'add-parent'`：

```ts
export type SaveOutlineReason = 'sort' | 'edit' | 'delete' | 'add-root' | 'add-child' | 'add-parent' | 'replace';
```

- [ ] **Step 4: 实现页面编排**

在 `OutlineEditPage.tsx` 引入 `canAddOutlineParent` 和 `insertOutlineParent`，实现 `addParentItem()`：

```ts
const newParentTemporaryId = '__outline_parent__';
const wrappedOutline = insertOutlineParent(outlineData.outline, selectedItem.id, {
  id: newParentTemporaryId,
  title: '新目录项',
  description: '请编辑描述',
});
if (!wrappedOutline) throw new Error('当前目录项不存在，请刷新后重试');

const renumbered = await saveOutlineChange(wrappedOutline, 'add-parent');
if (!renumbered) throw new Error('目录数据尚未就绪，请刷新后重试');
const newParentId = renumbered.idMap[newParentTemporaryId];
setExpandedItems((prev) => new Set(prev).add(newParentId));
setSelectedItemId(newParentId);
setEditingItemId(newParentId);
setEditTitle(newParent.title);
setEditDescription(newParent.description);
```

`addParentItem()` 首先显式检查 `outlineData`、`selectedItem`、排序和锁定状态。为让调用方取得最终 ID，将 `saveOutlineChange()` 返回 `renumbered`，保留其现有无目录早退语义并让调用方在空返回时抛出可操作错误。新父节点不设置 `content_mode`。在详情操作区加入“添加父目录”按钮，禁用条件包含既有锁定/排序状态和 `!canAddOutlineParent(selectedItem)`；处理函数再次检查深度并显示七级提示。保存成功后使用新父目录默认值初始化 `editTitle`、`editDescription`、`editContentMode` 和 `editContentModeNote`，再进入编辑态并提示“父目录已添加”。

- [ ] **Step 5: 运行纯函数和页面结构测试**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineParent.test.ts src/features/technical-plan/services/workflowLayout.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交 Renderer 改动**

```powershell
git add client/src/features/technical-plan/types.ts client/src/features/technical-plan/pages/OutlineEditPage.tsx client/src/features/technical-plan/services/workflowLayout.test.ts
git commit -m "feat: add parent directory action"
```

### Task 3: Main Store 的 `add-parent` 持久化

**Files:**
- Modify: `client/electron/services/technicalPlanStore.cjs:437,540-580`
- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs:125-145`
- Modify: `client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs`

- [ ] **Step 1: 编写失败的评分映射测试**

构造把旧节点 `1.1` 包裹为新父节点 `1.1`、旧节点迁移到 `1.1.1` 的保存请求：

```js
const saved = store.saveOutline({
  outlineData: wrappedOutline,
  reason: 'add-parent',
  idMap: {
    '1': '1',
    '__outline_parent__': '1.1',
    '1.1': '1.1.1',
    '1.2': '1.2',
  },
  affectedNodeIds: [],
});
assert.deepEqual(existingRecord.node_ids, ['1.1.1', '1.2']);
assert.deepEqual(userRecord.node_ids, ['1.1']);
assert.equal(userRecord.user_override, 'added');
```

- [ ] **Step 2: 编写失败的持久状态迁移测试**

在图片保留测试的 Store 夹具中保存 `1.1` 的正文、节点级生成状态、生成计划、知识库关联和全文图片计划，再以 `add-parent` + `idMap` 保存。断言：

```js
assert.equal(saved.outlineData.outline[0].children[0].children[0].content, '正文一');
assert.deepEqual(saved.outlineData.outline[0].children[0].children[0].knowledge_folder_ids, ['folder-1']);
assert.equal(saved.contentGenerationSections['1.1.1'].status, 'success');
assert.ok(saved.contentGenerationPlans['1.1.1']);
assert.deepEqual(saved.contentIllustrationPlan.items[0].section_ids, ['1.1.1']);
assert.equal(saved.contentGenerationTask, undefined);
assert.equal(saved.contentGenerationRuntime, undefined);
```

- [ ] **Step 3: 运行 Store 测试并确认失败**

Run: `cd client; node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs`

Expected: FAIL，`add-parent` 被归一化为 `replace` 或新父节点未加入评分映射。

- [ ] **Step 4: 实现 Store 协议**

把 `add-parent` 加入 `outlineSaveReasons`，并在 `updateScoreCoverageForOutlineSave()` 中与 `add-root`、`add-child` 一起识别新增节点：

```js
if (reason === 'add-root' || reason === 'add-child' || reason === 'add-parent') {
  // 现有新增节点评分覆盖维护逻辑
}
```

不修改 `saveOutline()` 的其余失效与协调分支：`add-parent !== 'sort'` 会清理整体正文任务/runtime；空 `affectedNodeIds` + `idMap` 会保留并迁移节点级数据，现有图片协调逻辑会同步重映射全文图片计划及图片引用。

- [ ] **Step 5: 运行 Store 测试并确认通过**

Run: `cd client; node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs`

Expected: PASS。

- [ ] **Step 6: 检查 Main 文件语法**

Run: `cd client; node --check electron/services/technicalPlanStore.cjs`

Expected: 退出码 0，无输出。

- [ ] **Step 7: 提交 Store 改动**

```powershell
git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs
git commit -m "feat: persist added outline parents"
```

### Task 4: 集成验证

**Files:**
- Verify only

- [ ] **Step 1: 运行全部定向测试**

Run:

```powershell
cd client
node --test --experimental-strip-types src/features/technical-plan/services/outlineParent.test.ts src/features/technical-plan/services/workflowLayout.test.ts
node --test electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs
```

Expected: 全部 PASS。

- [ ] **Step 2: 验证 Electron native 模块**

Run: `cd client; npm run smoke:electron-native`

Expected: PASS。

- [ ] **Step 3: 构建客户端**

Run: `cd client; npm run build`

Expected: TypeScript 和 Vite 构建成功；允许既有 chunk 体积警告。

- [ ] **Step 4: 启动开发环境并手动验证**

Run: `cd client; npm run dev`

验证技术方案和已有方案扩写两个入口：根节点与嵌套节点均可原位添加父目录；新父目录自动选中、展开并进入编辑；原节点正文及知识库关联保留；七级子树按钮禁用；排序和运行中状态仍锁定操作。

- [ ] **Step 5: 检查工作区差异**

Run: `git status --short; git diff --check`

Expected: 无空白错误；只包含本功能改动和任务开始前已经存在的用户改动。
