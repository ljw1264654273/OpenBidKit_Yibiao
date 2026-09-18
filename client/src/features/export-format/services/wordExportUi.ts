import type { OutlineItem } from '../../../shared/types';

function collectLeafItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => item.children?.length ? collectLeafItems(item.children) : [item]);
}

export function hasGeneratedContent(items: OutlineItem[]) {
  return collectLeafItems(items).some((item) => String(item.content || '').trim());
}

export function countOutlineMermaidDiagrams(items: OutlineItem[]) {
  return collectLeafItems(items).reduce((sum, item) => {
    const content = String(item.content || '');
    const mermaidBlocks = (content.match(/```mermaid[\s\S]*?```/gi) || []).length;
    const mermaidInkImages = (content.match(/https:\/\/mermaid\.ink\/img\//gi) || []).length;
    return sum + mermaidBlocks + mermaidInkImages;
  }, 0);
}
