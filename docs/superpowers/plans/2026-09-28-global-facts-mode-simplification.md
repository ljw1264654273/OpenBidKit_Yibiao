# Global Facts Mode Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fabrication mode, rename the two retained modes, and make standard mode the safe default for new and legacy workspaces.

**Architecture:** Keep the persisted identifiers `omit` and `placeholder` so existing standard/strict behavior remains stable. Remove `fabricate` from the Renderer type and selectable options, normalize every unknown or legacy value to `omit` in Renderer and Main, and add SQLite migration v36 to rewrite stored legacy values.

**Tech Stack:** React 19, TypeScript, Electron CommonJS services, better-sqlite3, Node test runner, Vite.

---

### Task 1: Lock the two-mode contract with failing tests

**Files:**
- Create: `client/electron/services/globalFactsMode.test.cjs`
- Modify: `client/electron/services/contentGenerationTask.mandatoryRules.test.cjs`
- Modify: `client/electron/services/globalFactsTaskV2.cjs` only later in Task 2; Task 1 consumes a small exported test runtime added with the implementation

- [ ] **Step 1: Write failing normalization and prompt tests**

Import `normalizeGlobalFactsMode` from `globalFactsTask.cjs`, the V2 prompt helpers from a new `__globalFactsModeTestRuntime` export in `globalFactsTaskV2.cjs`, and content prompt builders from `__mandatoryBidContentRulesTestRuntime`. Add tests asserting:

```js
assert.equal(normalizeGlobalFactsMode(undefined), 'omit');
assert.equal(normalizeGlobalFactsMode('fabricate'), 'omit');
assert.equal(normalizeGlobalFactsMode('omit'), 'omit');
assert.equal(normalizeGlobalFactsMode('placeholder'), 'placeholder');
assert.match(standardPrompt, /标准模式/);
assert.match(strictPrompt, /严谨模式/);
assert.doesNotMatch(legacyPrompt, /允许补足|模拟生成|杜撰.*事实值/);
```

For the V2 prompt path, build `standardPrompt`, `strictPrompt`, and `legacyPrompt` with `createGlobalFactsPrompt()` from the test runtime. Update existing mandatory-rule fixtures that intentionally pass `fabricate` so they assert the generated content prompt follows standard-mode non-fabrication rules.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
cd client
node --test electron/services/globalFactsMode.test.cjs electron/services/contentGenerationTask.mandatoryRules.test.cjs
```

Expected: failures because `fabricate` still normalizes to itself/defaults to fabrication and prompt headings still use the old names.

### Task 2: Implement Main-process mode normalization and prompt names

**Files:**
- Modify: `client/electron/services/globalFactsTask.cjs`
- Modify: `client/electron/services/globalFactsTaskV2.cjs`
- Modify: `client/electron/services/contentGenerationTask.cjs`
- Modify: `client/electron/services/technicalPlanStore.cjs`

- [ ] **Step 1: Change all Main normalizers to the two-mode contract**

Use the same rule in all three services:

```js
function normalizeGlobalFactsMode(value) {
  return value === 'placeholder' ? 'placeholder' : 'omit';
}
```

`fabricate`, missing values, and malformed values therefore resolve to `omit`.

- [ ] **Step 2: Remove reachable fabrication behavior**

Make standard-mode non-fabrication rules the default branch in global-facts and content prompts. In the active `globalFactsTaskV2.cjs` path, make `buildMissingValueRule()` and `buildJsonExample()` default to the standard-mode wording/example and expose only those helpers plus `createGlobalFactsPrompt()` through `__globalFactsModeTestRuntime`. Keep placeholder-specific rules only for `placeholder`. Rename prompt headings to `事实补全规则（标准模式）` and `事实补全规则（严谨模式）`.

- [ ] **Step 3: Change Store defaults and reset values**

Change `initialState.globalFactsMode`, `normalizeGlobalFactsMode()` fallback, and reset metadata from `fabricate` to `omit`. `isValidGlobalFactsMode()` must accept only `omit` and `placeholder`. Add Store assertions to `globalFactsMode.test.cjs` using a temporary SQLite workspace: a new workspace loads `omit`, saving `fabricate` persists/loads `omit`, and reset restores `omit`.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run the Task 1 command again. Expected: all tests pass.

### Task 3: Update Renderer options, labels, and defaults

**Files:**
- Modify: `client/src/features/technical-plan/types.ts`
- Modify: `client/src/features/technical-plan/pages/GlobalFactsPage.tsx`
- Modify: `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- Modify: `client/src/features/technical-plan/hooks/useTechnicalPlanWorkflow.ts`

- [ ] **Step 1: Restrict the public type**

Change:

```ts
export type GlobalFactsMode = 'omit' | 'placeholder';
```

- [ ] **Step 2: Replace the option list**

Remove the `fabricate` card. Rename `omit` to `标准模式` and `placeholder` to `严谨模式`. Rewrite both descriptions so they describe their behavior directly and do not compare against the removed mode.

- [ ] **Step 3: Make Renderer fallback standard mode**

Change page normalization, initial state, cached-state fallback, and `TechnicalPlanHome` property fallback to `omit`. A cached `fabricate` string must be normalized to `omit`, not passed through.

- [ ] **Step 4: Run TypeScript build check**

Run:

```powershell
cd client
npm run build
```

Expected: TypeScript and Vite complete successfully; existing chunk-size warnings are acceptable.

### Task 4: Migrate persisted legacy configuration

**Files:**
- Modify: `client/electron/services/sqliteDatabase.cjs`
- Create: `client/electron/services/sqliteDatabase.globalFactsModeMigration.test.cjs`
- Modify: `sql/workspace_schema.sql`

- [ ] **Step 1: Write the failing migration test**

Create a v35 database fixture containing `technical_plan_meta.global_facts_mode = 'fabricate'`, reopen it through `createSqliteDatabase()`, then assert:

```js
assert.equal(database.schemaVersion, 36);
assert.equal(database.db.pragma('user_version', { simple: true }), 36);
assert.equal(
  database.db.prepare('SELECT global_facts_mode FROM technical_plan_meta LIMIT 1').get().global_facts_mode,
  'omit',
);
```

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```powershell
cd client
node --test electron/services/sqliteDatabase.globalFactsModeMigration.test.cjs
```

Expected: fail because schema version is still 35 and the legacy value remains `fabricate`.

- [ ] **Step 3: Add migration v36 and new defaults**

Set `schemaVersion = 36`, add an idempotent migration that updates `technical_plan_meta` rows from `fabricate` to `omit`, and update all new-schema/column definitions from `DEFAULT 'fabricate'` to `DEFAULT 'omit'`. Add the v36 expected-column health entry only if required by the existing schema-health mechanism.

- [ ] **Step 4: Synchronize the canonical schema**

Change `sql/workspace_schema.sql` so `global_facts_mode` defaults to `omit`.

- [ ] **Step 5: Run migration tests and native smoke test**

Run:

```powershell
cd client
node --test electron/services/sqliteDatabase.globalFactsModeMigration.test.cjs electron/services/sqliteDatabase.variantMigration.test.cjs
npm run smoke:electron-native
```

Expected: all tests and the Electron native smoke test pass.

### Task 5: Final verification and scope audit

**Files:**
- Verify all modified files above.

- [ ] **Step 1: Check Electron syntax**

Run:

```powershell
cd client
node --check electron/services/globalFactsTask.cjs
node --check electron/services/globalFactsTaskV2.cjs
node --check electron/services/contentGenerationTask.cjs
node --check electron/services/technicalPlanStore.cjs
node --check electron/services/sqliteDatabase.cjs
```

- [ ] **Step 2: Run all focused tests**

Run:

```powershell
cd client
node --test electron/services/globalFactsMode.test.cjs electron/services/contentGenerationTask.mandatoryRules.test.cjs electron/services/sqliteDatabase.globalFactsModeMigration.test.cjs electron/services/sqliteDatabase.variantMigration.test.cjs
```

- [ ] **Step 3: Run the complete client build**

Run `npm run build` from `client/` and require exit code 0.

- [ ] **Step 4: Audit the final diff and remaining legacy strings**

Run:

```powershell
rg -n "胡咧咧模式|别招欠模式|放着我来模式|fabricate" client/src client/electron sql
git status --short
git diff --check
```

Expected: no production-code references to the removed display names or executable `fabricate` mode; any remaining `fabricate` string is limited to explicit migration/legacy-compatibility tests. Confirm unrelated existing bid-duplicate changes are untouched.
