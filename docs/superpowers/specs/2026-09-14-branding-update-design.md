# 园测投标工具箱品牌替换设计

## 目标

将客户端的用户可见品牌统一为“园测 投标工具箱”，并使用用户提供的 Logo 图片替换现有界面与 Electron 应用图标。删除旧的 `client/assets/icon_256.png`，避免界面继续引用旧 Logo 源文件。

## 范围

### 品牌资源

- 将用户提供的 PNG 图片（当前附件路径：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-544d69b7-3b8d-4411-a7cf-f882d97b022d.png`）复制为 `client/assets/brand-logo.png`，作为 Renderer 界面 Logo 和图标生成的正式源资源。
- 由该源资源生成或更新 `client/assets/icon.ico`，供 Windows 窗口和 electron-builder 使用。
- macOS CI 的 `Generate macOS icon` 步骤改为从 `assets/brand-logo.png` 生成 `assets/icon.icns`，确保 Windows、macOS、侧边栏和窗口图标使用同一 Logo。
- 删除 `client/assets/icon_256.png`。
- 现有 `icon_16.png`、`icon_24.png`、`icon_32.png`、`icon_48.png`、`icon_64.png`、`icon_128.png` 和 `yibiao_256.ico` 本次不作为运行时入口；除非验证发现它们被其他流程引用，否则不在本次需求中扩展清理范围。
- 不改变 Logo 图形本身；保留图片比例，并继续使用现有 Logo 容器的紧凑尺寸。

### Renderer 界面

- `Sidebar` 改用 `brand-logo.png`。
- 展开侧边栏显示两行品牌文字：“园测”和“投标工具箱”。
- 收起侧边栏仅显示 Logo。
- 不改变现有导航、侧边栏宽度、折叠行为和业务功能。

### Electron 与打包

- 将 `client/index.html` 的页面标题、Electron 主窗口标题、preload 暴露的 `appName` 和 `client/package.json` 的 `build.productName` 统一为“园测 投标工具箱”。
- 更新 macOS DMG 使用说明中的应用名称和路径示例。
- 更新 `.github/workflows/release.yml` 中 Windows MSI 的显式 `-c.productName=OpenBidKit_Yibiao` 覆盖，使其与 `build.productName` 一致。
- 保留 `build.appId`、更新服务识别规则、产物文件的 `Yibiao-` 前缀和内部协议标识不变；本次只改用户可见产品名，不改变发布产物命名规则，避免影响已安装用户升级与更新下载逻辑。
- 更新 `.github/workflows/release.yml` 中 macOS 图标生成步骤的源文件路径，避免删除 `icon_256.png` 后发布流程失败。

## 实现边界

- 不改 `appId: com.yibiao.openbidkit`。
- 不批量替换业务 Prompt、日志标题、测试样例或内部 `Yibiao` 标识；只有明确的用户可见产品品牌入口纳入本次替换。
- 不修改 Analytics 采集协议或 Dashboard。
- 不引入新的 Renderer IPC。

## 验证

1. 检查新增 Logo 文件、旧 `icon_256.png` 删除情况，以及 Renderer、Electron、electron-builder 和发布工作流的资源引用。
2. 确认 `release.yml` 不再引用 `icon_256.png`，Windows MSI 不再覆盖成旧产品名，且 `Yibiao-` 产物命名与更新服务匹配规则保持一致。
3. 对 `client/electron/main.cjs` 与 `client/electron/preload.cjs` 执行 `node --check`。
4. 在 `client/` 执行 `npm run build`，确认 TypeScript 和 Vite 构建通过。
5. 启动开发客户端后，人工确认主窗口标题、侧边栏展开/收起状态、Logo 清晰度与中文名称显示。
6. 在可用的构建环境中检查 Windows `icon.ico` 和 macOS CI 生成的 `icon.icns` 可被 electron-builder 识别；Windows 本地至少验证 ICO 文件格式与配置路径。

## 兼容性说明

应用身份保持原 `appId`，因此不会因为改名而生成新的安装身份。安装包显示名和应用文件名会随 `productName` 变为“园测 投标工具箱”；更新服务仍按既有 `Yibiao-` 产物命名规则工作。
