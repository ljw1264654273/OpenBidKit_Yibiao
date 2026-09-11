# Implementation Plan — STEP 01 快速配置前置

> 关联 spec：`docs/superpowers/specs/2026-09-11-step01-quick-bid-config-design.md`
> 关联原型：`docs/design-preview/step01-quick-config-mockup.html`
> 状态：待确认后实施

## 0. 一个必须拍板的决策（先定这个）

前置的"标书篇幅 / 表格密度 / 图片开关"三项，在 STEP 01 写入的是**草稿字段**，还是**直接写正式状态字段**？

两种语义：

| 语义 | 做法 | 代价 | 建议 |
|---|---|---|---|
| **A 直接写正式字段（推荐）** | STEP 01 改动即调 `saveOutlineConfig` / `saveContentGenerationOptions`，写 `outlineWordControlOptions` / `contentGenerationOptions`，后续 STEP 03 / 05 读到同一份值 | 无额外字段；STEP 03 预估页数、STEP 05 开关组天然同步 | ✅ 采用 |
| B 单独草稿字段 | 新增 `preconfigDraft`，STEP 03/05 时才搬运 | 多一套状态 + 搬运逻辑 + 失效链路要重设计 | ❌ 复杂度高、收益低 |

**推荐 A**。理由：
1. `saveOutlineConfig` / `saveContentGenerationOptions` 在 Main 侧**不依赖 `outlineData`**，STEP 01 可直接调用，零前置条件。
2. `saveContentGenerationOptions` 已经会顺带 `contentIllustrationPlan = undefined`——这正好命中 spec 要求"图片配置变更走失效链路，清空全文图片计划"，无需另写失效逻辑。
3. 字数控制是"约束性偏好"而非"一次性快照"；`outlineWordControlSnapshot` 的固化仍只发生在 STEP 03 生成目录那一刻，语义不受影响。

> 若你倾向 B（担心用户提前改了字数又忘），在确认时说明，plan 会加 `preconfigDraft` 字段与搬运步骤。

---

## 1. 目标与非目标

### 目标
在 STEP 01「选择标书」页，上传招标文件后：
1. **立即本地检测标段**（零 Token），有疑似多标段时顶部提示，用户可在此直接进入标段识别/选择。
2. 提供「快速配置」区，承载 4 项**已存在**配置：投标范围、标书篇幅、表格密度、图片开关。

### 非目标（明确不做）
- 不合并步骤，仍是 6 步。
- 不做竞品里的：写作风格 / 风格预设 / 防重检测 / DeepSeek 智能切言。
- 不做「投标公司」结构化字段（当前代码不存在，列入 backlog）。
- 不动 `outlineWordControlSnapshot` 固化机制、不动 `taskService` 恢复逻辑、不动埋点路由中文名。

---

## 2. 改动文件清单

| # | 文件 | 层 | 改动 |
|---|---|---|---|
| 1 | `client/src/shared/types/ipc.ts` | 类型 | `importTenderDocument` 返回值增加 `bidSectionDetection?: { hasMultiple: boolean; totalDeclared: number \| null }` |
| 2 | `client/src/features/technical-plan/types.ts` | 类型 | 新增 `BidSectionDetection` 类型；`TechnicalPlanState` 增加 `bidSectionDetection?: BidSectionDetection` |
| 3 | `client/electron/services/technicalPlanStore.cjs` | Main | `saveTenderMarkdownAndState` 返回增加 `bidSectionDetection`（来自 `detectBidSections(nextMarkdown)`） |
| 4 | `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx` | Renderer | 新增「快速配置」区 + 标段提示条 |
| 5 | `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx` | Renderer | 传参（新增 props）、新增回调（保存字数/表格/图片配置）、`onFileImported` 透传 `bidSectionDetection` |
| 6 | `client/src/features/technical-plan/technical-plan.css` | 样式 | 新增快速配置区 / 标段提示条样式 |

### 复用不改的现有能力
- `BidSectionSelectorDialog`（STEP 02 已在用）——标段提示条「识别标段」按钮复用同一弹窗。
- `window.yibiao.technicalPlan.checkBidSections()`（IPC 已存在，`technical-plan:check-bid-sections`）。
- `window.yibiao.technicalPlan.saveOutlineConfig()` / `saveContentGenerationOptions()`（IPC 已存在）。

---

## 3. 分步实施

### 步骤 1 — 类型层（文件 1、2）

`src/shared/types/ipc.ts` 中 `importTenderDocument` 的返回类型加：

```ts
bidSectionDetection?: {
  hasMultiple: boolean;
  totalDeclared: number | null;
};
```

`types.ts` 新增导出，并挂到 `TechnicalPlanState`：

```ts
export interface BidSectionDetection {
  hasMultiple: boolean;
  totalDeclared: number | null;
}
// TechnicalPlanState 内：
bidSectionDetection?: BidSectionDetection;
```

同时在 `resetState`（TechnicalPlanHome.tsx）补 `bidSectionDetection: undefined`。

### 步骤 2 — Main 侧返回标段检测（文件 3）

`saveTenderMarkdownAndState` 末尾 return 增加：

```js
return {
  success: true,
  message: ...,
  markdown: nextMarkdown,
  bidSectionDetection: detectBidSections(nextMarkdown),
};
```

> `detectBidSections` 已在 `technicalPlanStore.cjs` 顶部 require，直接可用。`nextMarkdown` 是合并后正文，检测的是"当前生效内容"，语义正确。

`removeTenderDocument` 的 `saveTenderMarkdownAndState` 调用同样会带上该字段（无需额外改，因同走一个函数）。

### 步骤 3 — Renderer 状态接线（文件 5）

`TechnicalPlanHome.tsx`：
- `onFileImported` 回调里，把 `nextState.bidSectionDetection` 一起 `setState`（`loadState()` 返回体里是否含该字段需确认——见「风险 1」）。
- 给 `DocumentAnalysisPage` 传新增 props：
  - `bidSectionDetection`（从 `state` 读）
  - `outlineWordControlOptions`、`contentGenerationOptions`
  - `onOutlineConfigChange`（复用现有 `saveOutlineConfig`，但只传 `wordControlOptions`，其余字段取现有 state 值）
  - `onContentGenerationOptionsChange`（复用 `saveContentGenerationOptions`）
  - `onOpenBidSectionSelector`（触发标段识别，复用 STEP 02 的启动逻辑）

### 步骤 4 — 快速配置区 UI（文件 4、6）

在 `DocumentAnalysisPage` 的 `<UploadBoard>` 之后、Markdown 预览之前插入：

```
[标段提示条]（仅 bidSectionDetection.hasMultiple 且未选标段时显示）
  「检测到疑似 N 个标段」+ [识别标段] 按钮
[快速配置区]（仅 tenderFile 存在时显示）
  投标范围  | 标书篇幅  | 表格密度  | 图片开关
```

交互细则（与原型一致）：
- 标段提示条 → 点击「识别标段」→ 复用 `BidSectionSelectorDialog` 流程（STEP 02 同款）。
- 标书篇幅 → 页数阶梯快捷档 + 精确值，写 `outlineWordControlOptions`。
- 表格密度 → 无/少量/适中/丰富，写 `contentGenerationOptions.tableRequirement`。
- 图片开关 → AI 图 / Mermaid / HTML 三开关摘要，写 `contentGenerationOptions` 对应字段。

---

## 4. 风险与待确认

### 风险 1 — `loadState()` 是否返回 `bidSectionDetection`
`onFileImported` 里 `nextState` 来自 `loadState()`（非导入返回值），而 `bidSectionDetection` 是导入函数的临时返回，**不落库**。因此：
- 方案：`bidSectionDetection` 只作为**导入那一刻的即时提示**，不持久化到 `TechnicalPlanState`。`onFileImported` 直接把 `result.bidSectionDetection` 单独传给 `DocumentAnalysisPage` 的局部 state（或一个独立 prop），刷新/重进页面后提示消失（因为那时用户已进入 STEP 02，标段判定由 STEP 02 承担）。
- 更稳做法：`DocumentAnalysisPage` 内部在 `importTenderDocument` 成功后直接 `setBidSectionDetection(result.bidSectionDetection)`，**完全不用** `TechnicalPlanState` 承载。**采用此方案**，可删除步骤 1 里 `TechnicalPlanState` 加字段的动作。

> 最终决策：`bidSectionDetection` 走 `DocumentAnalysisPage` 本地 state，不进 `TechnicalPlanState`、不落库。这进一步缩小改动面。

### 风险 2 — 字数阶梯与 STEP 03 预估页数的换算常量
前置的"页数阶梯"要和 STEP 03 现有预估页数用**同一套换算**（字/页）。实施时定位 STEP 03 的换算函数，抽为共享常量，避免两处口径不一致。若 STEP 03 已有共享换算则直接引用。

### 风险 3 — 图片/表格配置的失效链路
`saveContentGenerationOptions` 已含 `contentIllustrationPlan = undefined`。STEP 01 改动图片开关时，若此时已有配图计划（正常不会，因为配图在 STEP 04/05 才生成），会清空。**这是预期行为**，但需在代码注释里说明"STEP 01 修改图片配置即触发配图计划失效"。

---

## 5. 验收清单

- [ ] STEP 01 上传多标段招标文件 → 顶部出现标段提示，可点「识别标段」进入选择弹窗
- [ ] 上传单标段文件 → 无提示，正常进入下一步
- [ ] 快速配置区四项均可编辑，值能正确写入并回显
- [ ] STEP 02 里标段模式与 STEP 01 已选标段一致（切换页面后不丢失）
- [ ] STEP 03 预估页数反映 STEP 01 设的字数（换算一致）
- [ ] STEP 05 图片/表格开关反映 STEP 01 设置
- [ ] 已有方案扩写入口（`existing-plan-expansion`）行为不受影响
- [ ] `npm run build` 通过

---

## 6. 执行顺序建议

1. 步骤 1+2（类型 + Main 返回，最小可验证）→ 先跑一次 build 确认类型通过
2. 步骤 3（状态接线）
3. 步骤 4（UI + 样式）
4. 按验收清单手动验证
