# 技术方案检查设计

## 目标

在客户端新增一级主菜单“技术方案检查”，将 `D:\2026AI\project\bid-Check` 中恢复的投标技术方案检查能力迁移为跨平台 Electron 原生功能，并按照用户提供的原型图还原页面的信息结构。功能不调用旧 EXE、不要求系统安装 Python，也不新增内置离线 OCR 运行库。

## 用户流程

1. 用户从主菜单进入“技术方案检查”。
2. 页面依次选择招标文件、采购需求文件、主观分评分标准和投标技术方案。
3. 选择投标技术方案后，系统在同目录自动建议输出文件名 `<原文件名>检查记录.docx`；用户可通过“另存为”修改位置。
4. 四份输入文件与输出路径齐备后，“开始检查”可用。
5. Electron Main 通过统一任务服务在后台依次解析文件、执行检查规则、生成 Word 检查记录，并向页面推送阶段进度与日志。
6. 检查成功后，“打开检查记录”可用；用户离开页面不会中断当前任务，返回页面或重启应用后可读取最后一次任务状态和日志。应用异常退出时，未完成任务恢复为错误态，用户可重新执行，不自动续跑半成品任务。

## 页面设计

新增 `technical-plan-check` feature 页面。页面保持现有客户端的全局 CSS、Radix 基础组件和中文交互风格，不复制旧桌面程序的灰色控件外观，但保留原型图的结构与操作顺序：

- 页面顶部显示“投标技术方案检查工具”和说明“依据招标文件、采购需求与主观分评分标准，全面检查投标技术方案的响应性与内部质量”。
- “输入文件”面板包含四行文件：招标文件、采购需求文件、主观分评分标准、投标技术方案。每行显示序号、角色、文件名/未选择状态和“浏览”按钮。
- 输出文件行显示自动生成的路径或提示，并提供“另存为”按钮。
- 面板下方提供“开始检查”和“打开检查记录”按钮。
- 下方显示“检查进度”、进度条和可滚动日志区域，按原工具十三个阶段逐项输出。
- 页面根容器使用 `height: 100%`、`min-height: 0`，日志在页面内部滚动。

## 文件支持与解析

- 内容检查接受 DOCX、PDF，以及客户端现有解析链路可转换的 DOC/WPS。
- PDF 先使用现有本地解析器检测并提取文字层；只有本地解析返回 `pdf_text_layer_missing` 时，才根据全局配置回退到 MinerU OCR。这样文本型 PDF 不因配置了 MinerU 而上传。
- 扫描版 PDF 仅在全局 provider 为 `mineru-accurate-api` 或 `mineru-agent-api` 时重试；精准 API 缺少 Token、Agent API 请求失败或未配置 MinerU 时分别返回可操作提示，不静默跳过。
- DOC/WPS 复用现有 Office/LibreOffice 转 DOCX 能力。
- DOCX 投标技术方案直接执行 OOXML 格式检查；DOC/WPS 通过 `withLegacyWordDocxFile()` 在临时 DOCX 回调生命周期内完成格式检查；PDF 记录“已跳过 Word 格式检查”，与旧工具边界一致。
- 新增统一文档适配层，将本地 DOCX、文本 PDF 和 MinerU 产出的 Markdown/HTML 统一转换为恢复规则所需的“段落行 + 表格行”：HTML 表格和 Markdown 表格均转换为单元格以 ` | ` 拼接的行，过滤 Markdown 表头分隔行，剥离其余 Markdown/HTML 标记并保留可见文字。内容规则不得直接依赖某个 parser 的原始输出格式。
- 文件路径只在 Electron Main 与内部 IPC 中使用，不上传到 Analytics。

## Main 架构

新增独立的技术方案检查模块，避免把规则和大段处理逻辑写入 Renderer：

- `technicalPlanCheckStore.cjs`：将四个输入文件、输出路径、检查结果摘要、最后任务和日志索引持久化到 SQLite；输入发生变化时使旧结果失效。
- `technicalPlanCheckService.cjs`：管理文件选择、输出路径、打开结果以及内容解析编排。
- `technicalPlanCheckTask.cjs`：作为 `taskService` runner 执行十三阶段检查，响应取消信号并通过 checkpoint 持久化阶段状态。
- `technicalPlanCheckDocumentAdapter.cjs`：把不同解析器的 Markdown/HTML 结果规范化为恢复规则使用的段落行和 ` | ` 表格行。
- `technicalPlanCheckRules.cjs`：移植恢复源码中的确定性内容规则，包括需求响应、评分覆盖、时间冲突、计算、逻辑矛盾、语言表达和内容相关性。
- `technicalPlanFormatChecks.cjs`：通过 DOCX OOXML 检查字体、字号、缩进、行距、对齐、标题层级、编号、表格/图片居中、章节与评分项对应及英文词项。
- `technicalPlanCheckReport.cjs`：使用项目已有 `docx` 依赖生成检查记录，包括检查结论汇总、需求响应、评分覆盖、格式排版和内部问题明细。
- `technicalPlanCheckIpc.cjs`：只注册和转发选择文件、选择输出路径、读取状态、开始检查和打开报告；任务进度复用统一任务事件。

CPU 密集的全文覆盖率、规则扫描和 OOXML 遍历在 Node `worker_threads` 中运行，Main 只负责文件解析、任务编排、状态 checkpoint 和报告落盘，避免阻塞窗口、IPC 与进度事件。任务取消或应用退出时终止 worker；runner 在取消后不得继续 checkpoint 或替换输出文件。

新增 `technical_plan_check_meta` 和 `technical_plan_check_tasks` 表，并接入现有 `task_logs`、migration、健康检查和根目录 `sql/workspace_schema.sql`。任务类型 `technical-plan-check` 在组内互斥。应用启动时若发现遗留 `running` 状态，将其转为错误态并保留已有日志，不自动恢复执行。

Renderer 挂载顺序遵循现有受管任务协议：先读取技术方案检查 Store 快照，再订阅 `tasks.onTaskEvent()`，随后调用 `tasks.getActiveTasks()` 获取并回放当前任务，弥补快照读取与 listener 注册之间的事件窗口。页面卸载只取消订阅，不取消任务。

IPC 完整链路同时更新：在 `electron/ipc/index.cjs` 装配服务并将依赖数据库的通道加入 `workspaceDatabaseChannels`，在 `electron/preload.cjs` 暴露文件选择、输出选择、读取快照、开始检查和打开报告方法，在 `src/shared/types/ipc.ts` 同步请求、状态和结果类型。运行进度只通过现有 `tasks:event` / `tasks.onTaskEvent()` 推送，不新增第二套 feature 专用进度事件。

## 检查规则

首版以 `bid_checker_core_recovered.py` 和 `bid_format_checks_recovered.py` 的可读恢复实现为行为基线，不把 README 或反汇编中尚未恢复为可执行逻辑的描述自行扩展成新规则：

- 从采购需求中识别强制性或响应性条目，按关键短语和中文二元组覆盖率判断已响应、疑似部分响应和疑似未响应。
- 仅从包含 `|` 的表格文本行中识别数值分值单元格及其前一单元格为评分项，检查技术方案覆盖程度。
- 检查技术方案内部工期、服务期、服务周期、质保期、运维期和运维服务等期限的多口径差异；首版不宣称已完成招标文件期限交叉校验。
- 仅检查可明确解析的 `数字 运算符 数字 = 数字` 算式，运算符限定为 `+、＋、-、－、×、x、X、*`，不包含除法；首版不增加合计或百分比求和规则。
- 逻辑差异仅覆盖恢复代码中的四组关键词：“人员/人手/队伍”“设备/仪器”“村/行政村”“工期/服务期”，并只比较 `人、台、个、天、年、个月` 六种单位。
- 检查模板占位符、连续重复汉字以及中文括号、书名号、方头括号数量不配对；首版不增加乱码检测。
- 仅检查带省、市、县、区、镇、乡、村或街道后缀，在方案中至少出现两次、且未在三份参考文件中出现的地名；首版不增加公司名或项目名规则。
- 对 DOCX/DOC/WPS 检查正文格式、章节与评分项对应、表格和图片居中、自动/手动编号混用及英文词项。

结果统一使用 `severity: info | review | issue`，并按稳定 rule ID 固定映射：

| rule ID | 含义 | severity |
|---|---|---|
| `requirement.partial`、`requirement.missing` | 需求疑似部分响应或未响应 | `review` |
| `requirement.mandatory-number-missing` | 强制性需求中的数值未在方案检出 | `review` |
| `score.partial`、`score.missing` | 评分项覆盖不足或未覆盖 | `review` |
| `time.inconsistent` | 指定期限关键词出现多个口径 | `review` |
| `calculation.mismatch` | 显式二元算式结果错误 | `issue` |
| `logic.inconsistent` | 四组关键词内的同单位数值不一致 | `review` |
| `language.placeholder` | 疑似模板占位符 | `review` |
| `language.repeated-char` | 疑似连续重复汉字 | `review` |
| `language.unbalanced-pair` | 成对符号数量不一致 | `issue` |
| `relevance.place` | 疑似其他项目地名 | `review` |
| `format.alignment`、`format.indent`、`format.spacing`、`format.line-spacing`、`format.grid`、`format.font-size`、`format.font-family` | 固定正文格式属性差异 | `issue` |
| `format.table-center`、`format.image-center` | 表格或图片未显式居中 | `issue` |
| `format.chapter-score` | 评分项未找到明显对应章节 | `review` |
| `format.numbering-mixed`、`format.numbering-manual-styles`、`format.numbering-auto-styles` | 编号类型或样式不统一 | `review` |
| `language.english-unknown`、`language.english-variant` | 疑似英文拼写或大小写不统一 | `review` |
| `check.skipped`、`check.statistics` | 跳过项、统计和方法说明 | `info` |

恢复代码中“强制需求缺失数值”分支会把缺失的需求值误写成“方案中最大值”，首版不保留该明显错误文案：改为 `requirement.mandatory-number-missing`，展示缺失数值并提示人工核实，但保持其启发式 `review` 定位。

OOXML 检查复刻恢复代码的“显式属性”语义，不实现完整 Word 样式级联计算：正文排除标题、题注和列表，要求两端对齐、约两字符首行缩进、段前段后 0、已显式设置时为 1.5 倍行距，同时要求 `snapToGrid` 与 `adjustRightInd` 显式为真；中文正文 run 已显式设置字号时要求 12 pt，已显式设置东亚字体时要求宋体/SimSun。每类最多列出 30 条，超出部分汇总。英文词项使用恢复代码内置技术词集合和三份参考文件中出现的英文词作为已知词；不引入新的在线词典或依赖。

## 导航与埋点

- `SectionId` 新增 `technical-plan-check`。
- `menuConfig.ts` 增加一级菜单“技术方案检查”，放在“已有方案扩写”之后。
- `AppRouter.tsx` 注册检查页面。
- `Sidebar.tsx` 增加对应检查图标映射。
- Analytics Dashboard 路由名称映射增加 `technical-plan-check: 技术方案检查`，保持现有页面访问统计能力。

## 错误处理

- 文件未选择、格式不支持、解析失败、扫描 PDF 缺少 OCR 配置、输出目录不可写和报告生成失败均返回明确中文提示。
- 普通提示、成功和失败使用 `useToast()`；长错误或需要用户操作的说明使用 `AppDialog`。
- 运行中禁止重复开始任务和替换输入文件；当前任务完成或失败后允许重新运行。
- 失败保留已完成阶段日志，便于定位具体文件和检查阶段，但日志不记录文件正文。
- 输出路径不得与任一输入文件相同。报告先写入目标目录下的唯一临时文件，生成并关闭成功后再替换目标文件；失败或取消时清理临时文件，避免留下损坏 DOCX。

## 测试与验证

- 为内容规则、完整 rule ID/severity 映射、格式规则、文档适配层、PDF 本地到 MinerU 回退、Store、IPC 和任务恢复增加定向 Node 测试。
- 文档适配层 fixture 分别覆盖本地 DOCX HTML 表格、文本 PDF Markdown 表格和 MinerU Markdown/HTML 表格，断言三种产物生成一致的段落行与 ` | ` 表格行。
- 使用 `bid-Check/测试文件` 的四份样例建立 golden fixture，固定十三阶段顺序、各类结果条目、上下文和汇总数字；报告测试校验章节、表头和关键文本，而不是只判断文件存在。
- 对新增或修改的 Electron `.cjs` 文件执行 `node --check`。
- 修改 SQLite 后运行相关 `node --test`、`npm run smoke:electron-native`，并同步检查 migration 与 `sql/workspace_schema.sql`。
- 在 `client/` 运行 `npm run build`。
- 启动 `npm run dev`，手动验证四个文件选择、输出另存为、任务进度、离开后返回、报告打开、内部滚动和窄窗口布局。
- 定向测试覆盖：worker 取消后不得 checkpoint 或替换输出、应用退出终止 worker、输出路径等于输入路径时拒绝执行、已有报告替换失败时旧文件保持完整、失败/取消清理临时文件，以及任务记录删除/替换时关联 `task_logs` 正确清理。
- 至少覆盖 Windows 中文路径；跨平台发布前分别执行 `npm run dist:win` 与 `npm run dist:mac`，并验证 macOS 的 DOC/WPS 转换在缺少 LibreOffice 时显示既有安装提示。
- 确认 Analytics 路由映射存在，且没有删除或绕过现有埋点逻辑。

## 非目标

- 不调用、打包或反编译旧 EXE。
- 不要求用户安装 Python，也不打包 Python 解释器。
- 不新增 Tesseract、RapidOCR 或其他大型离线 OCR 依赖。
- 不使用 AI 改写技术方案；本功能只检查并生成报告。
- 不把“技术方案检查”合并到现有“标书检查”二级菜单。
- 不修改当前工作区中与本功能无关的 `client/package.json` 和 `client/package-lock.json` 变更。
