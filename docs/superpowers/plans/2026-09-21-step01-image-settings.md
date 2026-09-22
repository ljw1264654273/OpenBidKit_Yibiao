# STEP 01 图片设置改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 STEP 01 快速配置中的图片设置收敛为“丰富图文、基础配图、纯文字”三个按钮，补充按钮说明，并默认选中“丰富图文”。

**Architecture:** 保留现有 `ContentImagePreset` 和 `enhanced` 图片能力作为“丰富图文”的稳定内部值，快速配置 UI 不再展示旧的 `rich` 按钮。默认配置和缺省归一化改为 `enhanced`，历史 `rich` 配置继续可被读取和生成。图片选项说明由页面配置映射提供，按钮下方统一渲染说明文本。

**Tech Stack:** React + TypeScript + 全局 CSS；现有 technical-plan quick config/imageConfig 服务；Node test runner；Vite TypeScript build。

---

### Task 1: 锁定默认值与图片选项说明

**Files:**
- Modify: `client/src/features/technical-plan/services/quickConfig.ts`
- Modify: `client/src/features/technical-plan/services/imageConfig.ts`
- Test: `client/src/features/technical-plan/services/quickConfig.test.ts`
- Test: `client/src/features/technical-plan/services/imageConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

  - 断言快速配置默认图片模式为 `enhanced`。
  - 断言缺省快速配置解析结果为 `enhanced`。
  - 断言三个快速配置 UI 模式的显示文案和说明存在，且不把 `rich` 作为快速配置选项。

- [ ] **Step 2: Run the focused tests and verify the expected failures**

  Run from `client/`:

  ```powershell
  node --test --experimental-strip-types src/features/technical-plan/services/quickConfig.test.ts src/features/technical-plan/services/imageConfig.test.ts
  ```

  Expected: the new default-value assertions fail against the current `basic` default.

- [ ] **Step 3: Implement the minimal configuration changes**

  - Change `DEFAULT_CONTENT_GENERATION_OPTIONS.imagePreset` to `enhanced`.
  - Use the same enhanced fallback when normalizing missing persisted image fields and when opening STEP 05 generation controls.
  - Add a focused quick-config option metadata export for the three visible modes and their Chinese descriptions.
  - Keep `IMAGE_PRESET_LABELS.rich` and the existing `rich` definition for historical persisted configurations.
  - Treat the default image mode as selected rather than reporting it as a missing quick-config item.

- [ ] **Step 4: Run the focused tests and verify they pass**

  ```powershell
  node --test --experimental-strip-types src/features/technical-plan/services/quickConfig.test.ts src/features/technical-plan/services/imageConfig.test.ts
  ```

- [ ] **Step 5: Commit the configuration and test changes**

  ```powershell
  git add client/src/features/technical-plan/services/quickConfig.ts client/src/features/technical-plan/services/imageConfig.ts client/src/features/technical-plan/services/quickConfig.test.ts client/src/features/technical-plan/services/imageConfig.test.ts
  git commit -m "feat: default step01 image settings to rich content"
  ```

### Task 2: Update STEP 01 image controls and visual descriptions

**Files:**
- Modify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Modify: `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- Modify: `client/src/styles/feature-technical-plan.css`
- Test: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Write the failing layout assertions**

  - Assert the page renders the three visible labels and descriptions.
  - Assert the page maps only `enhanced`, `basic`, and `text-only` for the quick-config buttons.
  - Assert the old four-button list is absent.

- [ ] **Step 2: Run the focused layout test and verify the expected failure**

  ```powershell
  node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts
  ```

- [ ] **Step 3: Implement the page and CSS changes**

  - Import the shared quick-config image option metadata.
  - Render each option as a selectable button with its title and a description below.
  - Keep the current disabled/saving/task-lock behavior and radio semantics.
  - Use compact responsive CSS so descriptions remain readable under each button without breaking the quick-config row.
  - Keep the summary label based on the selected preset.

- [ ] **Step 4: Run the focused layout test**

  ```powershell
  node --test --experimental-strip-types src/features/technical-plan/services/workflowLayout.test.ts
  ```

- [ ] **Step 5: Commit the page and style changes**

  ```powershell
  git add client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx client/src/styles/feature-technical-plan.css client/src/features/technical-plan/services/workflowLayout.test.ts
  git commit -m "feat: simplify step01 image setting choices"
  ```

### Task 3: Verify the client build and inspect the final diff

**Files:**
- Verify: `client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx`
- Verify: `client/src/features/technical-plan/services/quickConfig.ts`
- Verify: `client/src/features/technical-plan/services/imageConfig.ts`
- Verify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Run all focused tests**

  ```powershell
  cd client
  node --test --experimental-strip-types src/features/technical-plan/services/quickConfig.test.ts src/features/technical-plan/services/imageConfig.test.ts src/features/technical-plan/services/workflowLayout.test.ts
  ```

- [ ] **Step 2: Run the required client build**

  ```powershell
  npm run build
  ```

  Expected: exit code `0`; existing chunk-size warnings are acceptable.

- [ ] **Step 3: Review the final diff and status**

  ```powershell
  git diff --check
  git status --short
  git diff -- client/src/features/technical-plan/pages/DocumentAnalysisPage.tsx client/src/features/technical-plan/services/quickConfig.ts client/src/features/technical-plan/services/imageConfig.ts client/src/styles/feature-technical-plan.css
  ```

- [ ] **Step 4: Report the changed behavior and verification results**
