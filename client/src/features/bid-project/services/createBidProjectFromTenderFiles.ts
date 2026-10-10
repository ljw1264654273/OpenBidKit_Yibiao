import type { ToastOptions, ToastType } from '../../../shared/ui/ToastProvider';
import type { BidProject } from '../types';
import { bidProjectStorage } from './bidProjectStorage';

interface CreateBidProjectOptions {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => number;
  onProjectOpen: (project: BidProject) => Promise<void>;
  filePaths?: string[];
}

export async function createBidProjectFromTenderFiles({ showToast, onProjectOpen, filePaths: requestedFilePaths }: CreateBidProjectOptions) {
  try {
    const selected = await window.yibiao?.file.selectDuplicateCheckFiles({ multiple: true, filePaths: requestedFilePaths });
    const filePaths = selected?.files?.map((file) => file.file_path).filter(Boolean) || [];
    if (!filePaths.length) return;
    const preview = await bidProjectStorage.prepareImport(filePaths);
    if (!preview.success || !preview.token) throw new Error(preview.message || '准备招标文件失败');
    if (preview.matches?.length) {
      showToast(
        `检测到这份招标文件已有 ${preview.matches.length} 份同源标书，本次将继续创建第 ${Math.max(...preview.matches.map((item) => item.sourceSequence || 1)) + 1} 份。`,
        'info',
        { duration: 5000 },
      );
    }
    const project = await window.yibiao!.bidProject.confirmImport(preview.token, {
      projectName: preview.fileName || '未命名标书',
      projectType: 'technical-plan',
    });
    await onProjectOpen(project);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '新建标书失败', 'error');
  }
}
