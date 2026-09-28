# Knowledge Base Document Delete EPERM Implementation Plan

> **For agentic workers:** Execute inline with strict red-green TDD; do not delegate because the repository instructions require this confirmed scope to remain local to the current build.

**Goal:** Make knowledge-base document deletion tolerate Windows read-only files and delayed file-handle release without surfacing `EPERM` to the user.

**Architecture:** Keep the existing knowledge-base IPC and store flow unchanged. Replace the document directory's direct `fs.rmSync` call with the repository's shared `forceRemoveSync`, using the existing workspace trash directory and deferred cleanup support.

**Tech Stack:** Electron Main CommonJS, Node.js filesystem APIs, `node:test`.

---

### Task 1: Add the Windows lock regression test

**Files:**
- Create: `client/electron/services/knowledgeBaseService.delete.test.cjs`

- [x] Create a temporary knowledge-base document directory and source file.
- [x] Hold the source file open from a child PowerShell process with delete sharing disabled.
- [x] Call `deleteDocument()` and assert that the operation succeeds, the store record is deleted, and the original directory is gone.
- [x] Run `node --test electron/services/knowledgeBaseService.delete.test.cjs` and verify the current direct deletion fails with a Windows lock error (`EBUSY`, equivalent failure class to the reported `EPERM`).

### Task 2: Reuse the shared forced-removal implementation

**Files:**
- Modify: `client/electron/services/knowledgeBaseService.cjs`

- [x] Import `getWorkspaceTrashDir` and `forceRemoveSync`.
- [x] Replace only the document deletion directory call with `forceRemoveSync`, passing `trashDir` and `deferOnFailure: true`.
- [x] Preserve imported-image cleanup, log cleanup, store deletion, return data, and active-task guards.
- [x] Re-run the regression test and verify it passes.

### Task 3: Verify the focused change

**Files:**
- Verify: `client/electron/services/knowledgeBaseService.cjs`
- Verify: `client/electron/services/knowledgeBaseService.delete.test.cjs`

- [x] Run `node --check electron/services/knowledgeBaseService.cjs`.
- [x] Run the focused knowledge-base tests.
- [x] Run `npm run build` from `client/`.
- [x] Review `git diff` to confirm unrelated working-tree changes remain untouched.
