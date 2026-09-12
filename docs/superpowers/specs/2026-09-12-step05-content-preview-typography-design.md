# 第五步正文预览字体一致性设计

## 背景

第五步“正文生成”页面的正文预览中，普通正文与编号列表中的部分文字粗细不一致，部分加粗引导语在中文字体下显得过重。用户截图显示，正文阅读区域需要保持统一的正文字体体系，同时继续保留 Markdown 的加粗语义。

本次范围限定为第五步页面内的正文预览：

- 包括普通查看、编辑后预览和全屏预览。
- 不修改 SQLite 中保存的 Markdown 正文。
- 不修改正文生成 Prompt。
- 不修改 Word 导出链路及 Word 文件的实际样式。
- 不修改标题、表格、图片和其他功能页面的共享视觉规则，除非共享选择器会直接影响本预览且能以限定作用域修复。

## 当前链路与问题判断

第五步页面在 `ContentEditPage.tsx` 中使用：

1. `MarkdownContent` 调用共享 `MarkdownRenderer` 将 Markdown 转换为 React 节点。
2. 查看、编辑预览和全屏预览均使用 `markdown-viewer content-generation-output export-format-preview`。
3. `buildExportFormatCssVars(exportFormat)` 将导出格式配置写入预览容器的 CSS 自定义属性。
4. `shared-markdown.css` 根据正文层级为段落、列表和有序列表编号设置字体、字号和行高。

当前有序列表的各层级字体设置在列表容器和编号伪元素上，但正文中的 `<strong>/<b>` 没有在正文预览作用域内明确声明字体、字号和字重。浏览器默认的 `font-weight: bolder` 可能在中文字体上触发较重的合成粗体；当加粗文本位于有序列表层级中时，列表层级字体和默认粗体行为叠加，造成截图中“部分字体突然变粗”的观感。

该判断需要通过回归样式断言和本地浏览器截图验证，不以截图单独作为根因证明。

## 设计

### 1. 预览 typography 统一规则

在第五步预览专用的 `.technical-plan-content-preview` 作用域内：

- 普通段落显式使用 `--ef-body-font`、`--ef-body-size`、`--ef-body-line-height`。
- 无序列表和列表项显式继承正文的字体、字号和行高。
- 有序列表及其嵌套层级继续使用现有 `--ef-body-outline-N-*` 字体和字号。
- 有序列表项显式继承对应列表层级的字体和字号，避免子节点回退到浏览器默认值。
- 不改变现有对齐、缩进、间距、编号样式和 Markdown 语义。

### 2. 加粗文本规则

在 `.technical-plan-content-preview` 作用域内为正文段落和列表中的 `strong/b` 添加显式规则：

- 普通段落中的 `strong/b` 使用 `--ef-body-font`、`--ef-body-size`，固定 `font-weight: 600`。
- 无序列表中的 `strong/b` 使用 `--ef-body-font`、`--ef-body-size`，固定 `font-weight: 600`。
- 有序列表各层级中的 `strong/b` 使用该层级已有的 `--ef-body-outline-N-font`、`--ef-body-outline-N-size`，固定 `font-weight: 600`。
- 不对 `h1-h6`、`table/th/td`、`.markdown-figure-caption` 及图片说明中的 `strong/b` 应用第五步正文强调规则；这些节点继续使用各自已有的标题、表格和图片说明规则。
- 不使用浏览器相对值 `bolder`，不改变 Markdown 中 `**`/`__` 的语义。
- 不把所有正文改为粗体，也不删除 Markdown 中的 `**` 标记。

`font-weight: 600` 是本次规范的固定值；若当前平台或字体没有对应字重，浏览器选择最近可用字重属于平台渲染差异，但不能回退到 `bolder` 或 `700` 的 CSS 规则。

### 3. 作用域

第五步预览在 `ContentEditPage.tsx` 的普通查看、编辑后预览和全屏预览节点上统一增加独立 class `technical-plan-content-preview`。新增规则放在 `client/src/styles/feature-technical-plan.css`，并以该 class 为根作用域，避免影响 `feasibility-report/pages/ContentPage.tsx` 同样使用的 `export-format-preview`。

只补充第五步需要的 typography 规则，不复制完整 Markdown 排版规则。现有共享的编号、间距、图片和表格规则继续生效；新增第五步选择器在 CSS 总入口中位于共享 Markdown 样式之后，因此可以对第五步进行精确覆盖。普通段落和无序列表遵循 `--ef-body-*`；有序列表各层级内部与对应的 `--ef-body-outline-N-*` 保持一致，这是“字体一致”在存在用户自定义层级字体/字号时的明确含义。

## 验证

### 自动化验证

在现有 `client/src/features/technical-plan/services/workflowLayout.test.ts` 中增加源码级回归断言，确保：

- 普通查看、编辑后预览和全屏预览都使用独立的第五步预览 class。
- 第五步样式显式声明正文、无序列表和有序列表的 typography。
- `strong/b` 只在第五步正文段落和列表作用域内使用固定 `font-weight: 600`，并使用对应正文层级字体/字号。
- 选择器使用 `p:not(.markdown-figure-caption)` 等边界，确保标题、表格和图片说明不被第五步正文强调规则覆盖。
- 可行性报告仍使用原有通用预览 class，不被第五步独立 class 误匹配。

按仓库约定执行：

```powershell
cd client
npm exec -- tsx --test src/features/technical-plan/services/workflowLayout.test.ts
npm run build
```

`tsx` 已由客户端锁文件提供，使用 `npm exec -- tsx --test` 执行 TypeScript `node:test` 文件；若安装环境缺失该锁定工具，应先按仓库约定执行 `npm ci`，不得把未执行的测试描述为已通过。

### 视觉验证

启动客户端开发环境，在第五步正文预览中检查以下内容：

1. 普通段落与无序列表遵循统一的正文字体、字号和行高；有序列表的每一层正文与该层级配置的字体、字号和行高一致，列表中的加粗引导语只增加固定的 `600` 字重。
2. `**引导语：**` 仍然可辨识，但不会比截图中的现状明显厚重。
3. 一级到至少四级有序列表的正文和编号均使用对应层级样式。
4. 查看模式、编辑后预览和全屏预览保持一致。
5. 普通段落、表格、图片说明和可行性报告等非第五步 Markdown 页面没有明显回归。

## 不在本次范围

- 不调整默认导出格式配置。
- 不改 `exportService.cjs`。
- 不改变生成内容格式协议或 Prompt。
- 不清理历史正文中的 Markdown 标记。
- 不将正文中的所有强调文本强制还原为普通字重。
