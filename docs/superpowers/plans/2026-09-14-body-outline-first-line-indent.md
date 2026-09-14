# 正文层次首行缩进设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为模板设置中的四个正文层次增加独立的“首行缩进（字符）”，并让配置在实时预览、模板持久化和 Word 导出中生效。

**Architecture:** 复用现有 `body_text.body_outline_levels` 配置数组，在每个 `BodyOutlineLevelConfig` 中增加 `first_line_indent_chars`。Renderer 负责编辑状态、CSS 变量和预览；Main 负责旧配置规范化以及将正文层次缩进写入有序列表项段落的 `firstLine`，保留现有编号层级 `left/hanging`。

**Tech Stack:** React + TypeScript、全局 CSS、Electron CommonJS services、`docx`、Node built-in test、AdmZip。

---

## 文件范围

- 修改 `client/src/shared/types/exportFormat.ts`
  - 扩展 `BodyOutlineLevelConfig`。
  - 为四个默认正文层次增加 `first_line_indent_chars: 0`。
- 修改 `client/src/features/export-format/pages/ExportFormatPage.tsx`
  - 在每个正文层次卡片中增加数字输入。
  - 复用现有 `updateBodyOutlineLevel` 更新当前层次。
- 修改 `client/src/shared/utils/exportFormatCss.ts`
  - 生成四个正文层次首行缩进 CSS 变量。
  - 第五层自动回退使用 0，不生成独立配置变量。
- 修改 `client/src/styles/feature-export-format.css`
  - 为模板设置预览中四个有序列表层级的列表项和直接正文段落应用对应首行缩进。
  - 显式重置嵌套列表和第五层回退的缩进，保持编号伪元素 `text-indent: 0`。
  - 将正文层次设置网格从三列调整为适配四个控件，并同步更新移动端断点布局。
- 修改 `client/src/styles/shared-markdown.css`
  - 同步 Markdown 预览中正文层次缩进规则，避免不同预览入口表现不一致。
- 修改 `client/electron/services/configStore.cjs`
  - 更新默认正文层次配置。
  - 规范化旧配置缺失字段为 0，并保留显式 0。
- 修改 `client/electron/resources/default-export-template.json`
  - 为内置导出模板的四个正文层次补充 0 值字段。
- 修改 `client/electron/services/exportService.cjs`
  - 兼容旧正文层次配置。
  - 在有序列表项段落上按层次字号增加 `firstLine`。
  - 保持既有编号层级 `left/hanging` 和普通正文全局缩进行为。
- 修改 `client/electron/services/configStore.bodyOutline.test.cjs`
  - 覆盖默认 0 值、显式值保留、旧配置兼容。
- 修改 `client/electron/services/exportService.bodyOutline.test.cjs`
  - 覆盖四层差异化导出、第五层回退、普通正文隔离、编号缩进保留。

### Task 1: 先建立配置规范化的失败测试

**Files:**
- Modify: `client/electron/services/configStore.bodyOutline.test.cjs`

- [ ] **Step 1: 扩展默认值断言**

在现有“缺少正文层次排版配置”测试中，除 `font`/`size` 外同时断言四层的 `first_line_indent_chars` 全部为 `0`。

- [ ] **Step 2: 增加显式值保留测试**

写入四层分别为 `0`、`0.5`、`1`、`2` 的 `body_outline_levels`，加载配置后断言这四个数值原样保留，尤其确认显式 `0` 没有被默认值覆盖。

- [ ] **Step 3: 运行配置测试确认当前实现失败**

Run:

```powershell
cd client
node --test electron/services/configStore.bodyOutline.test.cjs
```

Expected: 新增的缩进断言失败，因为当前默认层次对象和规范化结果尚未包含 `first_line_indent_chars`。

### Task 2: 建立 Word 导出的失败回归测试

**Files:**
- Modify: `client/electron/services/exportService.bodyOutline.test.cjs`

- [ ] **Step 1: 增加四层独立缩进测试**

构造四层配置，统一使用“小四”字号，缩进分别为 `0`、`0.5`、`1`、`2`，导出四层有序正文。解析：

- `word/document.xml`：断言对应列表项段落的 `w:firstLine` 分别为 `0`（无属性）、`120`、`240`、`480` twips。
- `word/numbering.xml`：断言四个编号层级仍保留原有 `w:left` 和 `w:hanging`，没有被首行缩进替换。

- [ ] **Step 2: 增加第五层和旧配置断言**

扩展第五层测试，确认第五层自动回退正文不包含独立 `w:firstLine`。扩展旧模板兼容测试，确认缺少 `first_line_indent_chars` 时导出的列表项不带额外首行缩进。

- [ ] **Step 3: 运行定向导出测试确认当前实现失败**

Run:

```powershell
cd client
node --test electron/services/exportService.bodyOutline.test.cjs
```

Expected: 新增的 `w:firstLine` 断言失败，因为当前导出服务没有读取正文层次首行缩进。

### Task 3: 实现共享配置模型和 Renderer 默认值

**Files:**
- Modify: `client/src/shared/types/exportFormat.ts`
- Modify: `client/electron/services/configStore.cjs`
- Modify: `client/electron/resources/default-export-template.json`

- [ ] **Step 1: 扩展 TypeScript 配置类型**

在 `BodyOutlineLevelConfig` 增加 `first_line_indent_chars: number`。

- [ ] **Step 2: 更新 Renderer 默认层次**

为 `DEFAULT_BODY_OUTLINE_LEVELS` 的四层增加 `first_line_indent_chars: 0`。普通正文 `body_text.first_line_indent_chars` 保持现有默认值和含义不变。

- [ ] **Step 3: 更新 Main 默认层次和规范化**

在 `configStore.cjs` 的默认层次数组中增加 0，并在 `bodyOutlineLevels` 映射中读取 `sourceLevel.first_line_indent_chars`。使用 `typeof ... === 'number'` 判断，确保显式 0 保留，字段缺失回退默认 0。

- [ ] **Step 4: 更新内置模板资源**

在 `default-export-template.json` 的四个 `body_outline_levels` 对象中增加 `first_line_indent_chars: 0`，不改变模板文件版本。

- [ ] **Step 5: 运行配置测试确认通过**

Run:

```powershell
cd client
node --test electron/services/configStore.bodyOutline.test.cjs
```

Expected: PASS。

### Task 4: 实现正文层次设置界面

**Files:**
- Modify: `client/src/features/export-format/pages/ExportFormatPage.tsx`
- Modify: `client/src/styles/feature-export-format.css`

- [ ] **Step 1: 增加层次输入控件**

在每个正文层次卡片的编号样式、字体、字号网格中增加：

```tsx
<label>
  <span>首行缩进（字符）</span>
  <input
    type="number"
    min={0}
    max={10}
    step={0.5}
    value={level.first_line_indent_chars}
    onChange={(event) => updateBodyOutlineLevel(index, {
      first_line_indent_chars: Number(event.target.value),
    })}
  />
</label>
```

- [ ] **Step 2: 保持旧模板加载兼容**

确认 `withExportFormatDefaults()` 通过更新后的 `DEFAULT_BODY_OUTLINE_LEVELS` 为缺少新字段的旧模板补 0；不在组件中复制 Main 侧规范化逻辑。

- [ ] **Step 3: 构建 Renderer 类型**

Run:

```powershell
cd client
npm run build
```

Expected: `tsc --noEmit` 和 Vite 构建退出码均为 0；若出现既有 chunk 体积警告，不作为失败。

- [ ] **Step 4: 调整正文层次控件网格**

将 `.export-body-outline-level-grid` 的桌面列定义调整为四列，并让 `max-width: 760px`、`max-width: 520px` 两个断点分别按四列、两列、单列重新排布，确保新增输入在桌面和窄窗口均不溢出、不产生隐式列。

### Task 5: 接入预览 CSS

**Files:**
- Modify: `client/src/shared/utils/exportFormatCss.ts`
- Modify: `client/src/styles/feature-export-format.css`
- Modify: `client/src/styles/shared-markdown.css`

- [ ] **Step 1: 生成四层 CSS 变量**

在 `buildExportFormatCssVars()` 中为四层生成 `--ef-body-outline-N-indent`，值为 `${first_line_indent_chars}em`，缺失或第五层回退使用 `0`。变量基准由对应层次列表项自身字号决定。

- [ ] **Step 2: 应用四层列表项首行缩进**

为模板预览和 Markdown 预览增加四层具体选择器：

- `ol > li` 使用层次 1。
- `ol > li > ol > li` 使用层次 2。
- 依次到层次 4。

对列表项直接正文段落同步设置相同 `text-indent`，编号伪元素继续显式设置 `text-indent: 0`。

- [ ] **Step 3: 显式处理嵌套和第五层**

嵌套 `ol` 设置 `text-indent: 0`，第五层列表项及其直接正文段落设置 `text-indent: 0`，避免继承上一层缩进。

- [ ] **Step 4: 运行 Renderer 构建**

Run:

```powershell
cd client
npm run build
```

Expected: PASS。

### Task 6: 接入 Word 导出

**Files:**
- Modify: `client/electron/services/exportService.cjs`

- [ ] **Step 1: 兼容层次配置**

在 `getBodyOutlineLevels()` 中将每层的 `first_line_indent_chars` 读入返回对象，缺失时为 `0`。保留现有五层返回结构，第五层继续由 fallback 生成且缩进为 0。

- [ ] **Step 2: 计算当前列表层次的首行缩进**

在 `buildListParagraphOptions()` 中，对有序、非任务列表项，根据 `reference` 和 `listLevel` 取得当前 `outlineLevel`。使用该层字号转换为 Word half-points，再调用现有 `charsToTwips()`。

- [ ] **Step 3: 把首行缩进写入列表项段落**

当缩进大于 0 时，在列表项的首个正文段落选项中设置：

```js
paragraphOptions.indent = {
  firstLine: charsToTwips(
    outlineLevel.first_line_indent_chars,
    chineseSizeToHalfPt(outlineLevel.size || '小四'),
  ),
};
```

不要修改 `createListNumberingLevel()` 返回的 `left/hanging`，不要把普通正文 `context.bodyIndent` 复用到有序正文层次。

- [ ] **Step 4: 运行导出测试确认通过**

Run:

```powershell
cd client
node --test electron/services/exportService.bodyOutline.test.cjs
```

Expected: PASS，四层 `firstLine`、第五层回退、旧配置和普通正文隔离断言均通过。

- [ ] **Step 5: 检查 Main 文件语法**

Run:

```powershell
cd client
node --check electron/services/exportService.cjs
node --check electron/services/configStore.cjs
```

Expected: 两个文件均无语法错误。

### Task 7: 完整验证和交付检查

**Files:**
- Test: `client/electron/services/configStore.bodyOutline.test.cjs`
- Test: `client/electron/services/exportService.bodyOutline.test.cjs`
- Build: `client/package.json`

- [ ] **Step 1: 运行全部本次定向测试**

Run:

```powershell
cd client
node --test electron/services/configStore.bodyOutline.test.cjs electron/services/exportService.bodyOutline.test.cjs
```

Expected: 所有测试通过。

- [ ] **Step 2: 运行客户端构建**

Run:

```powershell
cd client
npm run build
```

Expected: 退出码为 0。

- [ ] **Step 3: 检查差异范围**

Run:

```powershell
git status --short
git diff --check
```

确认只包含本功能涉及的配置、界面、预览、导出、测试和规格/计划文档，不修改 Analytics。

- [ ] **Step 4: 手动检查模板页面**

运行 `npm run dev`，打开模板设置的“正文样式”，确认四个正文层次均显示“首行缩进（字符）”，默认值为 0；修改任一层次后右侧预览立即变化，编号标记位置保持稳定；保存后重新编辑模板，数值仍然保留。
