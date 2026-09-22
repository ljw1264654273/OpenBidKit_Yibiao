# STEP 03 目录项知识库选择优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 STEP 03 目录详情中的“新增知识库”和“关联文档”改为“一级知识库 → 文件目录 → 文档”的简洁级联操作，并支持选择已有目录或新建目录。

**Architecture:** 保留现有知识库 IPC、SQLite 和目录节点关联协议，在 Renderer 增加一个可测试的纯选择辅助模块，并将 `OutlineEditPage` 的两个旧弹窗重构为统一的级联选择流程。新增流程选择已有目录时直接上传到该目录；选择新建目录时先在指定一级知识库下创建目录，再上传并关联；关联文档流程只替换当前文件夹下的文档选择，保留当前节点来自其他文件夹的既有关联。

**Tech Stack:** React, TypeScript, Radix Dialog, 全局 CSS, Node `node:test`, Vite/TypeScript build。

---

## 文件结构与职责

- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
  - 管理两个弹窗的模式、一级知识库、目录、新建目录和文档临时选择状态。
  - 复用 `KNOWLEDGE_BASE_CATALOG`、现有 `knowledgeBase.list/createFolder/uploadDocuments` 和 `onOutlineNodeKnowledgeSaved`。
  - 渲染统一的三级选择界面及新增/关联两条提交路径。
- Create: `client/src/features/technical-plan/services/nodeKnowledgeSelection.ts`
  - 提供按一级知识库过滤目录、按目录过滤可用文档、去重并保留其他目录文档的纯函数。
  - 不调用 `window.yibiao`，不依赖 React。
- Create: `client/src/features/technical-plan/services/nodeKnowledgeSelection.test.ts`
  - 使用 Node `node:test` 覆盖级联过滤、可用文档筛选和关联合并规则。
- Modify: `client/src/styles/feature-technical-plan.css`
  - 将当前知识库弹窗样式调整为紧凑的“步骤区 + 选择控件 + 文档列表 + 摘要”布局。
  - 保留现有技术方案工作台的按钮尺寸、圆角和弹窗层级规范。
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`
  - 增加页面结构契约测试，确认两个入口使用统一选择状态、指定 `knowledgeBaseId` 创建目录、按目录过滤文档，并保留其他目录已有文档。

不修改：

- `client/electron/services/knowledgeBaseStore.cjs`
- `client/electron/services/knowledgeBaseService.cjs`
- `client/electron/ipc/knowledgeBaseIpc.cjs`
- `client/electron/preload.cjs`
- `client/src/shared/types/ipc.ts`
- SQLite schema、Analytics 和其他知识库页面

现有工作区中 `OutlineEditPage.tsx` 和 `feature-technical-plan.css` 已有此前知识库入口实现，执行时在其基础上重构，不回退或覆盖用户其他未提交改动。

### Task 1: Add pure selection helpers and failing tests

**Files:**
- Create: `client/src/features/technical-plan/services/nodeKnowledgeSelection.ts`
- Test: `client/src/features/technical-plan/services/nodeKnowledgeSelection.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests with small in-memory `KnowledgeBaseIndex` fixtures:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeBaseIndex } from '../../knowledge-base/types.ts';
import {
  getDocumentsForFolder,
  getFoldersForKnowledgeBase,
  mergeFolderDocumentSelection,
} from './nodeKnowledgeSelection.ts';

const index: KnowledgeBaseIndex = {
  folders: [
    {
      id: 'national-folder',
      name: '国标施工规范',
      knowledge_base_id: 'national-standard',
      sort_order: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'provincial-folder',
      name: '省标施工规范',
      knowledge_base_id: 'provincial-standard',
      sort_order: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  documents: [
    {
      id: 'national-ready',
      folder_id: 'national-folder',
      knowledge_base_id: 'national-standard',
      file_name: '国标-已完成.docx',
      status: 'success',
      progress: 100,
      message: '',
      item_count: 3,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'national-pending',
      folder_id: 'national-folder',
      knowledge_base_id: 'national-standard',
      file_name: '国标-处理中.docx',
      status: 'matching',
      progress: 50,
      message: '',
      item_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'provincial-ready',
      folder_id: 'provincial-folder',
      knowledge_base_id: 'provincial-standard',
      file_name: '省标-已完成.docx',
      status: 'success',
      progress: 100,
      message: '',
      item_count: 2,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

test('只返回所选一级知识库下的目录', () => {
  assert.deepEqual(
    getFoldersForKnowledgeBase(index, 'national-standard').map((folder) => folder.id),
    ['national-folder'],
  );
});

test('只返回所选目录下状态为 success 的文档', () => {
  assert.deepEqual(
    getDocumentsForFolder(index, 'national-folder').map((document) => document.id),
    ['national-ready'],
  );
});

test('保存当前文件夹文档时保留其他文件夹已有文档并去重', () => {
  assert.deepEqual(
    mergeFolderDocumentSelection(
      index,
      'national-folder',
      ['national-ready', 'national-pending', 'provincial-ready'],
      ['national-ready'],
    ),
    ['provincial-ready', 'national-ready'],
  );
});

test('未知目录不会把文档写入关联列表', () => {
  assert.deepEqual(
    mergeFolderDocumentSelection(index, 'missing-folder', ['provincial-ready'], ['provincial-ready']),
    [],
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `client/`:

```powershell
node --test src/features/technical-plan/services/nodeKnowledgeSelection.test.ts
```

Expected: FAIL because `nodeKnowledgeSelection.ts` and its exported helper functions do not exist yet.

- [ ] **Step 3: Implement the minimal pure helpers**

Create `nodeKnowledgeSelection.ts` with these exact exports:

```ts
import type { KnowledgeBaseId } from '../../knowledge-base/knowledgeBaseCatalog';
import type { KnowledgeBaseIndex, KnowledgeDocument, KnowledgeFolder } from '../../knowledge-base/types';

export function getFoldersForKnowledgeBase(
  index: KnowledgeBaseIndex,
  knowledgeBaseId: KnowledgeBaseId | '',
): KnowledgeFolder[] {
  if (!knowledgeBaseId) return [];
  return index.folders.filter((folder) => folder.knowledge_base_id === knowledgeBaseId);
}

export function getDocumentsForFolder(index: KnowledgeBaseIndex, folderId: string): KnowledgeDocument[] {
  if (!folderId) return [];
  return index.documents.filter((document) => document.folder_id === folderId && document.status === 'success');
}

export function mergeFolderDocumentSelection(
  index: KnowledgeBaseIndex,
  folderId: string,
  currentDocumentIds: string[],
  selectedDocumentIds: string[],
): string[] {
  const folderDocumentIds = new Set(
    index.documents
      .filter((document) => document.folder_id === folderId)
      .map((document) => document.id),
  );
  const selectableDocumentIds = new Set(getDocumentsForFolder(index, folderId).map((document) => document.id));
  if (!folderDocumentIds.size) return [];
  const retainedIds = currentDocumentIds.filter((documentId) => !folderDocumentIds.has(documentId));
  const selectedIds = selectedDocumentIds.filter((documentId) => selectableDocumentIds.has(documentId));
  return [...new Set([...retainedIds, ...selectedIds])];
}
```

The implementation must preserve the index order for folders/documents, remove all existing document IDs belonging to the selected folder before applying the new selection, only accept `success` documents in the new selection, and never allow a document from another folder to enter the selected folder’s result.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
node --test src/features/technical-plan/services/nodeKnowledgeSelection.test.ts
```

Expected: all four tests pass with zero failures.

- [ ] **Step 5: Commit the helper and tests**

```powershell
git add src/features/technical-plan/services/nodeKnowledgeSelection.ts src/features/technical-plan/services/nodeKnowledgeSelection.test.ts
git commit -m "test: add step03 knowledge selection helpers"
```

### Task 2: Replace dialog state and handlers with cascade state

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`

- [ ] **Step 1: Add the explicit dialog and selection types**

Near the existing `OutlineWorkspacePane` type, add:

```ts
import type { KnowledgeBaseId } from '../../knowledge-base/knowledgeBaseCatalog';
import {
  getDocumentsForFolder,
  getFoldersForKnowledgeBase,
  mergeFolderDocumentSelection,
} from '../services/nodeKnowledgeSelection';

type NodeKnowledgeDialogMode = 'create' | 'link';
type NodeKnowledgeFolderMode = 'existing' | 'new';
```

Keep the existing `KNOWLEDGE_BASE_CATALOG` import and do not create a second catalog.

- [ ] **Step 2: Replace the old node-knowledge state with cascade state**

Replace `nodeKnowledgeDialogOpen`, `nodeKnowledgeDocumentDialogOpen`, `nodeKnowledgeFolderName`, and `draftNodeKnowledgeDocumentIds` with:

```ts
const [nodeKnowledgeDialogMode, setNodeKnowledgeDialogMode] = useState<NodeKnowledgeDialogMode | null>(null);
const [nodeKnowledgeBaseId, setNodeKnowledgeBaseId] = useState<KnowledgeBaseId | ''>('');
const [nodeKnowledgeFolderId, setNodeKnowledgeFolderId] = useState('');
const [nodeKnowledgeFolderMode, setNodeKnowledgeFolderMode] = useState<NodeKnowledgeFolderMode>('existing');
const [nodeKnowledgeFolderName, setNodeKnowledgeFolderName] = useState('');
const [draftNodeKnowledgeDocumentIds, setDraftNodeKnowledgeDocumentIds] = useState<string[]>([]);
const [nodeKnowledgeCreatedFolderId, setNodeKnowledgeCreatedFolderId] = useState<string | null>(null);
```

Add derived values immediately after the existing knowledge index maps:

```ts
const nodeKnowledgeFolders = useMemo(
  () => getFoldersForKnowledgeBase(knowledgeIndex, nodeKnowledgeBaseId),
  [knowledgeIndex, nodeKnowledgeBaseId],
);
const nodeKnowledgeDocuments = useMemo(
  () => getDocumentsForFolder(knowledgeIndex, nodeKnowledgeFolderId),
  [knowledgeIndex, nodeKnowledgeFolderId],
);
const nodeKnowledgeDialogOpen = nodeKnowledgeDialogMode !== null;
const nodeKnowledgeCanChooseFolder = Boolean(nodeKnowledgeBaseId);
const nodeKnowledgeCanChooseDocuments = Boolean(nodeKnowledgeBaseId && nodeKnowledgeFolderId);
```

When `nodeKnowledgeDialogMode` is `null`, the derived lists may be empty and must not trigger knowledge-base loading.

- [ ] **Step 3: Add reset and cascade handlers**

Replace the old `openNodeKnowledgeDialog`, `openNodeKnowledgeDocumentDialog`, `toggleDraftNodeKnowledgeDocument`, and related initialization with these behaviors:

```ts
const resetNodeKnowledgeDialog = () => {
  setNodeKnowledgeDialogMode(null);
  setNodeKnowledgeBaseId('');
  setNodeKnowledgeFolderId('');
  setNodeKnowledgeFolderMode('existing');
  setNodeKnowledgeFolderName('');
  setDraftNodeKnowledgeDocumentIds([]);
  setNodeKnowledgeCreatedFolderId(null);
};

const openNodeKnowledgeDialog = () => {
  if (!selectedItem) return;
  const lockMessage = getMutationLockMessage();
  if (sorting) {
    showToast('请先保存当前目录排序', 'info');
    return;
  }
  if (lockMessage) {
    showToast(lockMessage, 'info');
    return;
  }
  resetNodeKnowledgeDialog();
  setNodeKnowledgeDialogMode('create');
  void loadKnowledgeIndex();
};

const openNodeKnowledgeDocumentDialog = () => {
  if (!selectedItem) return;
  const lockMessage = getMutationLockMessage();
  if (sorting) {
    showToast('请先保存当前目录排序', 'info');
    return;
  }
  if (lockMessage) {
    showToast(lockMessage, 'info');
    return;
  }
  resetNodeKnowledgeDialog();
  setNodeKnowledgeDialogMode('link');
  void loadKnowledgeIndex();
};

const handleNodeKnowledgeBaseChange = (value: KnowledgeBaseId | '') => {
  setNodeKnowledgeBaseId(value);
  setNodeKnowledgeFolderId('');
  setNodeKnowledgeFolderMode('existing');
  setNodeKnowledgeFolderName('');
  setDraftNodeKnowledgeDocumentIds([]);
  setNodeKnowledgeCreatedFolderId(null);
};

const handleNodeKnowledgeFolderChange = (folderId: string) => {
  setNodeKnowledgeFolderId(folderId);
  setNodeKnowledgeFolderMode('existing');
  setNodeKnowledgeFolderName('');
  setNodeKnowledgeCreatedFolderId(null);
  if (nodeKnowledgeDialogMode === 'link') {
    setDraftNodeKnowledgeDocumentIds(
      selectedDirectKnowledgeDocumentIds.filter((documentId) => (
        knowledgeIndex.documents.find((document) => document.id === documentId)?.folder_id === folderId
      )),
    );
  } else {
    setDraftNodeKnowledgeDocumentIds([]);
  }
};
```

The folder change handler must clear document selections when the folder changes. The link mode may preselect documents already directly linked to the selected folder, but it must not preselect documents from other folders.

- [ ] **Step 4: Implement new-folder creation under the selected knowledge base**

Add a `createNodeKnowledgeFolder` handler with this behavior:

```ts
if (!nodeKnowledgeBaseId) {
  showToast('请先选择一级知识库', 'info');
  return;
}
const folderName = nodeKnowledgeFolderName.trim();
if (!folderName) {
  showToast('请输入目录名称', 'info');
  return;
}
const folder = await window.yibiao?.knowledgeBase.createFolder(folderName, nodeKnowledgeBaseId);
if (!folder?.id) throw new Error('创建知识库目录失败');
setKnowledgeIndex((previous) => ({ ...previous, folders: [...previous.folders, folder] }));
setNodeKnowledgeFolderId(folder.id);
setNodeKnowledgeFolderMode('existing');
setNodeKnowledgeCreatedFolderId(folder.id);
```

The handler must keep the modal open after creation so the user can immediately upload documents. It must never call `createFolder(folderName)` without the selected `knowledgeBaseId`. On failure, keep the selected category and typed name so the user can retry.

- [ ] **Step 5: Implement upload-and-associate behavior**

Replace the current `createNodeKnowledgeFolder` upload flow with `uploadNodeKnowledgeDocuments`:

```ts
if (!nodeKnowledgeFolderId) {
  showToast('请先选择文件目录', 'info');
  return;
}
setSavingNodeKnowledge(true);
try {
  const result = await window.yibiao?.knowledgeBase.uploadDocuments(nodeKnowledgeFolderId);
  if (!result?.success) {
    const message = result?.message || '未选择文档';
    if (message === '已取消选择' && nodeKnowledgeCreatedFolderId === nodeKnowledgeFolderId) {
      await saveNodeKnowledgeLinks(
        selectedItem.id,
        uniqueIds([...(selectedItem.knowledge_folder_ids || []), nodeKnowledgeFolderId]),
        selectedDirectKnowledgeDocumentIds,
      );
      resetNodeKnowledgeDialog();
      showToast('已关联空目录，可稍后上传知识库文档', 'info');
      return;
    }
    if (isLibreOfficeRequiredMessage(message)) {
      showDocumentParseNotice(message);
      return;
    }
    showToast(message, 'info');
    return;
  }
  await saveNodeKnowledgeLinks(
    selectedItem.id,
    uniqueIds([...(selectedItem.knowledge_folder_ids || []), nodeKnowledgeFolderId]),
    selectedDirectKnowledgeDocumentIds,
  );
  await loadKnowledgeIndex();
  resetNodeKnowledgeDialog();
  showToast(result.message || '知识库文档已加入处理队列', 'success');
} catch (error) {
  const message = error instanceof Error ? error.message : '上传知识库文档失败';
  if (isLibreOfficeRequiredMessage(message)) {
    showDocumentParseNotice(message);
  } else {
    showToast(message, 'error');
  }
} finally {
  setSavingNodeKnowledge(false);
}
```

For an existing directory, cancelling the file picker must not create a new node association. For a newly created directory, cancelling after creation must preserve the empty-directory association as specified.

- [ ] **Step 6: Implement document-link save without deleting other-folder links**

Replace `saveNodeKnowledgeDocuments` with:

```ts
const saveNodeKnowledgeDocuments = async () => {
  if (!selectedItem || !nodeKnowledgeFolderId) return;
  try {
    setSavingNodeKnowledge(true);
    const nextDocumentIds = mergeFolderDocumentSelection(
      knowledgeIndex,
      nodeKnowledgeFolderId,
      selectedDirectKnowledgeDocumentIds,
      draftNodeKnowledgeDocumentIds,
    );
    await saveNodeKnowledgeLinks(
      selectedItem.id,
      selectedDirectKnowledgeFolderIds,
      nextDocumentIds,
    );
    resetNodeKnowledgeDialog();
    showToast('已关联知识库文档', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存知识库文档关联失败', 'error');
  } finally {
    setSavingNodeKnowledge(false);
  }
};
```

The save button must be disabled until both a category and folder are selected. The helper’s result must be used so links from other folders survive.

- [ ] **Step 7: Run TypeScript compilation after handler changes**

Run from `client/`:

```powershell
npm run build
```

Expected: TypeScript and Vite build complete successfully. Existing Vite chunk-size warnings are acceptable when the command exits with code 0.

- [ ] **Step 8: Commit the cascade state and handler refactor**

```powershell
git add src/features/technical-plan/pages/OutlineEditPage.tsx
git commit -m "feat: cascade step03 node knowledge selection"
```

### Task 3: Replace both modal render trees with the compact three-level flow

**Files:**
- Modify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`

- [ ] **Step 1: Replace the two `Dialog.Root` blocks with one mode-driven dialog**

Keep one Radix `Dialog.Root`:

```tsx
<Dialog.Root
  open={nodeKnowledgeDialogOpen}
  onOpenChange={(open) => {
    if (!open && !savingNodeKnowledge) resetNodeKnowledgeDialog();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay className="content-regenerate-modal" />
    <Dialog.Content className="outline-node-knowledge-flow-dialog">
      <Dialog.Title>{nodeKnowledgeDialogMode === 'create' ? '新增知识库内容' : '关联知识库文档'}</Dialog.Title>
      <Dialog.Description>
        {nodeKnowledgeDialogMode === 'create'
          ? '选择知识库和目录后上传文档，内容将关联到当前目录。'
          : '选择一个目录后勾选需要用于正文生成的文档。'}
      </Dialog.Description>
      {/* step sections from the following steps */}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```

Do not leave the old `outline-node-knowledge-dialog` or `outline-node-knowledge-document-dialog` render trees active.

- [ ] **Step 2: Render the一级知识库 selector**

Use a native `<select>` because the list is short and fixed:

```tsx
<section className="outline-node-knowledge-step">
  <label className="outline-node-knowledge-field">
    <span>1. 一级知识库</span>
    <select
      value={nodeKnowledgeBaseId}
      onChange={(event) => handleNodeKnowledgeBaseChange(event.target.value as KnowledgeBaseId | '')}
      disabled={savingNodeKnowledge}
    >
      <option value="">请选择一级知识库</option>
      {KNOWLEDGE_BASE_CATALOG.map((item) => (
        <option value={item.id} key={item.id}>{item.label}</option>
      ))}
    </select>
  </label>
</section>
```

Changing this select must clear directory, new-directory input and document state through `handleNodeKnowledgeBaseChange`.

- [ ] **Step 3: Render existing/new directory selection**

Render the directory section only after `nodeKnowledgeCanChooseFolder`:

```tsx
{nodeKnowledgeCanChooseFolder && (
  <section className="outline-node-knowledge-step">
    <label className="outline-node-knowledge-field">
      <span>2. 文件目录</span>
      <select
        value={nodeKnowledgeFolderMode === 'new' ? '__new__' : nodeKnowledgeFolderId}
        onChange={(event) => {
          if (event.target.value === '__new__') {
            setNodeKnowledgeFolderMode('new');
            setNodeKnowledgeFolderId('');
            setDraftNodeKnowledgeDocumentIds([]);
            return;
          }
          handleNodeKnowledgeFolderChange(event.target.value);
        }}
        disabled={savingNodeKnowledge}
      >
        <option value="">请选择文件目录</option>
        {nodeKnowledgeFolders.map((folder) => (
          <option value={folder.id} key={folder.id}>{folder.name}</option>
        ))}
        {nodeKnowledgeDialogMode === 'create' && <option value="__new__">+ 新建目录</option>}
      </select>
    </label>
    {nodeKnowledgeFolderMode === 'new' && nodeKnowledgeDialogMode === 'create' && (
      <div className="outline-node-knowledge-inline-create">
        <input
          value={nodeKnowledgeFolderName}
          onChange={(event) => setNodeKnowledgeFolderName(event.target.value)}
          placeholder="输入新目录名称"
          disabled={savingNodeKnowledge}
        />
        <button type="button" className="secondary-action" onClick={() => { void createNodeKnowledgeFolder(); }} disabled={savingNodeKnowledge}>
          {savingNodeKnowledge ? '创建中...' : '创建目录'}
        </button>
      </div>
    )}
  </section>
)}
```

For link mode, do not render the new-directory option. If the selected category has no directories, show `该一级知识库下暂无目录，请先在知识库模块创建目录。`.

- [ ] **Step 4: Render mode-specific document actions**

For create mode, render the upload section only after a folder is selected:

```tsx
{nodeKnowledgeDialogMode === 'create' && nodeKnowledgeCanChooseDocuments && (
  <section className="outline-node-knowledge-step">
    <div className="outline-node-knowledge-summary">
      {getKnowledgeBaseCatalogItem(nodeKnowledgeBaseId)?.label} / {nodeKnowledgeFolders.find((folder) => folder.id === nodeKnowledgeFolderId)?.name}
    </div>
    <button
      type="button"
      className="primary-action"
      onClick={() => { void uploadNodeKnowledgeDocuments(); }}
      disabled={savingNodeKnowledge}
    >
      {savingNodeKnowledge ? '处理中...' : '选择并上传文档'}
    </button>
  </section>
)}
```

For link mode, render only `nodeKnowledgeDocuments`, which is already restricted to the selected folder:

```tsx
{nodeKnowledgeDialogMode === 'link' && nodeKnowledgeCanChooseDocuments && (
  <section className="outline-node-knowledge-step">
    <div className="outline-node-knowledge-summary">
      {getKnowledgeBaseCatalogItem(nodeKnowledgeBaseId)?.label} / {nodeKnowledgeFolders.find((folder) => folder.id === nodeKnowledgeFolderId)?.name}
    </div>
    {nodeKnowledgeDocuments.length ? (
      <div className="outline-node-knowledge-document-list">
        {nodeKnowledgeDocuments.map((document) => {
          const selected = draftNodeKnowledgeDocumentIds.includes(document.id);
          return (
            <label className={`outline-knowledge-document compact${selected ? ' is-selected' : ''}`} key={document.id}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleDraftNodeKnowledgeDocument(document.id)}
                disabled={savingNodeKnowledge}
              />
              <span>
                <strong title={document.file_name}>{document.file_name}</strong>
                <small>{document.item_count} 条知识条目</small>
              </span>
            </label>
          );
        })}
      </div>
    ) : (
      <div className="outline-node-knowledge-empty">该目录暂无可用文档。</div>
    )}
    <div className="content-regenerate-actions">
      <button type="button" className="primary-action" onClick={() => { void saveNodeKnowledgeDocuments(); }} disabled={savingNodeKnowledge || !draftNodeKnowledgeDocumentIds.length}>
        {savingNodeKnowledge ? '保存中...' : '保存关联'}
      </button>
    </div>
  </section>
)}
```

If no document is selected, keep “保存关联” disabled and do not overwrite existing links. This makes an empty selection a no-op rather than an accidental bulk removal.

- [ ] **Step 5: Add cancel handling and no-selection empty states**

Add a bottom action row to both modes:

```tsx
<div className="content-regenerate-actions">
  <button type="button" className="secondary-action" onClick={resetNodeKnowledgeDialog} disabled={savingNodeKnowledge}>取消</button>
</div>
```

Use `resetNodeKnowledgeDialog` on cancel and on successful save. Do not persist any temporary selection when the modal is closed before a save/upload action.

- [ ] **Step 6: Run focused helper tests and build**

Run:

```powershell
node --test src/features/technical-plan/services/nodeKnowledgeSelection.test.ts
npm run build
```

Expected: helper tests pass and the client build exits with code 0.

- [ ] **Step 7: Commit the modal render refactor**

```powershell
git add src/features/technical-plan/pages/OutlineEditPage.tsx
git commit -m "feat: simplify step03 knowledge dialogs"
```

### Task 4: Update CSS for the simple cascade layout

**Files:**
- Modify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Replace the old node knowledge dialog selectors**

Replace `.outline-node-knowledge-dialog` and `.outline-node-knowledge-document-dialog` with:

```css
.outline-node-knowledge-flow-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 101;
  display: grid;
  width: min(560px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 40px));
  gap: 14px;
  padding: 20px;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid var(--yb-border-soft);
  border-radius: var(--yb-radius-lg);
  box-shadow: var(--yb-shadow-lg);
  transform: translate(-50%, -50%);
}

.outline-node-knowledge-step {
  display: grid;
  gap: 8px;
  padding-top: 2px;
}

.outline-node-knowledge-field select,
.outline-node-knowledge-field input {
  width: 100%;
  min-height: 36px;
  padding: 8px 10px;
  color: var(--yb-text);
  background: #ffffff;
  border: 1px solid var(--yb-border-soft);
  border-radius: var(--technical-workbench-control-radius);
  outline: none;
}

.outline-node-knowledge-inline-create {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.outline-node-knowledge-summary {
  padding: 8px 10px;
  color: var(--yb-text-soft);
  font-size: 12px;
  line-height: 1.5;
  background: var(--yb-surface);
  border: 1px solid var(--yb-border-soft);
  border-radius: var(--technical-workbench-control-radius);
}

.outline-node-knowledge-document-list {
  display: grid;
  max-height: 300px;
  gap: 6px;
  overflow: auto;
  padding: 2px;
}

.outline-node-knowledge-flow-dialog .content-regenerate-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 640px) {
  .outline-node-knowledge-flow-dialog {
    width: min(100vw - 20px, 560px);
    padding: 16px;
  }

  .outline-node-knowledge-inline-create {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Remove obsolete duplicated dialog rules**

Delete the old duplicated `.outline-node-knowledge-dialog h2/p` rules and the now-unused `.outline-node-document-picker` rules if the JSX no longer references those classes. Keep `.outline-node-knowledge-item`, inherited-state and detail-action styles intact.

- [ ] **Step 3: Run CSS diff validation and build**

Run:

```powershell
git diff --check -- src/styles/feature-technical-plan.css
npm run build
```

Expected: no whitespace errors and build exit code 0.

- [ ] **Step 4: Commit the CSS changes**

```powershell
git add src/styles/feature-technical-plan.css
git commit -m "style: simplify step03 knowledge cascade dialog"
```

### Task 5: Add page structure regression tests

**Files:**
- Modify: `client/src/features/technical-plan/services/workflowLayout.test.ts`

- [ ] **Step 1: Add source-contract assertions for the new behavior**

Add a test that reads `OutlineEditPage.tsx` and `feature-technical-plan.css` and asserts:

```ts
test('STEP 03 目录知识库操作按一级知识库、目录、文档级联选择', () => {
  const source = readFileSync(new URL('../pages/OutlineEditPage.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../../styles/feature-technical-plan.css', import.meta.url), 'utf8');

  assert.match(source, /nodeKnowledgeDialogMode/);
  assert.match(source, /nodeKnowledgeBaseId/);
  assert.match(source, /nodeKnowledgeFolderId/);
  assert.match(source, /handleNodeKnowledgeBaseChange/);
  assert.match(source, /handleNodeKnowledgeFolderChange/);
  assert.match(source, /getFoldersForKnowledgeBase/);
  assert.match(source, /getDocumentsForFolder/);
  assert.match(source, /createFolder\(folderName, nodeKnowledgeBaseId\)/);
  assert.match(source, /选择并上传文档/);
  assert.match(source, /保存关联/);
  assert.match(source, /mergeFolderDocumentSelection/);
  assert.match(source, /selectedDirectKnowledgeDocumentIds/);
  assert.doesNotMatch(source, /knowledgeBase\.createFolder\(folderName\)/);
  assert.doesNotMatch(source, /outline-node-knowledge-document-dialog/);
  assert.match(css, /\.outline-node-knowledge-flow-dialog/);
  assert.match(css, /\.outline-node-knowledge-inline-create/);
  assert.match(css, /\.outline-node-knowledge-document-list/);
});
```

- [ ] **Step 2: Run the focused regression tests**

Run from `client/`:

```powershell
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: all workflow layout tests pass. If an existing source-contract assertion conflicts with the new dialog structure, update only that assertion to the confirmed behavior; do not weaken unrelated tests.

- [ ] **Step 3: Commit the regression test**

```powershell
git add src/features/technical-plan/services/workflowLayout.test.ts
git commit -m "test: cover step03 knowledge cascade layout"
```

### Task 6: Final verification and manual workflow check

**Files:**
- Verify: `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- Verify: `client/src/features/technical-plan/services/nodeKnowledgeSelection.ts`
- Verify: `client/src/styles/feature-technical-plan.css`

- [ ] **Step 1: Run all focused tests**

Run:

```powershell
node --test src/features/technical-plan/services/nodeKnowledgeSelection.test.ts
node --test src/features/technical-plan/services/workflowLayout.test.ts
```

Expected: both commands exit with code 0 and report zero failures.

- [ ] **Step 2: Run the complete Renderer build**

Run:

```powershell
npm run build
```

Expected: `tsc --noEmit` and `vite build` complete successfully. Existing chunk-size warnings are acceptable if the exit code is 0.

- [ ] **Step 3: Check the final diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Only the planned Renderer/helper/test/style files remain modified; do not stage or revert unrelated user changes.

- [ ] **Step 4: Manually verify the four key flows with `npm run dev`**

Use the existing development server if `127.0.0.1:5173` is already occupied; do not terminate an unrelated process. In STEP 03:

1. Open “新增知识库”, select “国标知识库”, select an existing directory, click “选择并上传文档”, and confirm the directory appears under the current node after upload.
2. Open “新增知识库”, select “省标知识库”, choose “+ 新建目录”, create a directory, cancel the file picker, and confirm the empty directory remains associated.
3. Open “关联文档”, select one一级知识库 and one directory, confirm only that directory’s `success` documents appear, select multiple documents, save, and confirm the detail list shows `一级知识库 / 目录 / 文档`.
4. Repeat association on a second directory and confirm the first directory’s document links remain; switch the一级知识库 and confirm directory/document selections clear.

- [ ] **Step 5: Commit only if all verification passes**

```powershell
git add src/features/technical-plan/pages/OutlineEditPage.tsx src/features/technical-plan/services/nodeKnowledgeSelection.ts src/features/technical-plan/services/nodeKnowledgeSelection.test.ts src/features/technical-plan/services/workflowLayout.test.ts src/styles/feature-technical-plan.css
git commit -m "feat: optimize step03 node knowledge selection"
```

Do not commit generated `dist/` output or unrelated pre-existing changes.
