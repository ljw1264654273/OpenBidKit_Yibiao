# 仅删除当前目录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在目录生成第三步增加“仅删除当前目录”操作，删除选中节点并将其子节点按原顺序提升到原父级，同时保留现有级联删除行为。

**Architecture:** 在 Renderer 增加一个纯树变换函数，将目标节点替换为其 children；页面通过现有 `saveOutlineChange(..., 'delete')` 保存，交由 Main Store 复用现有正文、图片、评分和编号迁移规则。新增按钮只负责调用该变换、处理最低目录数量和更新选择状态。

**Tech Stack:** React + TypeScript、Node `node:test`、Electron Store CJS、Vite。

---

### Task 1: 纯树提升函数

**Files:**
- Create or modify: `client/src/features/technical-plan/services/outlineDelete.ts`
- Test: `client/src/features/technical-plan/services/outlineDelete.test.ts`

- [ ] **Step 1: Write failing tests**

覆盖叶子节点移除、根节点提升、嵌套节点提升、兄弟顺序、子树完整保留以及找不到节点的返回值。

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineDelete.test.ts`

Expected: FAIL because the new helper is not implemented.

- [ ] **Step 3: Implement the minimal tree transform**

增加 `deleteOutlineOnly(items, itemId)`：递归访问节点；命中目标时返回目标 children（无 children 时返回空数组）；未命中时复制节点并递归处理 children；找不到目标返回 `null`，不修改输入树。

- [ ] **Step 4: Run the focused test and confirm pass**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineDelete.test.ts`

Expected: all focused tree tests pass.

### Task 2: 页面操作编排

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Add a page structure test**

断言页面引入 `deleteOutlineOnly`，存在 `removeItemOnly` 处理函数，并渲染“仅删除当前目录”按钮；同时保留现有“删除”按钮和 `removeItem` 调用。

- [ ] **Step 2: Run the focused page test and confirm failure**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts`

Expected: FAIL because the new import, handler and button are absent.

- [ ] **Step 3: Implement `removeItemOnly`**

复用现有锁定检查和最低目录数量规则。找到目标节点后调用 `deleteOutlineOnly`；将目标节点自身 ID 作为 `affectedNodeIds` 调用 `saveOutlineChange(nextOutline, 'delete', [itemId])`。保存成功后选择提升后的第一个节点（无提升节点时清空选择），并显示“当前目录已删除，子目录已提升”或叶子节点删除提示。失败时保留当前选择并显示错误 Toast。

- [ ] **Step 4: Add the button beside the existing delete button**

使用现有 `danger-action` 样式，禁用条件与现有删除按钮一致。按钮文案明确为“仅删除当前目录”。

- [ ] **Step 5: Run the focused page and tree tests**

Run: `cd client; node --test --experimental-strip-types src/features/technical-plan/services/outlineDelete.test.ts src/features/technical-plan/services/workflowLayout.test.ts`

Expected: all tests pass.

### Task 3: 回归验证

**Files:**
- No additional source files.

- [ ] **Step 1: Check Main Store syntax**

Run: `cd client; node --check electron/services/technicalPlanStore.cjs`

Expected: exit code 0; no Main Store changes are expected.

- [ ] **Step 2: Run native smoke**

Run: `cd client; npm run smoke:electron-native`

Expected: better-sqlite3 loads and executes a query successfully.

- [ ] **Step 3: Run the complete client build**

Run: `cd client; npm run build`

Expected: `tsc --noEmit` and `vite build` exit 0; existing chunk-size warnings are acceptable.

- [ ] **Step 4: Check diff whitespace**

Run: `git diff --check`

Expected: no whitespace errors.
