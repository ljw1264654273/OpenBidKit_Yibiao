# Knowledge Base Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将五类本地知识库的中文显示名称统一改为“文档”，同步菜单描述、Analytics Dashboard、测试和仓库说明，同时保持内部 ID 与协议兼容。

**Architecture:** 中文显示名继续以 `knowledgeBaseCatalog.ts` 为客户端权威来源；菜单描述改为显式的自然语言映射，避免从新标题机械拼出“文档资料”。Analytics 只更新现有 pageLabels 的中文值，所有 navigationId、数据库分类 ID、IPC 和持久化结构保持不变。

**Tech Stack:** React + TypeScript、Electron CommonJS、Node test runner、Vite、Analytics Dashboard JavaScript。

---

### Task 1: Lock the new labels and menu descriptions with failing tests

**Files:**
- Modify: `client/electron/services/knowledgeBaseStore.categories.test.cjs`
- Modify: `client/src/app/menuConfig.test.ts`

- [ ] **Step 1: Update the catalog contract expectations**

In `assertKnowledgeBaseCatalog()`, change only the five label expectations to:

```js
['national-standard', '国标文档', 'national-standard-knowledge-base'],
['provincial-standard', '省标文档', 'provincial-standard-knowledge-base'],
['municipal-standard', '市标文档', 'municipal-standard-knowledge-base'],
['industry-standard', '行业标文档', 'industry-standard-knowledge-base'],
['enterprise', '企业文档', 'enterprise-knowledge-base'],
```

- [ ] **Step 2: Add focused menu behavior assertions**

Extend `client/src/app/menuConfig.test.ts` to load `appMenuItems` and assert the exact descriptions for the six local entries:

```ts
[
  ['document-knowledge-base', '管理文档资料、文件夹和可复用知识条目'],
  ['national-standard-knowledge-base', '管理国标资料、文件夹和可复用知识条目'],
  ['provincial-standard-knowledge-base', '管理省标资料、文件夹和可复用知识条目'],
  ['municipal-standard-knowledge-base', '管理市标资料、文件夹和可复用知识条目'],
  ['industry-standard-knowledge-base', '管理行业标资料、文件夹和可复用知识条目'],
  ['enterprise-knowledge-base', '管理企业资料、文件夹和可复用知识条目'],
]
```

The test should verify the exported menu behavior and should not require a particular mapping implementation.

- [ ] **Step 3: Run the focused tests and verify RED**

Run from `client/`:

```powershell
node --test electron/services/knowledgeBaseStore.categories.test.cjs src/app/menuConfig.test.ts
```

Expected: FAIL because the catalog still exposes the five old labels and the menu still derives descriptions from the label.

- [ ] **Step 4: Commit the failing contract tests**

```powershell
git add client/electron/services/knowledgeBaseStore.categories.test.cjs client/src/app/menuConfig.test.ts
git commit -m "test: define knowledge document labels"
```

### Task 2: Implement client labels and natural menu descriptions

**Files:**
- Modify: `client/src/features/knowledge-base/knowledgeBaseCatalog.ts`
- Modify: `client/src/app/menuConfig.ts`

- [ ] **Step 1: Replace the five catalog labels**

Set the catalog labels to `国标文档`、`省标文档`、`市标文档`、`行业标文档`、`企业文档`. Keep all `id` and `navigationId` values unchanged.

- [ ] **Step 2: Add explicit description bases**

Add a typed mapping keyed by local knowledge-base ID:

```ts
const knowledgeBaseDescriptionLabels = {
  document: '文档',
  'national-standard': '国标',
  'provincial-standard': '省标',
  'municipal-standard': '市标',
  'industry-standard': '行业标',
  enterprise: '企业',
} satisfies Record<(typeof KNOWLEDGE_BASE_CATALOG)[number]['id'], string>;
```

Build each description as `管理${knowledgeBaseDescriptionLabels[item.id]}资料、文件夹和可复用知识条目`.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run from `client/`:

```powershell
node --test electron/services/knowledgeBaseStore.categories.test.cjs src/app/menuConfig.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the client implementation**

```powershell
git add client/src/features/knowledge-base/knowledgeBaseCatalog.ts client/src/app/menuConfig.ts
git commit -m "feat: rename local knowledge categories"
```

### Task 3: Synchronize Analytics labels and repository documentation

**Files:**
- Modify: `analytics/dashboard/public/src/pages/traffic.js`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-20-knowledge-base-categories-design.md`
- Modify: `docs/superpowers/specs/2026-09-20-step03-outline-node-knowledge-design.md`
- Modify: `docs/superpowers/plans/2026-09-22-step03-node-knowledge-selection.md`

- [ ] **Step 1: Update every Dashboard label derived from the five navigation IDs**

Replace the top-level, `/library`, and all `/viewer/*` Chinese labels for the five categories with the approved new names. Do not change the object keys.

- [ ] **Step 2: Update repository prose**

Replace the five old category display names in README and the listed historical design/plan documents. Preserve technical uses of “数据库” that refer to actual databases.

- [ ] **Step 3: Verify no old display names remain outside the approved mapping spec**

Run from the repository root:

```powershell
rg -n --hidden --glob '!client/node_modules/**' --glob '!**/.git/**' --glob '!docs/superpowers/specs/2026-09-26-knowledge-base-labels-design.md' --glob '!docs/superpowers/plans/2026-09-26-knowledge-base-labels.md' '国标知识库|国标数据库|省标知识库|省标数据库|市标知识库|市标数据库|行业标知识库|企业知识库' .
```

Expected: no output.

- [ ] **Step 4: Commit Analytics and documentation changes**

```powershell
git add analytics/dashboard/public/src/pages/traffic.js README.md docs/superpowers/specs/2026-09-20-knowledge-base-categories-design.md docs/superpowers/specs/2026-09-20-step03-outline-node-knowledge-design.md docs/superpowers/plans/2026-09-22-step03-node-knowledge-selection.md
git commit -m "docs: synchronize knowledge document names"
```

### Task 4: Complete repository verification

**Files:**
- Verify: all files changed in Tasks 1-3

- [ ] **Step 1: Run the focused knowledge-base tests**

Run from `client/`:

```powershell
node --test electron/services/knowledgeBaseStore.categories.test.cjs src/app/menuConfig.test.ts
```

Expected: PASS.

- [ ] **Step 2: Build the client**

Run from `client/`:

```powershell
npm run build
```

Expected: exit code 0. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 3: Inspect the final diff without disturbing unrelated worktree changes**

Run from the repository root:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files from this plan plus the user's pre-existing unrelated changes are present.
