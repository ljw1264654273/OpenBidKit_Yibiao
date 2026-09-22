// @ts-expect-error Vitest is provided by the requested npx test runner, not the client runtime dependencies.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canCreateExpansionProject,
  confirmExpansionImport,
  discardExpansionImport,
  getExpansionProjectDefaultName,
  getFilePathsFromFileList,
  prepareExpansionImport,
} from './expansionProjectCreate';
import type {
  ExpansionImportDocumentPreview,
  ExpansionProjectImportPreview,
} from '../types';

type DocumentPreview = ExpansionImportDocumentPreview;
type SuccessfulDocumentPreview = Extract<DocumentPreview, { success: true }>;
type ImportPreview = ExpansionProjectImportPreview;

function documentPreview(overrides: Partial<SuccessfulDocumentPreview> = {}): SuccessfulDocumentPreview {
  return {
    success: true,
    fileName: '原方案.docx',
    parserLabel: 'MinerU',
    fileHash: 'file-hash',
    contentHash: 'content-hash',
    contentPreview: '# 原方案\n\n第一章',
    markdownChars: 1234,
    size: 4567,
    modifiedAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

function failedDocumentPreview(
  overrides: Omit<Extract<DocumentPreview, { success: false }>, 'success'> = {},
): Extract<DocumentPreview, { success: false }> {
  return {
    success: false,
    ...overrides,
  };
}

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    success: true,
    canceled: false,
    token: 'expansion-token',
    tender: {
      success: true,
      requestedCount: 2,
      documents: [
        documentPreview({ fileName: '招标文件-1.docx' }),
        documentPreview({ fileName: '招标文件-2.pdf' }),
      ],
      errors: [],
    },
    originalPlan: documentPreview(),
    ...overrides,
  };
}

function installBridge() {
  const bridge = {
    prepareExpansionImport: vi.fn(),
    confirmExpansionImport: vi.fn(),
    discardExpansionImport: vi.fn(),
    file: {
      getPathForFile: vi.fn(),
    },
  };
  vi.stubGlobal('window', { yibiao: { bidProject: bridge, file: bridge.file } });
  return bridge;
}

describe('expansion project import state helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires both a complete tender import and a successful original plan', () => {
    expect(canCreateExpansionProject(preview())).toBe(true);
    expect(canCreateExpansionProject(preview({
      tender: {
        success: true,
        requestedCount: 0,
        documents: [],
        errors: [],
      },
    }))).toBe(false);
    expect(canCreateExpansionProject(preview({
      originalPlan: failedDocumentPreview({ message: '原方案解析失败' }),
    }))).toBe(false);
  });

  it('derives an editable project name from the first successful tender document', () => {
    expect(getExpansionProjectDefaultName(preview())).toBe('招标文件-1');
    expect(getExpansionProjectDefaultName(preview({
      tender: {
        success: false,
        requestedCount: 1,
        documents: [failedDocumentPreview({ fileName: '招标文件.docx' })],
        errors: ['招标文件解析失败'],
      },
    }))).toBe('原方案');
    expect(getExpansionProjectDefaultName(preview({
      tender: {
        success: false,
        requestedCount: 0,
        documents: [],
        errors: ['未选择招标文件'],
      },
      originalPlan: failedDocumentPreview({ fileName: '原方案.docx' }),
    }))).toBe('扩写项目');
  });

  it('rejects successful documents when required metadata is missing', () => {
    const requiredFields: Array<keyof DocumentPreview> = [
      'fileName',
      'fileHash',
      'contentHash',
      'parserLabel',
      'contentPreview',
      'markdownChars',
      'size',
      'modifiedAt',
    ];

    for (const field of requiredFields) {
      const incompleteDocument = documentPreview();
      delete (incompleteDocument as Partial<SuccessfulDocumentPreview>)[field];
      expect(canCreateExpansionProject(preview({
        tender: {
          success: true,
          requestedCount: 2,
          documents: [
            incompleteDocument,
            documentPreview({ fileName: '招标文件-2.pdf' }),
          ],
          errors: [],
        },
      }))).toBe(false);

      const incompleteOriginalPlan = documentPreview();
      delete (incompleteOriginalPlan as Partial<SuccessfulDocumentPreview>)[field];
      expect(canCreateExpansionProject(preview({
        originalPlan: incompleteOriginalPlan,
      }))).toBe(false);
    }
  });

  it('rejects a preview when either input group is missing', () => {
    expect(canCreateExpansionProject(preview({
      tender: {
        success: true,
        requestedCount: 0,
        documents: [],
        errors: [],
      },
    }))).toBe(false);
    expect(canCreateExpansionProject(preview({
      originalPlan: failedDocumentPreview({ message: '未选择原方案' }),
    }))).toBe(false);
  });

  it('rejects tender partial success, errors, count mismatch, and failed documents', () => {
    const cases: ImportPreview[] = [
      preview({
        tender: {
          success: false,
          requestedCount: 2,
          documents: [documentPreview({ fileName: '仅成功的一份.docx' })],
          errors: ['第二份文件解析失败'],
        },
      }),
      preview({
        tender: {
          success: true,
          requestedCount: 2,
          documents: [
            documentPreview({ fileName: '招标文件-1.docx' }),
            documentPreview({ fileName: '招标文件-2.pdf' }),
          ],
          errors: ['存在额外解析警告'],
        },
      }),
      preview({
        tender: {
          success: true,
          requestedCount: 2,
          documents: [documentPreview({ fileName: '只有一份.docx' })],
          errors: [],
        },
      }),
      preview({
        tender: {
          success: true,
          requestedCount: 2,
          documents: [
            documentPreview({ fileName: '招标文件-1.docx' }),
            failedDocumentPreview({ fileName: '招标文件-2.pdf', message: '解析失败' }),
          ],
          errors: [],
        },
      }),
    ];

    for (const importPreview of cases) {
      expect(canCreateExpansionProject(importPreview)).toBe(false);
    }
  });

  it('rejects canceled previews and proves they do not expose a confirmable token', () => {
    const bridge = installBridge();
    const canceledPreview = preview({
      success: false,
      canceled: true,
      token: null,
      message: '用户取消选择',
    });
    bridge.prepareExpansionImport.mockResolvedValue(canceledPreview);

    return prepareExpansionImport([], []).then((result) => {
      expect(result).toEqual(canceledPreview);
      expect(result.canceled).toBe(true);
      expect(result.token ?? null).toBeNull();
      expect(canCreateExpansionProject(result)).toBe(false);
      expect(bridge.confirmExpansionImport).not.toHaveBeenCalled();
    });
  });

  it('rejects a top-level failed preview that is not canceled and has no token', () => {
    const failedPreview = preview({
      success: false,
      canceled: false,
      token: null,
      message: '文件解析失败',
    });

    expect(failedPreview.token).toBeNull();
    expect(canCreateExpansionProject(failedPreview)).toBe(false);
  });

  it('forwards empty file selections and preserves the failed preview returned by the bridge', async () => {
    const bridge = installBridge();
    const missingFilesPreview = preview({
      success: false,
      canceled: false,
      token: null,
      message: '请选择招标文件和原方案',
      tender: {
        success: false,
        requestedCount: 0,
        documents: [],
        errors: ['未选择招标文件'],
      },
      originalPlan: failedDocumentPreview({ message: '未选择原方案' }),
    });
    bridge.prepareExpansionImport.mockResolvedValue(missingFilesPreview);

    await expect(prepareExpansionImport([], [])).resolves.toBe(missingFilesPreview);
    expect(bridge.prepareExpansionImport).toHaveBeenCalledWith({
      tenderFilePaths: [],
      originalPlanFilePaths: [],
    });
    expect(missingFilesPreview.token).toBeNull();
    expect(canCreateExpansionProject(missingFilesPreview)).toBe(false);
  });

  it('forwards prepare, confirm, and discard calls through the bid project bridge', async () => {
    const bridge = installBridge();
    const prepared = preview();
    const project = { projectId: 'project-1' };
    const discarded = { success: true };
    bridge.prepareExpansionImport.mockResolvedValue(prepared);
    bridge.confirmExpansionImport.mockResolvedValue(project);
    bridge.discardExpansionImport.mockResolvedValue(discarded);

    await expect(prepareExpansionImport(['tender.docx'], ['original.docx'])).resolves.toBe(prepared);
    await expect(confirmExpansionImport('expansion-token', { projectName: '扩写项目' })).resolves.toBe(project);
    await expect(discardExpansionImport('expansion-token')).resolves.toBe(discarded);

    expect(bridge.prepareExpansionImport).toHaveBeenCalledWith({
      tenderFilePaths: ['tender.docx'],
      originalPlanFilePaths: ['original.docx'],
    });
    expect(bridge.confirmExpansionImport).toHaveBeenCalledWith('expansion-token', { projectName: '扩写项目' });
    expect(bridge.discardExpansionImport).toHaveBeenCalledWith('expansion-token');
  });

  it('converts a FileList through the preload file path helper and drops empty paths', () => {
    const bridge = installBridge();
    const first = { name: '招标文件.docx' } as File;
    const second = { name: '无法取得路径.pdf' } as File;
    bridge.file.getPathForFile.mockImplementation((file: File) => (
      file === first ? 'D:\\资料\\招标文件.docx' : ''
    ));
    const files = { 0: first, 1: second, length: 2 } as unknown as FileList;

    expect(getFilePathsFromFileList(files)).toEqual(['D:\\资料\\招标文件.docx']);
    expect(bridge.file.getPathForFile).toHaveBeenCalledTimes(2);
  });
});
