# 侧边栏 Logo 放大设计

## 背景

当前客户端侧边栏 Logo 在展开状态为 `36px`，收起状态为 `32px`，视觉存在感偏弱。用户希望参考 Chrome 图标的大小，选择了“明显放大”方案。

## 目标

- 提升侧边栏 Logo 的识别度和品牌存在感。
- 保持现有 Logo 图片、品牌文字、导航结构和侧边栏宽度不变。
- 展开与收起状态都使用稳定、明确的尺寸。

## 方案

仅调整 `client/src/styles/layout-app-shell.css` 中 `.brand-mark` 的尺寸：

- 展开状态：宽高从 `36px` 调整为 `56px`，`flex-basis` 同步调整为 `56px`。
- 收起状态：宽高从 `32px` 调整为 `48px`，`flex-basis` 同步调整为 `48px`。
- Logo 图片继续使用 `width: 100%`、`height: 100%` 和 `object-fit: contain`，不修改图片资源。
- 品牌区的高度、品牌文字样式、侧边栏宽度、导航间距和折叠交互保持不变。

这样可以让 Logo 接近桌面应用图标的视觉重量，同时不引入新的组件、状态或数据变化。

## 影响范围

- 仅影响主窗口侧边栏的品牌 Logo 展示。
- 不涉及 Electron Main、preload、IPC、Analytics、数据库或持久化。
- 既有用户的侧边栏展开/收起偏好继续通过现有 `localStorage` 读取。

## 验证

1. 在 `client/` 下运行 `npm run build`，确认 TypeScript 检查和 Vite 构建通过。
2. 使用 `npm run dev` 打开客户端，分别检查展开和收起状态：
   - 展开 Logo 为 `56px`，收起 Logo 为 `48px`。
   - Logo 不被裁切，品牌文字不与 Logo 重叠。
   - 侧边栏折叠按钮、导航和底部操作仍可正常使用。
