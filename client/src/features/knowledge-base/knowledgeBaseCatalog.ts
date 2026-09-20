export const KNOWLEDGE_BASE_CATALOG = [
  {
    id: 'document',
    label: '文档知识库',
    navigationId: 'document-knowledge-base',
  },
  {
    id: 'national-standard',
    label: '国标知识库',
    navigationId: 'national-standard-knowledge-base',
  },
  {
    id: 'provincial-standard',
    label: '省标知识库',
    navigationId: 'provincial-standard-knowledge-base',
  },
  {
    id: 'municipal-standard',
    label: '市标知识库',
    navigationId: 'municipal-standard-knowledge-base',
  },
  {
    id: 'industry-standard',
    label: '行业标知识库',
    navigationId: 'industry-standard-knowledge-base',
  },
  {
    id: 'enterprise',
    label: '企业知识库',
    navigationId: 'enterprise-knowledge-base',
  },
] as const;

export type KnowledgeBaseCatalogItem = (typeof KNOWLEDGE_BASE_CATALOG)[number];
export type KnowledgeBaseId = KnowledgeBaseCatalogItem['id'];
export type KnowledgeBaseNavigationId = KnowledgeBaseCatalogItem['navigationId'];

export const KNOWLEDGE_BASE_CATALOG_BY_ID: Readonly<Record<KnowledgeBaseId, KnowledgeBaseCatalogItem>> =
  Object.fromEntries(KNOWLEDGE_BASE_CATALOG.map((item) => [item.id, item])) as Record<KnowledgeBaseId, KnowledgeBaseCatalogItem>;

export const KNOWLEDGE_BASE_CATALOG_BY_NAVIGATION_ID: Readonly<Record<KnowledgeBaseNavigationId, KnowledgeBaseCatalogItem>> =
  Object.fromEntries(KNOWLEDGE_BASE_CATALOG.map((item) => [item.navigationId, item])) as Record<KnowledgeBaseNavigationId, KnowledgeBaseCatalogItem>;

export const knowledgeBaseCatalog = KNOWLEDGE_BASE_CATALOG;
export const knowledgeBaseCatalogById = KNOWLEDGE_BASE_CATALOG_BY_ID;
export const knowledgeBaseCatalogByNavigationId = KNOWLEDGE_BASE_CATALOG_BY_NAVIGATION_ID;

export function getKnowledgeBaseCatalogItem(id: string | null | undefined): KnowledgeBaseCatalogItem | undefined {
  return id ? KNOWLEDGE_BASE_CATALOG_BY_ID[id as KnowledgeBaseId] : undefined;
}

export function getKnowledgeBaseCatalogItemByNavigationId(
  navigationId: string | null | undefined,
): KnowledgeBaseCatalogItem | undefined {
  return navigationId
    ? KNOWLEDGE_BASE_CATALOG_BY_NAVIGATION_ID[navigationId as KnowledgeBaseNavigationId]
    : undefined;
}

export function getKnowledgeBaseIdByNavigationId(
  navigationId: string | null | undefined,
): KnowledgeBaseId | undefined {
  return getKnowledgeBaseCatalogItemByNavigationId(navigationId)?.id;
}
