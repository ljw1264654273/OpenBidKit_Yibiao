import { useEffect, useMemo, useState } from 'react';
import { AppDialog, useToast } from '../../../shared/ui';
import {
  KNOWLEDGE_BASE_CATALOG,
  type KnowledgeBaseId,
} from '../../knowledge-base/knowledgeBaseCatalog';
import type { KnowledgeBaseIndex } from '../../knowledge-base/types';
import type { RemoteKnowledgeScope } from '../types';
import { formatKnowledgeReferenceSummary } from '../remoteKnowledgeSelection';
import {
  buildKnowledgeSelectionSummary,
  filterKnowledgeReferenceGroups,
  getKnowledgeLocationOptions,
  toggleDocumentKnowledgeSelection,
  toggleFolderKnowledgeSelection,
  toggleVisibleKnowledgeSelection,
  type KnowledgeReferenceCategoryFilter,
} from '../services/knowledgeReferenceSelection';
import RemoteKnowledgePicker from './RemoteKnowledgePicker';

const emptyKnowledgeIndex: KnowledgeBaseIndex = { folders: [], documents: [] };

interface Props {
  referenceKnowledgeDocumentIds: string[];
  remoteKnowledgeScopes: RemoteKnowledgeScope[];
  disabled?: boolean;
  onChange: (referenceKnowledgeDocumentIds: string[], remoteKnowledgeScopes: RemoteKnowledgeScope[]) => Promise<void>;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export default function KnowledgeReferenceQuickConfig({
  referenceKnowledgeDocumentIds,
  remoteKnowledgeScopes,
  disabled = false,
  onChange,
}: Props) {
  const [index, setIndex] = useState<KnowledgeBaseIndex>(emptyKnowledgeIndex);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceTab, setSourceTab] = useState<'local' | 'remote'>('local');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<KnowledgeReferenceCategoryFilter>('all');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [keyword, setKeyword] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [draftLocalDocumentIds, setDraftLocalDocumentIds] = useState<string[]>(referenceKnowledgeDocumentIds);
  const [draftRemoteScopes, setDraftRemoteScopes] = useState<RemoteKnowledgeScope[]>(remoteKnowledgeScopes);
  const { showToast } = useToast();

  const loadKnowledgeIndex = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const nextIndex = await window.yibiao?.knowledgeBase.list({ allKnowledgeBases: true });
      setIndex(nextIndex || emptyKnowledgeIndex);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取本地知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadKnowledgeIndex();
    return window.yibiao?.knowledgeBase.onEvent(() => { void loadKnowledgeIndex(); });
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraftLocalDocumentIds(referenceKnowledgeDocumentIds);
    setDraftRemoteScopes(remoteKnowledgeScopes);
  }, [open, referenceKnowledgeDocumentIds, remoteKnowledgeScopes]);

  const locationOptions = useMemo(
    () => getKnowledgeLocationOptions(index, knowledgeBaseId),
    [index, knowledgeBaseId],
  );
  const cityOptions = useMemo(() => {
    if (!province) return locationOptions.cities;
    return uniqueIds(index.folders
      .filter((folder) => (knowledgeBaseId === 'all' || folder.knowledge_base_id === knowledgeBaseId) && folder.province === province)
      .map((folder) => folder.city || ''));
  }, [index, knowledgeBaseId, locationOptions.cities, province]);
  const visibleGroups = useMemo(
    () => filterKnowledgeReferenceGroups(index, { knowledgeBaseId, province, city, keyword }),
    [city, index, keyword, knowledgeBaseId, province],
  );
  const visibleDocumentIds = useMemo(
    () => visibleGroups.flatMap((group) => group.documents.map((document) => document.id)),
    [visibleGroups],
  );
  const allVisibleSelected = visibleDocumentIds.length > 0
    && visibleDocumentIds.every((id) => draftLocalDocumentIds.includes(id));
  const selectedLocalSummary = useMemo(
    () => buildKnowledgeSelectionSummary(index, draftLocalDocumentIds),
    [draftLocalDocumentIds, index],
  );
  const savedLocalSummary = useMemo(
    () => buildKnowledgeSelectionSummary(index, referenceKnowledgeDocumentIds),
    [index, referenceKnowledgeDocumentIds],
  );
  const remoteDocumentCount = draftRemoteScopes.reduce(
    (count, scope) => count + (scope.mode === 'all' ? 1 : scope.documents.length),
    0,
  );
  const selectedItemCount = draftLocalDocumentIds.length + remoteDocumentCount;
  const savedSummaryLabels = [
    ...savedLocalSummary.map((item) => item.label),
    ...remoteKnowledgeScopes.flatMap((scope) => scope.mode === 'all'
      ? [`远程 / ${scope.knowledgeBaseName}`]
      : scope.documents.map((document) => `远程 / ${scope.knowledgeBaseName} / ${document.title}`)),
  ];
  const hasSavedReferences = referenceKnowledgeDocumentIds.length > 0 || remoteKnowledgeScopes.length > 0;

  const handleCategoryChange = (nextId: KnowledgeReferenceCategoryFilter) => {
    setKnowledgeBaseId(nextId);
    setProvince('');
    setCity('');
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const confirmSelection = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onChange(uniqueIds(draftLocalDocumentIds), draftRemoteScopes);
      setOpen(false);
      showToast(selectedItemCount ? '参考知识库已更新' : '已设置为不使用参考知识库', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存参考知识库失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeRemoteItem = (scopeId: string, documentId?: string) => {
    setDraftRemoteScopes((current) => current.flatMap((scope) => {
      if (scope.knowledgeBaseId !== scopeId) return [scope];
      if (scope.mode === 'all' || !documentId) return [];
      const documents = scope.documents.filter((document) => document.knowledgeId !== documentId);
      return documents.length ? [{ ...scope, documents }] : [];
    }));
  };

  return (
    <>
      <div className="quick-config-row knowledge-reference-quick-row">
        <div className="quick-config-label">
          <strong>参考知识库</strong>
          <small>目录与正文生成参考资料</small>
        </div>
        <div className="quick-config-row-body knowledge-reference-quick-body">
          <div className="knowledge-reference-quick-summary" aria-label="当前参考知识库">
            {savedSummaryLabels.length ? (
              <>
                {savedSummaryLabels.slice(0, 3).map((label) => <span className="knowledge-reference-chip" key={label} title={label}>{label}</span>)}
                {savedSummaryLabels.length > 3 && <span className="knowledge-reference-chip is-count">+{savedSummaryLabels.length - 3}</span>}
              </>
            ) : hasSavedReferences ? (
              <span className="knowledge-reference-chip" title={formatKnowledgeReferenceSummary(referenceKnowledgeDocumentIds.length, remoteKnowledgeScopes)}>
                {formatKnowledgeReferenceSummary(referenceKnowledgeDocumentIds.length, remoteKnowledgeScopes)}
              </span>
            ) : (
              <span className="quick-config-value is-muted">未选择知识库（可选）</span>
            )}
          </div>
          <span className="quick-config-spacer" />
          <span className="quick-config-note">
            {formatKnowledgeReferenceSummary(referenceKnowledgeDocumentIds.length, remoteKnowledgeScopes)}
          </span>
          <button type="button" className="secondary-action" disabled={disabled} onClick={() => setOpen(true)}>
            选择知识库
          </button>
        </div>
      </div>

      <AppDialog
        open={open}
        onOpenChange={(nextOpen) => { if (!saving) setOpen(nextOpen); }}
        kicker="快速配置"
        title="选择参考知识库"
        description="选择的资料将用于目录规划、全局事实提取和正文生成。"
        cardClassName="knowledge-reference-dialog"
        preventClose={saving}
        actions={(
          <>
            <span className="knowledge-reference-dialog-footnote">仅使用处理完成、可用于生成的文档</span>
            <button type="button" className="secondary-action" disabled={saving} onClick={() => setOpen(false)}>取消</button>
            <button type="button" className="primary-action" disabled={saving} onClick={() => { void confirmSelection(); }}>
              {saving ? '保存中...' : selectedItemCount ? `确认选择 ${selectedItemCount} 项` : '确认不使用知识库'}
            </button>
          </>
        )}
      >
        <div className="knowledge-reference-dialog-content">
          <div className="knowledge-reference-source-tabs" role="tablist" aria-label="知识库来源">
            <button type="button" role="tab" aria-selected={sourceTab === 'local'} className={sourceTab === 'local' ? 'is-active' : ''} onClick={() => setSourceTab('local')}>本地知识库</button>
            <button type="button" role="tab" aria-selected={sourceTab === 'remote'} className={sourceTab === 'remote' ? 'is-active' : ''} onClick={() => setSourceTab('remote')}>远程知识库</button>
            <span>已选择 {selectedItemCount} 项</span>
          </div>

          {sourceTab === 'local' && (
            <div className="knowledge-reference-local-shell">
              <div className="knowledge-reference-filters">
                <div className="knowledge-reference-category-filter" aria-label="知识库类型">
                  <span>类型</span>
                  <button type="button" className={knowledgeBaseId === 'all' ? 'is-active' : ''} onClick={() => handleCategoryChange('all')}>全部</button>
                  {KNOWLEDGE_BASE_CATALOG.map((category) => (
                    <button type="button" className={knowledgeBaseId === category.id ? 'is-active' : ''} key={category.id} onClick={() => handleCategoryChange(category.id)}>{category.label.replace(/文档$/, '')}</button>
                  ))}
                </div>
                <div className="knowledge-reference-location-filter">
                  <span>归属地</span>
                  <select aria-label="选择省份" value={province} onChange={(event) => { setProvince(event.target.value); setCity(''); }} disabled={knowledgeBaseId === 'national-standard'}>
                    <option value="">全部省份</option>
                    {locationOptions.provinces.map((item) => <option value={item} key={item}>{item}</option>)}
                  </select>
                  <select aria-label="选择城市" value={city} onChange={(event) => setCity(event.target.value)} disabled={knowledgeBaseId === 'national-standard' || !cityOptions.length}>
                    <option value="">全部城市</option>
                    {cityOptions.map((item) => <option value={item} key={item}>{item}</option>)}
                  </select>
                  <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索文件夹或文档" aria-label="搜索文件夹或文档" />
                </div>
              </div>

              <div className="knowledge-reference-dialog-body">
                <section className="knowledge-reference-browser" aria-label="可选知识库">
                  <div className="knowledge-reference-pane-head">
                    <div><strong>可选知识库</strong><small>{visibleGroups.length} 个文件夹，{visibleDocumentIds.length} 个可用文档</small></div>
                    <button type="button" className="text-button" disabled={!visibleDocumentIds.length} onClick={() => setDraftLocalDocumentIds((current) => toggleVisibleKnowledgeSelection(current, visibleGroups))}>
                      {allVisibleSelected ? '取消当前筛选结果' : '选择当前筛选结果'}
                    </button>
                  </div>
                  <div className="knowledge-reference-folder-list">
                    {loading && <div className="outline-knowledge-empty">正在读取本地知识库...</div>}
                    {!loading && loadError && <div className="outline-knowledge-error">{loadError}<button type="button" onClick={() => { void loadKnowledgeIndex(); }}>重试</button></div>}
                    {!loading && !loadError && !visibleGroups.length && <div className="outline-knowledge-empty">当前筛选条件下没有可用文档。</div>}
                    {visibleGroups.map(({ folder, documents }) => {
                      const expanded = expandedFolderIds.has(folder.id) || Boolean(keyword.trim());
                      const selectedCount = documents.filter((document) => draftLocalDocumentIds.includes(document.id)).length;
                      const allSelected = documents.length > 0 && selectedCount === documents.length;
                      const partiallySelected = selectedCount > 0 && !allSelected;
                      return (
                        <section className="knowledge-reference-folder" key={folder.id}>
                          <div className="knowledge-reference-folder-head">
                            <button type="button" className="knowledge-reference-folder-toggle" onClick={() => toggleFolder(folder.id)} aria-expanded={expanded} disabled={Boolean(keyword.trim())}>
                              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                              <strong>{folder.name}</strong>
                              <small>{[folder.province, folder.city].filter(Boolean).join(' · ') || '全国'} · {selectedCount}/{documents.length}</small>
                            </button>
                            <label title={partiallySelected ? '已选择部分文档' : undefined}>
                              <input type="checkbox" checked={allSelected} ref={(node) => { if (node) node.indeterminate = partiallySelected; }} onChange={() => setDraftLocalDocumentIds((current) => toggleFolderKnowledgeSelection(current, documents))} />
                              <span>整个文件夹</span>
                            </label>
                          </div>
                          {expanded && (
                            <div className="knowledge-reference-document-list">
                              {documents.map((document) => {
                                const selected = draftLocalDocumentIds.includes(document.id);
                                return (
                                  <label className={selected ? 'is-selected' : ''} key={document.id}>
                                    <input type="checkbox" checked={selected} onChange={() => setDraftLocalDocumentIds((current) => toggleDocumentKnowledgeSelection(current, document.id))} />
                                    <span title={document.file_name}>{document.file_name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </section>

                <aside className="knowledge-reference-selected-pane" aria-label="已选择">
                  <div className="knowledge-reference-pane-head">
                    <div><strong>已选择</strong><small>{selectedLocalSummary.length} 个本地范围，{draftRemoteScopes.length} 个远程范围</small></div>
                    <button type="button" className="text-button" disabled={!selectedItemCount} onClick={() => { setDraftLocalDocumentIds([]); setDraftRemoteScopes([]); }}>清空全部</button>
                  </div>
                  <div className="knowledge-reference-selected-list">
                    {!selectedItemCount && <div className="outline-knowledge-empty compact">尚未选择参考知识库。</div>}
                    {selectedLocalSummary.map((item) => (
                      <div className="knowledge-reference-selected-item" key={item.key}>
                        <div><span className="outline-knowledge-badge">本地</span><strong title={item.label}>{item.label}</strong><small>{item.documentCount} 个文档</small></div>
                        <button type="button" aria-label={`移除 ${item.label}`} onClick={() => setDraftLocalDocumentIds((current) => current.filter((id) => !item.documentIds.includes(id)))}>×</button>
                      </div>
                    ))}
                    {draftRemoteScopes.flatMap((scope) => scope.mode === 'all'
                      ? [(
                        <div className="knowledge-reference-selected-item" key={`remote:${scope.knowledgeBaseId}`}>
                          <div><span className="outline-knowledge-badge remote">远程</span><strong title={scope.knowledgeBaseName}>{scope.knowledgeBaseName}</strong><small>整个知识库</small></div>
                          <button type="button" aria-label={`移除 ${scope.knowledgeBaseName}`} onClick={() => removeRemoteItem(scope.knowledgeBaseId)}>×</button>
                        </div>
                      )]
                      : scope.documents.map((document) => (
                        <div className="knowledge-reference-selected-item" key={`remote:${scope.knowledgeBaseId}:${document.knowledgeId}`}>
                          <div><span className="outline-knowledge-badge remote">远程</span><strong title={document.title}>{scope.knowledgeBaseName} / {document.title}</strong><small>指定文档</small></div>
                          <button type="button" aria-label={`移除 ${document.title}`} onClick={() => removeRemoteItem(scope.knowledgeBaseId, document.knowledgeId)}>×</button>
                        </div>
                      )))}
                  </div>
                </aside>
              </div>
            </div>
          )}

          {sourceTab === 'remote' && (
            <div className="knowledge-reference-remote-pane">
              <RemoteKnowledgePicker scopes={draftRemoteScopes} disabled={saving} onChange={setDraftRemoteScopes} />
            </div>
          )}
        </div>
      </AppDialog>
    </>
  );
}
