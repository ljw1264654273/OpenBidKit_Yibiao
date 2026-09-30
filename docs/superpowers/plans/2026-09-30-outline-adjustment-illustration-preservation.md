# 目录调整后保留正文与图片审核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手工及 AI 目录调整仅使真正受影响的正文分支和图片审核项失效，并完整保留、重映射其他正文、审核状态和图片资源。

**Architecture:** 用独立纯函数模块把 AI 调整结果转换为现有 `saveOutline` 协议，并严格校验 `origin_id`；用另一纯函数模块计算图片项的保留、重映射和失效原因。`technicalPlanStore` 仍是持久化权威，在同一事务内重建目录正文状态、重写图片计划、移除孤儿图片块并返回完整状态；`outlineAdjustmentTask` 只负责把 Agent 结果分类后转发并 checkpoint Store 的真实结果。

**Tech Stack:** Electron CommonJS、better-sqlite3、Node `node:test`、React/TypeScript、Vite。

---

## 文件结构

- Create: `client/electron/services/outlineAdjustmentDiff.cjs` — 校验 Agent 节点身份，计算 `reason`、`idMap` 和受影响分支闭包。
- Create: `client/electron/services/outlineAdjustmentDiff.test.cjs` — 纯函数身份校验和差异分类测试。
- Create: `client/electron/services/technicalPlanIllustrationReconciliation.cjs` — 纯函数判断图片项是否可重映射保留，并移除正文标记块。
- Create: `client/electron/services/technicalPlanIllustrationReconciliation.test.cjs` — 单节、多节、孤儿块和结构变化测试。
- Create: `client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs` — Electron native 持久层集成回归测试。
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs` — working Schema 要求 `origin_id`。
- Modify: `client/electron/services/outlineAdjustmentTask.cjs` — 调用差异分类器，以 `sort/edit` 保存并转发真实 Store patch。
- Modify: `client/electron/services/outlineAdjustmentTask.test.cjs` — AI 调整保存协议和 checkpoint 测试。
- Modify: `client/electron/services/outlineAdjustmentTask.baselineValidation.test.cjs` — 非法身份验证测试。
- Modify: `client/electron/services/technicalPlanStore.cjs` — 权威评分映射、图片计划局部重映射、资源清理和完整返回契约。
- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs` — AI 显式评分映射测试。
- Create: `client/src/features/technical-plan/services/outlineStateSync.test.ts` — Renderer 对完整返回 patch 的独立静态回归断言，不依赖已有失败套件。

实施前先运行 `git status --short` 保存初始工作区清单。当前共享工作区已有用户修改，尤其不要修改或整文件暂存 `TechnicalPlanHome.tsx`；若后续确实必须触碰已有脏文件，应先停下说明重叠，使用交互式/补丁式暂存并逐块检查，不能把用户改动带入任务提交。

### Task 1: AI 目录节点身份校验与差异分类

**Files:**
- Create: `client/electron/services/outlineAdjustmentDiff.cjs`
- Create: `client/electron/services/outlineAdjustmentDiff.test.cjs`
- Modify: `client/electron/services/outlineGenerationTaskV2.cjs:60-98`

- [ ] **Step 1: 写身份校验和差异分类失败测试**

测试公开 API：

```js
const { buildOutlineAdjustmentSaveRequest } = require('./outlineAdjustmentDiff.cjs');

test('纯重新排序分类为 sort 并建立双射 idMap', () => {
  const result = buildOutlineAdjustmentSaveRequest({ before: workingBefore, after: reorderedAfter });
  assert.equal(result.reason, 'sort');
  assert.deepEqual(result.idMap, { '1': '2', '1.1': '2.1', '2': '1', '2.1': '1.1' });
  assert.deepEqual(result.affectedNodeIds, []);
});

test('修改父节点使旧分支全部后代失效', () => {
  const result = buildOutlineAdjustmentSaveRequest({ before: workingBefore, after: renamedParentAfter });
  assert.equal(result.reason, 'edit');
  assert.deepEqual(result.affectedNodeIds.sort(), ['1', '1.1', '1.2']);
});

for (const candidate of [missingOrigin, duplicateOrigin, forgedExistingOrigin, invalidNewOrigin]) {
  assert.throws(() => buildOutlineAdjustmentSaveRequest({ before: workingBefore, after: candidate }), /origin_id|节点身份/);
}
```

同时在 `outlineAdjustmentTask.baselineValidation.test.cjs` 使用项目现有 AJV 测试方式直接验证 `OUTLINE_WORKING_JSON_SCHEMA`：根节点或嵌套节点缺少 `origin_id` 时 Schema 校验失败。这个断言必须在修改 Schema 前呈 RED，避免差异分类器的运行时校验掩盖 Schema 漏洞。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
cd client
node --test electron/services/outlineAdjustmentDiff.test.cjs
node --test electron/services/outlineAdjustmentTask.baselineValidation.test.cjs
```

Expected: 第一个命令因差异分类模块/API 尚不存在而 FAIL；第二个命令必须明确因新增的根节点/嵌套节点缺少 `origin_id` 的 Schema 断言而 FAIL。检查这两个 RED 原因后才能修改实现或 Schema。

- [ ] **Step 3: 实现最小差异分类器**

模块导出：

```js
function buildOutlineAdjustmentSaveRequest({ before, after }) {
  // flatten by origin_id; validate required/unique namespaces;
  // compare semantic fingerprint and parent origin;
  // expand changed/deleted existing nodes through old descendant closure;
  // build old id -> new id map;
  // return sort only for a bijective identity-preserving reorder.
  return { reason, idMap: Object.fromEntries(idMap), affectedNodeIds: [...affectedIds] };
}

module.exports = { buildOutlineAdjustmentSaveRequest, validateOutlineOrigins };
```

语义指纹包含 `title`、`description`、根节点 `attr`、叶节点 `content_mode/content_mode_note`、父 `origin_id` 和叶/父形态。

- [ ] **Step 4: 修改 working Schema 强制要求身份**

把 `createDirectoryNodeSchema()` 的 required 构造改为：

```js
const baseRequired = [
  'id',
  'title',
  'description',
  ...(root ? ['attr'] : []),
  ...(working ? ['origin_id'] : []),
];
```

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/outlineAdjustmentDiff.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```powershell
git add client/electron/services/outlineAdjustmentDiff.cjs client/electron/services/outlineAdjustmentDiff.test.cjs client/electron/services/outlineGenerationTaskV2.cjs client/electron/services/outlineAdjustmentTask.baselineValidation.test.cjs
git diff --cached --name-only
git diff --cached
git commit -m "fix: classify outline adjustment changes"
```

### Task 2: 图片计划重映射纯逻辑

**Files:**
- Create: `client/electron/services/technicalPlanIllustrationReconciliation.cjs`
- Create: `client/electron/services/technicalPlanIllustrationReconciliation.test.cjs`

- [ ] **Step 1: 写图片保留和失效失败测试**

覆盖：单章节 ID 重映射保留；受影响章节失效；跨章节 HTML 仍同父连续且目标不变时保留；跨父、不连续、逆序、目标变化时失效；`before/after` 的孤儿块均可从旧目标正文移除。

核心断言示例：

```js
const result = reconcileIllustrationItems({
  items: [confirmedItem],
  previousOutline,
  nextOutline,
  idMap: new Map([['1.1', '2.1']]),
  affectedIds: new Set(),
});
assert.deepEqual(result.keptItems[0].section_ids, ['2.1']);
assert.deepEqual(result.droppedItems, []);

const cleaned = removeIllustrationBlock(content, 'html-1');
assert.doesNotMatch(cleaned, /yibiao-illustration:start id="html-1"/);
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/technicalPlanIllustrationReconciliation.test.cjs`

Expected: FAIL，因为模块不存在。

- [ ] **Step 3: 实现最小纯函数模块**

导出：

```js
function reconcileIllustrationItems({ items, previousOutline, nextOutline, idMap, affectedIds }) {
  return { keptItems, droppedItems };
}

function removeIllustrationBlock(content, itemId) {
  // marker block exists: remove and normalize surrounding blank lines;
  // not found: return original content without throwing.
}

function getIllustrationTargetNodeId(item) {
  return item.kind === 'html' && item.placement === 'before'
    ? item.section_ids?.[0]
    : item.section_ids?.at(-1);
}
```

多章节校验通过目录扁平信息比较直接父 ID、兄弟索引连续性和 section 顺序。持久目录不含 `origin_id`，目标身份用“旧目标节点确实存活，且 `idMap.get(oldTargetId) === newTargetId`”判定；不能只比较复用后的数字 ID。补充“旧节点删除后无关新节点占用相同数字 ID”测试，确保不会误认成原目标。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `cd client; node --test electron/services/technicalPlanIllustrationReconciliation.test.cjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/technicalPlanIllustrationReconciliation.cjs client/electron/services/technicalPlanIllustrationReconciliation.test.cjs
git diff --cached --name-only
git diff --cached
git commit -m "fix: reconcile illustration plans after outline changes"
```

### Task 3: Store 局部持久化、孤儿块与资源清理

**Files:**
- Create: `client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs:527-569,1618-1706,2550-2690,3013-3092`
- Modify: `client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs:91-149`

- [ ] **Step 1: 写 Electron native Store 失败测试**

用真实临时 SQLite 和文件目录建立两个正文叶子、各自图片审核项、确认图片块、重绘候选及 HTML 源文件，然后保存仅影响一个分支的目录变化。除 AI 叶子编辑外，必须包含手工父目录改名只传父 ID 的场景，并断言 Store 自行扩展旧分支后代闭包，清除后代正文、plans 和图片。基本断言：

```js
assert.equal(saved.contentGenerationSections['2'].status, 'success');
assert.equal(saved.contentGenerationSections['1'], undefined);
assert.deepEqual(saved.contentIllustrationPlan.items.map((item) => item.item_id), ['keep-2']);
assert.equal(saved.contentIllustrationPlan.items[0].generation.redraw_asset_url, keepCandidateUrl);
assert.doesNotMatch(saved.outlineData.outline[0].content || '', /drop-1/);
assert.equal(fs.existsSync(droppedHtmlPath), false);
assert.equal(fs.existsSync(keptHtmlPath), true);
```

另写多章节 `before/after`、全部删除后显式 `undefined`、重启后审核字段仍存在的测试。再写 sort 集成测试：排序后一个多章节项变得不连续而失效，一个单章节项保留；正文任务/runtime 仍存在；返回的 `outlineData` 从数据库重载并含保留正文。如果失效图片块从正文移除，断言 `onContentChanged` 在提交后收到对应节点 ID。

- [ ] **Step 2: 扩展评分覆盖失败测试**

给 `sort` 和 `edit` 显式传入已验证 `scoreCoverageMap`，断言保存结果与输入深等，不走手工启发式重写。

- [ ] **Step 3: 运行测试确认 RED**

Run: `cd client; node --test electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs`

Expected: FAIL，当前非 sort 路径全量清空图片计划，且显式 edit map 被忽略。

- [ ] **Step 4: 使显式评分映射优先**

`updateScoreCoverageForOutlineSave()` 首行改为：

```js
if (suppliedCoverageMap !== undefined) return suppliedCoverageMap;
if (reason === 'replace') return undefined;
```

保留无显式映射时的手工增删改逻辑。

- [ ] **Step 5: 在 Store 内扩展手工受影响分支闭包**

在读取 `previousOutline` 后，将请求里的每个非 sort `affectedNodeIds` 按旧目录展开为“节点自身 + 全部后代”，再把该闭包传给正文、plans、评分启发式和图片 reconciliation。`replace` 仍由 `clearAll` 处理，`sort` 不扩展。

- [ ] **Step 6: 按 replace/sort/edit 三条路径接入图片计划重映射**

保存前捕获旧图片计划，并显式重构控制流：

- `replace`：保存新目录，清空所有正文状态和图片计划，保持原行为。
- `sort`：先 `saveSortedOutline()`，随后对图片计划做结构重校验和孤儿块处理；不提前 return，不删除 content task/runtime/Mermaid 缓存。
- `edit`：重建正文状态和 plans 后，执行图片重映射及局部失效。

reconciliation 调用形态：

```js
const reconciliation = reconcileIllustrationItems({
  items: previousIllustrationPlan?.items || [],
  previousOutline,
  nextOutline: outlineToSave,
  idMap,
  affectedIds,
});
replaceContentIllustrationPlan(
  reconciliation.keptItems.length
    ? { ...previousIllustrationPlan, items: reconciliation.keptItems }
    : undefined,
);
```

对 dropped item：从旧目标仍被保留的正文删除 marker block；收集 URL和三个 source path，在事务提交后做引用感知清理。若实际修改了正文，事务提交后以真实节点 ID调用 `onContentChanged`。所有路径结束前从数据库重新 `loadOutlineData()` 赋给 `savedOutlineData`，确保 AI sort 输入本身没有 content 时，返回值仍包含持久正文。

- [ ] **Step 7: 实现受管 HTML 源文件安全清理**

去重待清理相对路径，逐一解析成绝对路径，只有最终路径严格位于 `illustrationsDir` 内才可处理。事务成功后查询剩余计划行的 SQL 列 `generation_source_path`、`generation_original_source_path`、`generation_redraw_source_path`，三个列均无引用时才调用 `removeWorkspacePathSync()`；目录外路径原样保留。

资源测试必须分别覆盖：current/original/redraw 三个无引用 HTML 源均删除；被另一个保留项共享的源文件保留；目录外路径不处理；图片 URL仍被其他计划项或正文引用时文件保留。

- [ ] **Step 8: 完整返回持久状态**

`saveOutline()` 返回：

```js
return {
  outlineData: savedOutlineData,
  outlineGenerationTask,
  contentGenerationSections: loadContentSections(savedOutlineData),
  contentGenerationPlans: loadContentPlans(),
  contentIllustrationPlan: loadContentIllustrationPlan(),
  contentGenerationTask: loadTask('content-generation'),
  contentGenerationRuntime: safeJsonParse(readMetaRow().content_generation_runtime_json, undefined),
};
```

确保对象始终自有 `contentIllustrationPlan` 字段，值可为 `undefined`。

- [ ] **Step 9: 运行 Store 测试确认 GREEN**

Run: `cd client; node --test electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/technicalPlanStore.contentGenerationOptions.test.cjs electron/services/technicalPlanStore.nodeKnowledge.test.cjs`

Expected: 全部 PASS。

- [ ] **Step 10: 提交**

```powershell
git add client/electron/services/technicalPlanStore.cjs client/electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs client/electron/services/technicalPlanStore.scoreCoverageMap.test.cjs
git diff --cached --name-only
git diff --cached
git commit -m "fix: preserve unaffected illustration reviews"
```

### Task 4: AI 调整任务接入局部保存协议

**Files:**
- Modify: `client/electron/services/outlineAdjustmentTask.cjs:135-280`
- Modify: `client/electron/services/outlineAdjustmentTask.test.cjs`

- [ ] **Step 1: 写 AI 调整任务失败测试**

测试 Agent 只改一个节点时，mock Store 收到：

```js
assert.equal(saveRequest.reason, 'edit');
assert.deepEqual(saveRequest.idMap, expectedIdMap);
assert.deepEqual(saveRequest.affectedNodeIds, ['1.1']);
assert.equal(saveRequest.scoreCoverageMap, validatedCoverageMap);
assert.deepEqual(finalPatch.contentGenerationSections, saved.contentGenerationSections);
assert.deepEqual(finalPatch.contentIllustrationPlan, saved.contentIllustrationPlan);
```

另测纯排序收到 `reason: 'sort'`，checkpoint 保留 content task/runtime。

- [ ] **Step 2: 运行测试确认 RED**

Run: `cd client; node --test electron/services/outlineAdjustmentTask.test.cjs`

Expected: FAIL，当前固定 `replace` 并固定下发空状态。

- [ ] **Step 3: 接入差异分类器并使用 Store 真实 patch**

在 strip 内部字段前计算：

```js
const saveRequest = buildOutlineAdjustmentSaveRequest({
  before: workingOutline,
  after: adjustedOutline,
});
const saved = workspaceStore.saveOutline({
  outlineData: { ...stripOutlineInternalFields(adjustedOutline), project_name, project_overview },
  ...saveRequest,
  scoreCoverageMap: adjustedCoverageMap,
});
```

checkpoint 的 `technicalPlanPatch` 从 `saved` 明确选择 outline、task、sections、plans、illustration plan 和 runtime，不再写死空值。

- [ ] **Step 4: 运行任务测试确认 GREEN**

Run: `cd client; node --test electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```powershell
git add client/electron/services/outlineAdjustmentTask.cjs client/electron/services/outlineAdjustmentTask.test.cjs
git diff --cached --name-only
git diff --cached
git commit -m "fix: preserve outline adjustment state"
```

### Task 5: Renderer 同步回归与最终验证

**Files:**
- Create: `client/src/features/technical-plan/services/outlineStateSync.test.ts`
- Read-only verify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`

- [ ] **Step 1: 写 Renderer 状态同步失败测试**

在独立测试文件读取 `TechnicalPlanHome.tsx`，静态断言 `saveOutline` 能合并 Store 返回的 `contentGenerationSections/contentGenerationPlans/contentIllustrationPlan`；outline-adjustment 事件分支使用 `hasOwnField` 接受显式 `undefined`。不修改或复用已有失败的 `outlineSourceMatcher.test.ts`。

- [ ] **Step 2: 运行测试确认 RED 或确认现有合并已满足契约**

Run: `cd client; node --experimental-strip-types --test src/features/technical-plan/services/outlineStateSync.test.ts`

如果当前 Renderer 因 Store 新返回契约直接满足断言，则保留该测试，不修改已经处于脏状态的 `TechnicalPlanHome.tsx`。如果测试暴露真实同步缺口，由于该文件已有用户改动，先停止并报告重叠，不能直接整文件修改或暂存。

- [ ] **Step 3: 运行所有相关测试**

Run:

```powershell
cd client
node --test electron/services/outlineAdjustmentDiff.test.cjs electron/services/technicalPlanIllustrationReconciliation.test.cjs electron/services/outlineAdjustmentTask.test.cjs electron/services/outlineAdjustmentTask.baselineValidation.test.cjs electron/services/technicalPlanStore.outlineIllustrationPreservation.test.cjs electron/services/technicalPlanStore.scoreCoverageMap.test.cjs electron/services/technicalPlanStore.contentGenerationOptions.test.cjs electron/services/technicalPlanStore.nodeKnowledge.test.cjs
node --experimental-strip-types --test src/features/technical-plan/services/outlineStateSync.test.ts
```

Expected: 0 failures。

- [ ] **Step 4: 检查 Main 语法**

Run:

```powershell
cd client
node --check electron/services/outlineAdjustmentDiff.cjs
node --check electron/services/technicalPlanIllustrationReconciliation.cjs
node --check electron/services/outlineAdjustmentTask.cjs
node --check electron/services/technicalPlanStore.cjs
```

Expected: 全部退出 0，无输出。

- [ ] **Step 5: 验证 native 模块和客户端构建**

Run:

```powershell
cd client
npm run smoke:electron-native
npm run build
```

Expected: 两个命令退出 0；Vite 既有 chunk 体积警告可接受。

- [ ] **Step 6: 检查最终 diff 和工作区边界**

Run:

```powershell
git status --short
git diff --check 507abbf..HEAD -- client/electron/services client/src/features/technical-plan/services
git diff --stat 507abbf..HEAD -- client/electron/services client/src/features/technical-plan/services
```

Expected: 任务提交范围无空白错误；对照实施前保存的 status，没有暂存或覆盖用户现有的中文排版等无关改动；没有 Analytics、数据库 schema 或 UI 样式变化。

- [ ] **Step 7: 提交 Renderer 测试或最小同步修正**

```powershell
git add client/src/features/technical-plan/services/outlineStateSync.test.ts
git diff --cached --name-only
git diff --cached
git commit -m "test: cover outline preservation state sync"
```
