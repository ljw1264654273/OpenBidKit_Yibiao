const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createKnowledgeBaseService } = require('./knowledgeBaseService.cjs');
const { getKnowledgeBaseDir } = require('../utils/paths.cjs');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
  };
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`锁文件进程启动超时：${output}`)), 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!output.includes('READY')) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (output.includes('READY')) return;
      clearTimeout(timer);
      reject(new Error(`锁文件进程提前退出，退出码 ${code}：${output}`));
    });
  });
}

test('deletes a knowledge-base document when Windows temporarily locks its source file', {
  skip: process.platform !== 'win32',
}, async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'yibiao-knowledge-delete-'));
  const app = createApp(userDataPath);
  const document = {
    id: 'doc-locked-source',
    folder_id: 'folder-delete-test',
    file_name: '只读占用文件.pdf',
    document_dir: 'folders/folder-delete-test/documents/doc-locked-source',
    source_path: 'folders/folder-delete-test/documents/doc-locked-source/source.pdf',
    markdown_path: 'folders/folder-delete-test/documents/doc-locked-source/content.md',
    status: 'error',
  };
  const documentDir = path.join(getKnowledgeBaseDir(app), document.document_dir);
  const sourcePath = path.join(getKnowledgeBaseDir(app), document.source_path);
  fs.mkdirSync(documentDir, { recursive: true });
  fs.writeFileSync(sourcePath, 'locked source');
  execFileSync('attrib', ['+R', sourcePath]);

  const lockerScript = [
    '$stream = [System.IO.File]::Open($env:YIBIAO_LOCK_FILE, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)',
    "[Console]::Out.WriteLine('READY')",
    '[Console]::Out.Flush()',
    'try { [System.Threading.Thread]::Sleep(60000) } finally { $stream.Dispose() }',
  ].join('; ');
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lockerScript], {
    env: { ...process.env, YIBIAO_LOCK_FILE: sourcePath },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let deletedDocumentId = null;
  const store = {
    recoverInterruptedDocuments() {
      return [];
    },
    getDocument(documentId) {
      assert.equal(documentId, document.id);
      return document;
    },
    deleteDocument(documentId) {
      deletedDocumentId = documentId;
      return document;
    },
  };

  try {
    await waitForReady(locker);
    const service = createKnowledgeBaseService({
      app,
      configStore: { load: () => ({}) },
      knowledgeBaseStore: store,
    });

    const result = service.deleteDocument(document.id);

    assert.deepEqual(result, { success: true, message: `已删除文档“${document.file_name}”` });
    assert.equal(deletedDocumentId, document.id);
    assert.equal(fs.existsSync(documentDir), false);
  } finally {
    if (locker.exitCode === null) {
      spawnSync('taskkill', ['/PID', String(locker.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    if (fs.existsSync(sourcePath)) {
      execFileSync('attrib', ['-R', sourcePath]);
    }
    fs.rmSync(userDataPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
