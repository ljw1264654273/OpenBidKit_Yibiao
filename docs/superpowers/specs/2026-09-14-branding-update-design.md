# 园测投标工具箱品牌替换设计

## 目标

将客户端的用户可见品牌统一为“园测 投标工具箱”，并使用用户提供的 Logo 图片替换现有界面与 Electron 应用图标。删除旧的 `client/assets/icon_256.png`，避免保留重复品牌资源。

## 范围

### 品牌资源

- 将用户提供的 PNG 图片保存为 `client/assets/brand-logo.png`，作为 Renderer 界面 Logo 的正式资源。
- 以该 Logo 为源生成或更新 Windows 所需的多尺寸 PNG 与 `icon.ico`。
- 同步更新 macOS 应用图标入口所需的 `icon.icns`，确保 Windows、macOS、侧边栏和窗口图标使用同一 Logo。
- 删除 `client/assets/icon_256.png`。
- 不改变 Logo 图形本身；保留图片比例，并继续使用现有 Logo 容器的紧凑尺寸。

### Renderer 界面

- `Sidebar` 改用 `brand-logo.png`。
- 展开侧边栏显示两行品牌文字：“园测”和“投标工具箱”。
- 收起侧边栏仅显示 Logo。
- 不改变现有导航、侧边栏宽度、折叠行为和业务功能。

### Electron 与打包

- 将 `client/index.html` 的页面标题、Electron 主窗口标题、preload 暴露的 `appName` 和 `client/package.json` 的 `build.productName` 统一为“园测 投标工具箱”。
- 更新 macOS DMG 使用说明中的应用名称和路径示例。
- 保留 `build.appId`、更新服务识别规则、产物文件的 `Yibiao-` 前缀和内部协议标识不变，避免影响已安装用户升级与诊断链路。

## 实现边界

- 不改 `appId: com.yibiao.openbidkit`。
- 不批量替换业务 Prompt、日志标题、测试样例或内部 `Yibiao` 标识；只有明确的用户可见产品品牌入口纳入本次替换。
- 不修改 Analytics 采集协议或 Dashboard。
- 不引入新的 Renderer IPC。

## 验证

1. 检查新增 Logo 文件、旧 `icon_256.png` 删除情况以及打包配置引用。
2. 对 `client/electron/main.cjs` 与 `client/electron/preload.cjs` 执行 `node --check`。
3. 在 `client/` 执行 `npm run build`，确认 TypeScript 和 Vite 构建通过。
4. 启动开发客户端后，人工确认主窗口标题、侧边栏展开/收起状态、Logo 清晰度与中文名称显示。
5. 如本机具备图标转换工具，再检查 Windows/macOS 图标资源可被 electron-builder 识别；否则至少验证资源路径和文件格式。

## 兼容性说明

应用身份保持原 `appId`，因此不会因为改名而生成新的安装身份。安装包显示名和应用文件名会随 `productName` 变为“园测 投标工具箱”；更新服务仍按既有 `Yibiao-` 产物命名规则工作。
