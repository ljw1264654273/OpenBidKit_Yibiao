# Compact Sidebar Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client sidebar compact, default to collapsed for first-time users, and persist the user's last expanded/collapsed choice without changing navigation behavior.

**Architecture:** Keep the existing `Sidebar` React state, menu rendering, collapse button, Tooltip behavior, and section-change callbacks. Store only the collapsed preference in Renderer `localStorage`, and centralize sidebar width values in CSS variables so the shell, settings-page `FloatingToolbar`, and macOS drag region share the same boundaries.

**Tech Stack:** React 19, TypeScript, Vite, global CSS, Radix Tooltip, Renderer `localStorage`.

**Reference Spec:** `docs/superpowers/specs/2026-09-14-compact-sidebar-menu-design.md`

---

### Task 1: Add persisted sidebar state while preserving existing interaction

**Files:**
- Modify: `client/src/components/Sidebar.tsx:2,47-81,100-104,141-150`

- [ ] **Step 1: Define the storage key and safe read helper**

Add a module-level constant for `yibiao.sidebar.collapsed`. Add a small read helper next to the constant that returns `true` only when the stored value is exactly `"true"`, returns `false` when it is exactly `"false"`, and falls back to `true` when there is no valid stored value or browser storage access throws. Keep this helper local to `Sidebar.tsx`; it is a single-component UI preference and does not need a shared abstraction.

- [ ] **Step 2: Initialize the state as collapsed by default**

Change the existing `useState(false)` initialization to use the read helper. The no-record path must result in `collapsed === true`, while a stored `"false"` must restore the expanded state.

- [ ] **Step 3: Persist changes through the existing collapse button**

Keep the current button and its `setCollapsed((value) => !value)` interaction. Add an effect that writes `"true"` or `"false"` whenever `collapsed` changes. Catch storage write failures so a storage issue cannot prevent the visual toggle from working.

- [ ] **Step 4: Reduce sidebar text content without changing navigation**

Keep the existing `nav-copy` wrapper and the menu label so the expanded CSS can control visibility. Remove the menu item's `<small>{item.description}</small>` from the sidebar item markup. Remove the settings description `<small>模型与解析配置</small>`. Do not change `getAppMenuItems`, `onSectionChange`, notice handling, Tooltip wrapping, or bottom document/settings actions.

- [ ] **Step 5: Review the component diff**

Confirm that the only behavior added is preference persistence, that the collapse button still has the same accessible labels, and that all existing menu labels remain available to the collapsed-state Tooltip.

### Task 2: Centralize sidebar dimensions and compact layout styling

**Files:**
- Modify: `client/src/styles/tokens.css:2-58`
- Modify: `client/src/styles/layout-app-shell.css:18-305`

- [ ] **Step 1: Add shared sidebar width variables**

Add `--yb-sidebar-expanded-width: 220px` and `--yb-sidebar-collapsed-width: 72px` to the root tokens. Keep existing token naming and ordering style.

- [ ] **Step 2: Update the shell and macOS drag boundary**

Replace the sidebar's hard-coded `286px` width/min-width with `var(--yb-sidebar-expanded-width)`. Replace the collapsed `88px` width/min-width with `var(--yb-sidebar-collapsed-width)`. Change `.app-shell.is-mac::before` so its `left` uses the expanded width variable by default and the collapsed sidebar selector uses the collapsed width variable. Preserve the current `28px` drag-region height and existing `no-drag` rules for controls.

- [ ] **Step 3: Compact the brand and navigation spacing**

Update the expanded layout to the approved dimensions:

- brand block fixed height target: `48px`;
- sidebar horizontal padding remains compatible with the `220px` width;
- navigation item height: `40px`;
- navigation item vertical padding: `6px`;
- item gap: `3px`;
- icon container: `28px`;
- icon: `17px`.

Hide the sidebar descriptions by removing them from the component markup, and keep `.nav-copy` as a single-line label layout. Preserve the nav's internal vertical scrolling.

- [ ] **Step 4: Implement the compact selected and hover states**

Replace the current active-item blue/violet gradient, inset highlight, and heavy shadow with a light purple background, theme-colored text, and a light border. Keep active parent highlighting and `aria-current` behavior unchanged. Use the existing token system and keep hover movement subtle or remove it if it causes layout jitter.

- [ ] **Step 5: Close the collapsed layout dimensions**

For `.sidebar.is-collapsed`:

- use `10px` horizontal sidebar padding;
- make the brand block horizontal padding `0`, set its logo to `32px`, and center it;
- set menu and footer button horizontal padding to `0`, fill the inner content width, and center their icon content;
- set collapsed icon container to `30px` and its SVG to `18px`;
- set collapsed item height to `38px` with `3px` gaps;
- keep brand/menu/settings copy hidden;
- keep the existing Tooltip wrapper and collapse button.

Ensure the `72px` sidebar can contain every collapsed icon without clipping or horizontal overflow.

### Task 3: Keep settings FloatingToolbar aligned with both sidebar states

**Files:**
- Modify: `client/src/styles/shared-components.css:182-192`

- [ ] **Step 1: Replace hard-coded settings offsets**

Set the expanded `.settings-page > .floating-toolbar` left position to `calc(var(--yb-sidebar-expanded-width) + 42px)`. Set the collapsed selector to `calc(var(--yb-sidebar-collapsed-width) + 42px)`.

- [ ] **Step 2: Preserve user-dragged toolbar positions**

Review the existing `FloatingToolbar` positioning rules and confirm the CSS change only affects the default fixed placement. Do not change drag state, inline positioning, right/bottom margins, or toolbar button behavior. If the component writes an inline `left` value while dragged, leave that inline value with normal CSS precedence.

### Task 4: Build and manually verify the compact sidebar workflow

**Files:**
- No additional files.

- [ ] **Step 1: Run the client build**

Run:

```powershell
cd client
npm run build
```

Expected: TypeScript and Vite both exit with code `0`. Existing chunk-size warnings are acceptable if the command succeeds.

- [ ] **Step 2: Start the development client**

Run:

```powershell
cd client
npm run dev
```

Expected: Vite starts on `127.0.0.1:5173` and Electron opens the client window.

- [ ] **Step 3: Verify first-use default state**

Clear only the `yibiao.sidebar.collapsed` preference in the Renderer devtools or use a fresh profile, then reopen the client. Confirm the sidebar is collapsed, icons are centered, nothing is clipped, and each menu icon still exposes the existing Tooltip label.

- [ ] **Step 4: Verify preference persistence**

Click the existing collapse button to expand the sidebar, close and reopen the client, and confirm it remains expanded. Collapse it again, close and reopen, and confirm it remains collapsed.

- [ ] **Step 5: Verify navigation and layout consumers**

Click representative top-level menus, a menu item with a notice, document, and settings. Confirm navigation and Toast behavior are unchanged. Open the settings page in both sidebar states and confirm the `FloatingToolbar` remains offset after the sidebar edge. On macOS, verify the `28px` top drag region begins after the correct sidebar width in both states.

- [ ] **Step 6: Commit the implementation**

After the build and manual checks pass:

```powershell
git add client/src/components/Sidebar.tsx client/src/styles/tokens.css client/src/styles/layout-app-shell.css client/src/styles/shared-components.css
git commit -m "feat: compact sidebar and persist layout state"
```

Do not stage the brainstorming preview directory or unrelated worktree changes.

