# STEP 05 正文 AI 改写与光标插图设计

## 1. 背景

技术方案 STEP 05“正文生成”当前支持按目录小节查看正文，并在进入编辑状态后使用 Markdown 编辑器手工修改、预览和保存当前小节。现有能力还有两个相邻但不同的 AI 入口：

- 目录树“已生成”状态悬停后显示的“AI改写”，实际是按用户要求重新生成整个小节；
- 正文生成完成后的全文图片计划与统一图片审核，面向自动编排的 AI 配图、流程图和 PPT 图。

本次需求是在当前小节的手工编辑过程中增加更细粒度的 AI 辅助编辑：

1. 没有选中文字时，从当前光标位置续写；
2. 选中文字时，仅改写该选区；
3. 在当前光标位置插入普通 AI 配图、本地图片或剪贴板图片；
4. 所有 AI 结果先预览，由用户确认后进入当前草稿，不直接覆盖已保存正文。

本设计只覆盖技术方案与已有方案扩写共用的 STEP 05 页面，不改变整节重新生成、全文自动配图和图片审核的现有行为。

## 2. 可行性结论

功能可行，且不需要改变正文权威存储结构或新增 SQLite 表。

现有基础可以直接复用：

- `MarkdownEditor` 底层使用原生 `textarea`，可稳定读取字符级 `selectionStart` 和 `selectionEnd`；
- 当前编辑正文保存在 `ContentEditPage` 的 `draftContent`，适合作为 AI 候选应用前的唯一未保存草稿；
- 正文权威内容已经统一保存在 `technical_plan_outline_nodes.content`；
- `saveChapterContent()` 已负责更新章节正文、正文状态并使旧全文图片计划失效；
- `aiService.cjs` 已提供文本模型队列、图片模型队列、取消、重试、日志、Token 统计和 `generateImage()`；
- `yibiao-asset://generated-images/...` 与 `yibiao-asset://imported-images/...` 已支持 Renderer 本地预览和 Word 导出。

主要新增内容：

- Markdown 编辑器光标与选区状态上报；
- “AI改写”智能菜单和右侧候选抽屉；
- Main 侧局部正文 AI 编辑服务；
- 普通 AI 配图、本地图片导入和剪贴板图片导入协议；
- 手工插入图片的独立 Markdown 保护块。

## 3. 目标

1. 在 STEP 05 当前小节进入编辑状态后，于“预览”按钮旁增加“AI改写”按钮。
2. 根据当前光标或选区智能提供：
   - 改写选中内容；
   - 从光标处续写；
   - 在光标处插入图片。
3. 选区改写只替换选中字符，选区之外正文保持不变。
4. 续写只在光标位置插入新内容，不重写原文。
5. 图片支持：
   - 普通 AI 配图；
   - 本地文件选择；
   - 拖入本地图片；
   - 剪贴板粘贴图片。
6. 文本和图片候选都必须先预览，用户点击“应用到草稿”后才修改 `draftContent`。
7. 应用候选后仍需点击页面原有“保存”，才写入 SQLite。
8. AI 请求期间正文继续发生变化时，不允许把过期候选错位应用。
9. 保持普通技术方案与已有方案扩写两个入口行为一致。

## 4. 非目标

第一版不包含：

1. 替换现有 Markdown 编辑器为富文本或所见即所得编辑器；
2. 多章节批量改写；
3. 整节重新生成逻辑改造；
4. AI 操作历史长期持久化；
5. 跨页面、应用重启后继续运行的后台改写任务；
6. 在即时插图入口生成 Mermaid 流程图或 PPT 图；
7. 对手工插图提供现有统一图片审核弹窗中的完整重绘、确认和候选采用流程；
8. 修改全文自动配图计划、三类内部图片 `kind` 或既有图片审核协议；
9. 新增数据库表或 migration。

## 5. 已确认的交互方案

采用“顶部智能菜单 + 右侧候选抽屉”。

### 5.1 入口

- “AI改写”按钮只在当前叶子小节已进入编辑状态时显示；
- 按钮位于“预览”旁边；
- 正文处于预览模式时按钮禁用，提示“请先切换到编辑”；
- 正文生成任务处于 `running`、`pausing` 或 `paused` 时，沿用现有编辑锁定，按钮禁用；
- 普通编辑器与全屏编辑器使用同一份光标/选区状态；
- 全屏编辑工具栏增加同一“AI改写”入口，避免全屏 Dialog 遮挡页面顶部按钮后无法操作。

### 5.2 智能菜单

菜单固定包含三项：

1. **改写选中内容**
2. **从光标处续写**
3. **在光标处插入图片**

可用规则：

- 有非空选区时，“改写选中内容”为首项和默认突出操作；
- 无选区时，“改写选中内容”禁用，“从光标处续写”为默认突出操作；
- “从光标处续写”和“在光标处插入图片”始终使用当前活动编辑面的光标位置；
- 存在选区时执行插图，默认锚定在选区末尾，不删除选区文字；
- 光标或选区无法取得时禁用菜单，并提示用户先点击正文编辑区。

### 5.3 右侧候选抽屉

抽屉覆盖在正文工作区右侧，不改变左侧目录宽度，不依赖 `body` 滚动。

抽屉包含：

- 当前操作名称；
- 当前章节标题；
- 光标位置或选区摘要；
- 用户指令输入；
- 常用快捷要求；
- 生成按钮及加载状态；
- 文本修改前后对比或图片预览；
- “重新生成”“放弃”“应用到草稿”操作；
- 当前操作的错误提示及重试入口。

关闭抽屉不改变正文草稿。存在已生成但未应用的候选时，关闭操作使用现有 `AppDialog` 确认是否放弃。

## 6. 编辑器选择状态

### 6.1 共享类型

建议增加共享类型：

```ts
type MarkdownEditorSurface = 'inline' | 'fullscreen';

interface MarkdownEditorSelection {
  start: number;
  end: number;
  selectedText: string;
  surface: MarkdownEditorSurface;
  scrollTop: number;
}
```

### 6.2 `MarkdownEditor` 扩展

`MarkdownEditor` 增加可选能力，不改变其他页面默认行为：

```ts
interface MarkdownEditorProps {
  // 现有字段保持不变
  onSelectionChange?: (selection: MarkdownEditorSelection) => void;
  selectionRequest?: {
    start: number;
    end: number;
    surface?: MarkdownEditorSurface;
    requestId: string;
  };
  toolbarEnd?: ReactNode;
}
```

行为规则：

- 普通和全屏 `textarea` 的 `select`、`keyup`、`mouseup`、`focus` 事件更新选择状态；
- 文本输入后重新读取当前范围，避免仅依赖旧事件；
- `toolbarEnd` 用于在全屏工具栏放置同一个 AI 入口，不在共享编辑器内硬编码 AI 业务；
- `selectionRequest` 用于应用候选后恢复焦点、设置新光标或重新选中结果；
- 现有加粗、斜体等工具栏按钮行为保持不变；
- 没有传入新属性的现有页面不受影响。

### 6.3 请求快照

每次发起 AI 操作时保存：

```ts
interface ContentAiEditSnapshot {
  nodeId: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  selectedText: string;
  surface: MarkdownEditorSurface;
  createdAt: string;
}
```

候选应用前必须同时满足：

- 当前仍是同一 `nodeId`；
- 当前 `draftContent` 与快照 `content` 完全一致；
- 范围仍在字符串长度内；
- 选区改写时，快照范围内文字仍等于 `selectedText`。

任一条件不满足时拒绝应用，提示：

> 正文已发生变化，请重新选择位置并生成。

不得把结果静默追加到末尾，也不得尝试模糊查找相似文本。

## 7. 文本操作规则

### 7.1 选区改写

输入：

- 项目 ID；
- 节点 ID、章节标题和描述；
- 当前完整草稿；
- `selectionStart` / `selectionEnd`；
- 选中文字；
- 选区前后必要上下文；
- 用户改写要求。

快捷要求：

- 更专业；
- 扩写；
- 更简洁；
- 增强可执行性。

Main 返回结构化候选：

```ts
interface ContentAiTextCandidate {
  mode: 'rewrite';
  replacementText: string;
}
```

规则：

- 模型只返回替换文本，不返回完整章节；
- 不返回 Markdown 代码围栏；
- 不自动添加章节标题；
- 保留选区中的必要项目事实、数字、对象名称和承诺边界；
- 不创造上下文没有提供的企业资质、人员姓名、证书编号或确定性事实；
- 抽屉展示原文与候选文本；
- “应用到草稿”仅替换 `[selectionStart, selectionEnd)`。

若选区与任何受保护图片块相交，则不发起模型请求，提示：

> 请选择不包含图片的纯正文内容。

### 7.2 光标续写

输入与选区改写相同，但 `selectionStart === selectionEnd`，并补充：

- 光标前文；
- 光标后文；
- 用户希望续写的方向或内容。

Main 返回：

```ts
interface ContentAiTextCandidate {
  mode: 'continue';
  insertionText: string;
}
```

规则：

- 模型只返回新增正文；
- 不复述光标前文；
- 不改写光标后文；
- 根据光标两侧 Markdown 结构保持段落或列表语法合理；
- Renderer 在插入前统一整理边界换行，避免正文粘连或产生四个以上连续换行；
- 应用后光标移动到新增内容末尾。

### 7.3 文本候选预览

- 候选生成后不改变 `draftContent`；
- 用户可以修改指令并重新生成；
- 第一版不直接提供候选文本二次手工编辑框，正文应用后仍可在主编辑器修改；
- 应用成功后保存一份仅存在于当前组件内存中的撤销记录；
- Toast 显示“已应用到草稿”，并提供一次“撤销本次应用”；
- 新的手工输入或下一次候选应用后，旧撤销记录失效；
- 点击页面原有“取消”仍恢复进入编辑前的已保存正文。

## 8. 图片操作规则

### 8.1 图片来源

抽屉提供三个来源页签：

1. **AI 生成**
2. **本地图片**
3. **剪贴板图片**

本地图片同时支持：

- 文件选择；
- 拖放到上传区。

剪贴板图片通过抽屉内粘贴事件读取。没有图片数据时不拦截普通文本粘贴。

### 8.2 第一版图片类型

“AI 生成”第一版只生成普通 AI 配图，不提供即时流程图或 PPT 图。

输入包括：

- 图片标题；
- 图片描述；
- 当前章节标题、描述；
- 当前完整草稿；
- 光标附近正文；
- 可选风格要求。

调用现有 `aiService.generateImage()`。图片模型不可用时：

- 禁用“AI 生成”提交按钮；
- 显示现有图片模型可用性提示；
- 本地图片和剪贴板图片保持可用。

### 8.3 图片资产

候选图片必须先保存为本地文件，不允许把以下地址写入正文：

- `blob:...`
- `data:...`
- `file://...`

推荐统一保存到当前项目技术方案目录下的手工插图候选目录，并使用包含 UUID 的相对路径，避免项目间同名冲突。返回正文可用的：

```text
yibiao-asset://generated-images/technical-plan/illustrations/<revision-or-scope>/<uuid>.<ext>
```

项目级路径继续由现有 `resolveYibiaoAssetPath()`、项目 technical-plan 目录和 Word 导出参数解析。

支持格式：

- PNG；
- JPG / JPEG；
- WebP。

剪贴板图片统一保存为 PNG。文件读写显式使用 Windows 中文路径可用的本地绝对路径与二进制 Buffer，不经 Renderer 直接访问 `fs`。

### 8.4 图片候选生命周期

- AI 生成、本地选择或粘贴后，先返回候选资源 URL 和候选 ID；
- 用户未点击“应用到草稿”前，候选不是正文引用资源；
- 用户重新选择、重新生成或明确放弃时，Main 删除该未应用候选；
- 抽屉意外关闭时通过放弃确认清理候选；
- 应用后不立即删除资源，因为草稿已经引用；
- 页面点击“取消”或章节切换导致草稿放弃时，Renderer 调用候选释放接口；Main 仅删除确定未被已保存正文或当前草稿采用的候选；
- 应用启动时可以清理超过约定时限且没有正文引用的遗留候选，但不得扩大现有 `generated-images` 清理范围。

为避免 Renderer 猜测本地路径，候选清理通过候选 ID 完成。

### 8.5 手工图片保护块

手工插图不使用全文自动配图的 `yibiao-illustration` 标记，避免后续全文图片计划失效、重新编排或重放时被误删。

新增独立块：

```md
<!-- yibiao-inline-image:start id="<uuid>" -->
![项目实施阶段示意图](yibiao-asset://generated-images/technical-plan/illustrations/<scope>/<uuid>.png)

*<!-- yibiao-figure-caption -->项目实施阶段示意图*
<!-- yibiao-inline-image:end -->
```

规则：

- 图题必填，默认取用户填写的图片标题或本地文件名去扩展名；
- 图注默认与图题一致，允许用户在应用前修改；
- 图片块前后保留独立段落换行；
- 应用位置是光标位置；有选区时使用选区末尾；
- 图片块视为不可拆分的原子内容；
- 局部 AI 改写、项目查重段落替换和其他正文局部替换必须保留完整图片块；
- Word 导出继续读取标准 Markdown 图片和现有 `yibiao-figure-caption` 标记；
- 后续全文自动配图只处理 `yibiao-illustration`，不得删除 `yibiao-inline-image`。

## 9. Renderer 组件设计

### 9.1 `ContentAiRewriteMenu`

位置：

```text
client/src/features/technical-plan/components/ContentAiRewriteMenu.tsx
```

职责：

- 渲染“AI改写”按钮；
- 展示三项智能菜单；
- 根据选择状态和任务锁显示启用、禁用及帮助文案；
- 支持键盘打开、方向键选择、Enter 执行和 Escape 关闭；
- 不保存候选和草稿。

### 9.2 `ContentAiRewriteDrawer`

位置：

```text
client/src/features/technical-plan/components/ContentAiRewriteDrawer.tsx
```

职责：

- 管理当前操作模式；
- 展示选区或光标上下文；
- 输入用户要求；
- 管理文本请求和图片请求状态；
- 展示文本前后对比或图片预览；
- 本地文件选择、拖放、剪贴板粘贴；
- 提交“重新生成”“放弃”“应用到草稿”；
- 显示操作级错误；
- 请求运行期间禁用重复提交。

抽屉使用 Radix Dialog/现有 Dialog 视觉约定，背景遮罩不能阻止用户阅读当前正文上下文；布局作为正文工作区右侧覆盖层实现，不修改全局页面滚动。

### 9.3 `ContentEditPage`

新增状态建议：

```ts
const [editorSelection, setEditorSelection] = useState<MarkdownEditorSelection | null>(null);
const [aiEditMode, setAiEditMode] = useState<ContentAiEditMode | null>(null);
const [aiEditSnapshot, setAiEditSnapshot] = useState<ContentAiEditSnapshot | null>(null);
const [aiCandidate, setAiCandidate] = useState<ContentAiCandidate | null>(null);
const [aiCandidateBusy, setAiCandidateBusy] = useState(false);
const [lastAppliedEdit, setLastAppliedEdit] = useState<ContentAiAppliedEdit | null>(null);
```

职责：

- 将 `MarkdownEditor` 选择状态传给菜单；
- 打开抽屉时创建快照；
- 调用 preload API；
- 在应用候选前验证快照；
- 精确修改 `draftContent`；
- 请求编辑器恢复光标或选区；
- 章节变化、退出编辑、切换预览或取消编辑时清理抽屉状态和未应用图片候选；
- 继续使用现有 `saveEditingContent()` 与 `onContentSaved()`。

## 10. Main 服务设计

新增：

```text
client/electron/services/contentAiEditService.cjs
```

服务建议由 `ipc/index.cjs` 装配：

```js
createContentAiEditService({
  app,
  aiService,
  bidProjectManager,
});
```

职责：

1. 构建局部改写和续写 Prompt；
2. 调用 `aiService.collectJsonResponse()` 获取结构化文本候选；
3. 调用 `aiService.generateImage()` 获取普通 AI 配图；
4. 将 AI 图片、本地文件或 data URL 复制为项目级候选资源；
5. 构建标准 `yibiao-inline-image` Markdown；
6. 清理明确放弃的未应用候选；
7. 返回候选内容，不直接写 Store。

Prompt 放在该业务服务或同目录专用 Prompt 文件中，不放入 React 组件。

文本请求日志标题需要包含操作类型和节点 ID，但不得记录正文原文或用户指令到普通 Analytics。开发者日志遵循现有 AI 日志规则。

## 11. IPC 与类型协议

### 11.1 新增通道

建议新增：

```text
technical-plan:ai-edit-content
technical-plan:generate-inline-image
technical-plan:import-inline-image
technical-plan:release-inline-image-candidate
```

四个通道加入 `workspaceDatabaseChannels`，确保项目数据库未就绪时使用统一 pending/unavailable handler。

### 11.2 Preload API

```ts
technicalPlan: {
  aiEditContent(payload: ContentAiEditRequest): Promise<ContentAiTextCandidate>;
  generateInlineImage(payload: GenerateInlineImageRequest): Promise<InlineImageCandidate>;
  importInlineImage(payload: ImportInlineImageRequest): Promise<InlineImageCandidate>;
  releaseInlineImageCandidate(payload: ReleaseInlineImageCandidateRequest): Promise<{ success: boolean }>;
}
```

### 11.3 请求类型

```ts
type ContentAiEditMode = 'rewrite' | 'continue';

interface ContentAiEditRequest {
  projectId?: string;
  nodeId: string;
  nodeTitle: string;
  nodeDescription?: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  instruction: string;
}

interface GenerateInlineImageRequest {
  projectId?: string;
  nodeId: string;
  nodeTitle: string;
  nodeDescription?: string;
  content: string;
  insertionOffset: number;
  imageTitle: string;
  imageDescription: string;
  style?: string;
}

interface ImportInlineImageRequest {
  projectId?: string;
  source: {
    filePath?: string;
    dataUrl?: string;
  };
  imageTitle: string;
  caption?: string;
}

interface InlineImageCandidate {
  candidateId: string;
  assetUrl: string;
  imageTitle: string;
  caption: string;
  markdown: string;
}
```

Renderer、preload、IPC 和 service 位于本机可信边界，不在每一层重复同一套参数校验。Main 服务只处理业务所需的输入边界和文件可读性。

## 12. 精确文本应用工具

为避免把字符编辑逻辑散落在页面中，新增 Renderer 纯函数模块，例如：

```text
client/src/features/technical-plan/services/contentAiEdit.ts
```

包括：

- `createContentAiEditSnapshot()`；
- `validateContentAiEditSnapshot()`；
- `applyContentAiTextCandidate()`；
- `insertInlineImageBlock()`；
- `findProtectedInlineImageRanges()`；
- `selectionIntersectsProtectedRange()`；
- `normalizeInsertionBoundaries()`。

已知字符范围由 Renderer 纯函数处理，不调用 Main 的模糊文本替换工具。Main 的 `electron/utils/textEdit.cjs` 仍供 Main 已有未知位置或已知范围场景使用，不需要为本次草稿状态跨进程来回替换。

## 13. 运行状态与错误处理

### 13.1 请求并发

- 一个抽屉同一时间只允许一个请求；
- 生成按钮进入加载状态并禁用；
- 每次请求分配 Renderer `requestId`；
- 用户关闭、切换章节或重新发起请求后，迟到结果按 `requestId` 忽略；
- 第一版不新增跨 IPC 取消通道；关闭抽屉不应用迟到结果；
- AI 请求仍受现有 `aiService` 队列约束。

### 13.2 常见错误

| 场景 | 处理 |
|---|---|
| 未选择叶子小节 | 沿用现有提示，不打开菜单 |
| 当前不是编辑模式 | 提示先进入编辑或从预览切回编辑 |
| 没有有效光标 | 提示先点击正文编辑区 |
| 选区跨越图片保护块 | 拒绝请求，提示选择纯正文 |
| 文本模型失败 | 抽屉内显示错误和重试，草稿不变 |
| 图片模型不可用 | 禁用 AI 生图，本地与粘贴仍可用 |
| 本地文件不可读或格式不支持 | 显示具体文件错误，保留抽屉 |
| 请求期间草稿变化 | 候选可查看但不能应用，提示重新生成 |
| 图片候选放弃 | 调用释放接口，失败仅写日志并显示可重试提示 |
| 保存章节失败 | 沿用现有 Toast；草稿和已应用图片块保持在编辑器中 |

## 14. 数据和状态影响

### 14.1 SQLite

不新增表或列。

用户点击页面“保存”后，继续调用：

```text
technical-plan:save-chapter-content
```

现有 `technicalPlanStore.saveChapterContent()`：

- 写入 `technical_plan_outline_nodes.content`；
- 更新 `technical_plan_content_sections` 状态；
- 清空旧 `contentIllustrationPlan`。

此行为保持不变，符合“手工正文变化后全文图片计划失效”的现有协议。

### 14.2 自动配图兼容

- 手工图片已经成为正文内容的一部分；
- 后续重新执行正文生成或整节重新生成时，是否保留手工图片遵循现有“重新生成正文会替换小节内容”的语义，不额外承诺保留；
- 仅重新执行全文自动配图时，必须保留 `yibiao-inline-image` 块；
- 自动配图的 `stripGeneratedIllustrationsFromDocument()` 只能删除 `yibiao-illustration`，不能扩大匹配到手工图片块。

### 14.3 查重兼容

项目级正文查重和替换当前已经保护 `yibiao-illustration` 块。本次需把 `yibiao-inline-image` 纳入同类保护：

- 提取正文段落时忽略整个手工图片块；
- 替换重复正文时保留同一原始段落内的完整手工图片块；
- 查找不到唯一目标段落时继续拒绝静默替换。

## 15. 用户可见文案

核心文案：

- 按钮：`AI改写`
- 菜单：
  - `改写选中内容`
  - `从光标处续写`
  - `在光标处插入图片`
- 抽屉标题：
  - `AI 改写`
  - `AI 续写`
  - `插入图片`
- 操作：
  - `生成改写预览`
  - `生成续写预览`
  - `生成图片`
  - `重新生成`
  - `放弃`
  - `应用到草稿`
- 成功 Toast：
  - `已应用到草稿`
  - `图片已插入草稿`
- 冲突：
  - `正文已发生变化，请重新选择位置并生成`

所有失败提示需要说明恢复方式，不使用 `alert`、`window.confirm` 或 `window.prompt`。

## 16. Analytics

新增或扩展 Renderer 操作埋点，建议记录：

- `content_ai_edit_action`: `rewrite` / `continue` / `insert_image`
- `content_ai_image_source`: `ai` / `file` / `drop` / `clipboard`
- `content_ai_edit_result`: `started` / `succeeded` / `failed` / `applied` / `discarded`
- 耗时区间；
- 候选是否重新生成。

不得上传：

- 章节正文；
- 选中文字；
- 用户指令；
- 模型响应；
- 图片内容；
- 文件名；
- 本地路径；
- API Key。

现有埋点失败继续静默，不影响编辑流程。若沿用已有事件而不新增 Worker 字段，则不需要修改 Analytics Worker 或 Dashboard；如实现时新增在线协议字段，需同步检查两端并等价保留统计能力。

## 17. 代码改动范围

### Renderer

- `client/src/shared/ui/MarkdownEditor.tsx`
  - 增加可选选择状态和工具栏扩展能力。
- `client/src/features/technical-plan/components/ContentAiRewriteMenu.tsx`
  - 新增智能菜单。
- `client/src/features/technical-plan/components/ContentAiRewriteDrawer.tsx`
  - 新增候选抽屉。
- `client/src/features/technical-plan/pages/ContentEditPage.tsx`
  - 接入选择状态、请求和候选应用。
- `client/src/features/technical-plan/services/contentAiEdit.ts`
  - 新增精确范围纯函数。
- `client/src/styles/feature-technical-plan.css`
  - 增加按钮、菜单、抽屉、对比和上传区样式。
- `client/src/shared/types/ipc.ts`
  - 增加协议类型。
- `client/src/shared/analytics/analytics.ts`
  - 增加脱敏操作统计。

### Electron Main / preload

- `client/electron/services/contentAiEditService.cjs`
  - 新增局部正文与手工插图业务服务。
- `client/electron/ipc/technicalPlanIpc.cjs`
  - 注册四个通道。
- `client/electron/ipc/index.cjs`
  - 装配服务，并加入数据库生命周期通道。
- `client/electron/preload.cjs`
  - 暴露 API。
- 与查重图片块保护相关的现有工具或服务
  - 增加 `yibiao-inline-image` 原子块兼容。

不修改：

- SQLite schema；
- `sql/workspace_schema.sql`；
- 正文任务恢复协议；
- 全文图片审核数据模型。

## 18. 测试设计

### 18.1 Renderer 纯函数

覆盖：

1. 开头、中间、末尾续写；
2. 空正文续写；
3. 中文、多行 Markdown、列表中的插入边界；
4. 精确选区替换；
5. 草稿快照冲突；
6. 节点切换冲突；
7. 手工图片块范围识别；
8. 选区跨越图片块时拒绝；
9. 图片块插入和图注转义；
10. 应用后光标范围计算；
11. 一次撤销。

### 18.2 `MarkdownEditor`

覆盖或通过页面结构测试确认：

1. 普通编辑器选择状态上报；
2. 全屏编辑器选择状态上报；
3. 普通与全屏共用 `value`；
4. `selectionRequest` 恢复正确焦点和范围；
5. 未传新属性时现有工具栏不变；
6. disabled 时不触发 AI 操作。

### 18.3 Main 服务

新增定向测试：

- 改写 Prompt 只要求局部替换；
- 续写 Prompt 只要求新增正文；
- 结构化结果归一化和无效结果报错；
- AI 生图返回本地 `asset_url`；
- 本地图片和 data URL 导入；
- 中文路径图片复制；
- 不支持格式报错；
- 候选 ID 与资源释放；
- 构建 `yibiao-inline-image` 块；
- 放弃候选不删除已采用或被正文引用的图片。

### 18.4 协议与回归

- preload API 与 TypeScript 类型一致；
- 四个 IPC 注册且加入 workspace database lifecycle；
- STEP 05 页面存在“AI改写”入口和任务锁；
- 现有整节“AI改写”入口继续存在且语义不变；
- 全文图片审核测试继续通过；
- 项目查重保护自动图片块和手工图片块；
- 普通技术方案和已有方案扩写共用页面均可调用。

## 19. 验证命令

最低验证：

```powershell
cd client
node --check electron\preload.cjs
node --check electron\ipc\technicalPlanIpc.cjs
node --check electron\services\contentAiEditService.cjs
node --test electron\services\contentAiEditService.test.cjs
node --test electron\ipc\bidProjectIpc.test.cjs
node --test src\features\technical-plan\services\contentAiEdit.test.ts
node --test src\features\technical-plan\services\workflowLayout.test.ts
npm run build
```

涉及项目级本地资源和 Electron native Store 时补充：

```powershell
npm run smoke:electron-native
```

手动使用 `npm run dev` 验证：

1. 普通编辑器和全屏编辑器的光标、选区与菜单状态；
2. 正文首部、中间、末尾续写；
3. 选区专业化、扩写、缩写与自定义指令；
4. AI 请求期间继续输入后禁止过期应用；
5. AI 图片生成、文件选择、拖放与 Ctrl+V；
6. 未应用图片候选取消后的清理；
7. 应用、撤销、页面取消和页面保存；
8. 保存后重新进入项目，正文与图片存在；
9. Word 导出包含图片和图注且不依赖外网；
10. running、pausing、paused 时入口禁用；
11. 全文自动配图不会移除手工图片块；
12. 项目正文查重和替换不会拆坏手工图片块；
13. 普通技术方案和已有方案扩写入口行为一致。

## 20. 实施阶段

### 阶段一：编辑器与本地草稿能力

- 扩展 `MarkdownEditor`；
- 新增智能菜单和候选抽屉壳；
- 实现精确范围、保护块和撤销纯函数；
- 不接模型。

### 阶段二：文本 AI

- 新增 Main 服务和文本 IPC；
- 接入选区改写与光标续写；
- 完成快照冲突、重试和候选对比。

### 阶段三：图片

- 接入普通 AI 生图；
- 接入文件选择、拖放和剪贴板；
- 完成项目级候选资源、手工图片块和释放协议。

### 阶段四：兼容与验收

- 查重图片块保护；
- Word 导出验证；
- 全文自动配图兼容；
- 两种工作流入口联调；
- 构建、定向测试和 Electron 手动验证。

## 21. 验收标准

功能完成必须满足：

1. 用户在 STEP 05 编辑当前叶子小节时，可以从“预览”旁打开“AI改写”；
2. 有选区时能只改写选中正文，无选区时能从光标续写；
3. AI 结果不会自动写入草稿或已保存正文；
4. 用户明确点击“应用到草稿”后才发生字符级插入或替换；
5. 草稿变化后旧候选不能错位应用；
6. 普通 AI 配图、本地选择、拖放和剪贴板图片都能预览后插入；
7. 正文中只保存本地 `yibiao-asset` URL；
8. 手工图片在预览、保存、重启和 Word 导出后仍可用；
9. 全文自动配图和项目查重不会误删或拆坏手工图片块；
10. 正文生成任务锁、现有整节重新生成和图片审核功能无回归；
11. 普通技术方案与已有方案扩写均通过验证；
12. `npm run build` 成功，定向测试通过。

