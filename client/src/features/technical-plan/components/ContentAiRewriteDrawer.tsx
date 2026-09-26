import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import type { ContentAiTextCandidate, InlineImageCandidate } from '../../../shared/types/ipc';
import type { ContentAiEditSnapshot } from '../services/contentAiEdit';
import type { ContentAiRewriteMode } from './ContentAiRewriteMenu';

export type ContentAiCandidate = ContentAiTextCandidate | InlineImageCandidate;
type ImageSource = 'ai' | 'local' | 'clipboard';

interface ContentAiRewriteDrawerProps {
  open: boolean;
  mode: ContentAiRewriteMode | null;
  chapterTitle: string;
  snapshot: ContentAiEditSnapshot | null;
  candidate: ContentAiCandidate | null;
  busy: boolean;
  error: string;
  imageModelAvailable: boolean;
  onGenerateText: (instruction: string) => void;
  onGenerateImage: (input: { imageTitle: string; imageDescription: string; caption: string }) => void;
  onImportFile: (file: File, input: { imageTitle: string; caption: string }) => void;
  onImportDataUrl: (dataUrl: string, input: { imageTitle: string; caption: string }) => void;
  onApply: (caption?: string) => void;
  onDiscard: () => void;
}

const quickInstructions = ['更专业', '扩写', '更简洁', '增强可执行性'];

function isImageCandidate(candidate: ContentAiCandidate | null): candidate is InlineImageCandidate {
  return Boolean(candidate && 'assetUrl' in candidate);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'));
    reader.readAsDataURL(file);
  });
}

function ContentAiRewriteDrawer(props: ContentAiRewriteDrawerProps) {
  const {
    open, mode, chapterTitle, snapshot, candidate, busy, error, imageModelAvailable,
    onGenerateText, onGenerateImage, onImportFile, onImportDataUrl, onApply, onDiscard,
  } = props;
  const [instruction, setInstruction] = useState('');
  const [imageSource, setImageSource] = useState<ImageSource>('ai');
  const [imageTitle, setImageTitle] = useState('');
  const [imageDescription, setImageDescription] = useState('');
  const [caption, setCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setInstruction('');
    setImageSource('ai');
    setImageTitle(chapterTitle ? `${chapterTitle}示意图` : '正文插图');
    setImageDescription('');
    setCaption(chapterTitle ? `${chapterTitle}示意图` : '正文插图');
  }, [chapterTitle, mode, open]);

  const importFile = (file?: File) => {
    if (!file) return;
    const fallbackTitle = file.name.replace(/\.[^.]+$/, '') || '正文插图';
    onImportFile(file, {
      imageTitle: imageTitle.trim() || fallbackTitle,
      caption: caption.trim() || imageTitle.trim() || fallbackTitle,
    });
  };

  const handlePaste = async (event: ClipboardEvent<HTMLDivElement>) => {
    const image = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const dataUrl = await fileToDataUrl(image);
    onImportDataUrl(dataUrl, {
      imageTitle: imageTitle.trim() || '剪贴板图片',
      caption: caption.trim() || imageTitle.trim() || '剪贴板图片',
    });
  };

  const selectionSummary = snapshot
    ? snapshot.selectionEnd > snapshot.selectionStart
      ? `已选择 ${snapshot.selectionEnd - snapshot.selectionStart} 个字符`
      : `光标位置 ${snapshot.selectionStart}`
    : '尚未取得光标位置';

  return (
    <Dialog.Root open={open} modal={false}>
      <Dialog.Portal>
        <Dialog.Content className="content-ai-rewrite-drawer" aria-describedby={undefined} onEscapeKeyDown={onDiscard}>
          <header>
            <div>
              <span className="section-kicker">AI 辅助编辑</span>
              <Dialog.Title>{mode === 'rewrite' ? '改写选中内容' : mode === 'continue' ? '从光标处续写' : '在光标处插入图片'}</Dialog.Title>
              <p>{chapterTitle} · {selectionSummary}</p>
            </div>
            <button type="button" className="content-ai-rewrite-close" onClick={onDiscard} aria-label="关闭 AI 改写">×</button>
          </header>

          <div className="content-ai-rewrite-body" onPaste={handlePaste}>
            {mode !== 'image' ? (
              <>
                <label className="content-ai-rewrite-field">
                  <span>改写要求</span>
                  <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={mode === 'rewrite' ? '例如：突出执行步骤，保持原有事实和数据。' : '例如：补充质量保障措施和验收安排。'} />
                </label>
                <div className="content-ai-rewrite-quick">
                  {quickInstructions.map((item) => <button type="button" key={item} onClick={() => setInstruction(item)}>{item}</button>)}
                </div>
                <button type="button" className="primary-action" disabled={busy} onClick={() => onGenerateText(instruction)}>
                  {busy ? 'AI 生成中…' : candidate ? '重新生成' : '生成候选'}
                </button>
              </>
            ) : (
              <>
                <div className="content-ai-image-tabs" role="tablist">
                  {([
                    ['ai', 'AI 生成'],
                    ['local', '本地图片'],
                    ['clipboard', '剪贴板图片'],
                  ] as const).map(([value, label]) => (
                    <button type="button" role="tab" aria-selected={imageSource === value} className={imageSource === value ? 'is-active' : ''} key={value} onClick={() => setImageSource(value)}>{label}</button>
                  ))}
                </div>
                <label className="content-ai-rewrite-field">
                  <span>图片标题</span>
                  <input value={imageTitle} onChange={(event) => { setImageTitle(event.target.value); if (!caption) setCaption(event.target.value); }} />
                </label>
                <label className="content-ai-rewrite-field">
                  <span>图注</span>
                  <input value={caption} onChange={(event) => setCaption(event.target.value)} />
                </label>
                {imageSource === 'ai' ? (
                  <>
                    <label className="content-ai-rewrite-field">
                      <span>图片描述</span>
                      <textarea value={imageDescription} onChange={(event) => setImageDescription(event.target.value)} placeholder="描述图片需要表达的流程、场景或结构。" />
                    </label>
                    {!imageModelAvailable && <p className="content-ai-rewrite-hint is-warning">生图模型尚未测试可用，可改用本地或剪贴板图片。</p>}
                    <button type="button" className="primary-action" disabled={busy || !imageModelAvailable || !imageTitle.trim()} onClick={() => onGenerateImage({ imageTitle, imageDescription, caption })}>
                      {busy ? '图片生成中…' : candidate ? '重新生成' : '生成图片'}
                    </button>
                  </>
                ) : imageSource === 'local' ? (
                  <div
                    className="content-ai-image-dropzone"
                    onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
                    onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); importFile(event.dataTransfer.files[0]); }}
                  >
                    <strong>拖入 PNG、JPG 或 WebP 图片</strong>
                    <span>也可以从本机选择文件</span>
                    <button type="button" className="secondary-action" disabled={busy} onClick={() => fileInputRef.current?.click()}>选择图片</button>
                    <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden onChange={(event) => importFile(event.target.files?.[0])} />
                  </div>
                ) : (
                  <div className="content-ai-image-dropzone is-clipboard" tabIndex={0}>
                    <strong>在此区域按 Ctrl+V 粘贴图片</strong>
                    <span>普通文本粘贴不会被拦截</span>
                  </div>
                )}
              </>
            )}

            {error && <p className="content-ai-rewrite-error">{error}</p>}
            {candidate && (
              <section className="content-ai-candidate-preview">
                <div>
                  <strong>候选预览</strong>
                  <span>确认后仅应用到当前未保存草稿</span>
                </div>
                {isImageCandidate(candidate) ? (
                  <img src={candidate.assetUrl} alt={candidate.imageTitle} />
                ) : (
                  <>
                    {candidate.mode === 'rewrite' && <pre className="is-original">{snapshot?.selectedText}</pre>}
                    <pre>{candidate.mode === 'rewrite' ? candidate.replacementText : candidate.insertionText}</pre>
                  </>
                )}
              </section>
            )}
          </div>

          <footer>
            <button type="button" className="secondary-action" disabled={busy} onClick={onDiscard}>放弃</button>
            <button type="button" className="primary-action" disabled={!candidate || busy} onClick={() => onApply(caption)}>应用到草稿</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default ContentAiRewriteDrawer;
