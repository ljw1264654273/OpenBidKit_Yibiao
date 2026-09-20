export type SectionId =
  | 'bid-generation'
  | 'bid-projects'
  | 'technical-plan'
  | 'existing-plan-expansion'
  | 'feasibility-report'
  | 'business-bid'
  | 'knowledge-base'
  | 'document-knowledge-base'
  | 'national-standard-knowledge-base'
  | 'provincial-standard-knowledge-base'
  | 'municipal-standard-knowledge-base'
  | 'industry-standard-knowledge-base'
  | 'enterprise-knowledge-base'
  | 'remote-knowledge-base'
  | 'image-knowledge-base'
  | 'bid-check'
  | 'duplicate-check'
  | 'rejection-check'
  | 'ai-evaluation'
  | 'template-settings'
  | 'my-templates'
  | 'new-template'
  | 'export-format'
  | 'developer-test'
  | 'developer-json-test'
  | 'developer-multimodal-test'
  | 'developer-prompt-lab'
  | 'developer-parser-sandbox'
  | 'developer-export-preview'
  | 'developer-expansion-replace-test'
  | 'developer-agent-test'
  | 'settings';

export function normalizeSectionId(section: string | null | undefined): SectionId {
  switch (section) {
    case 'knowledge-base':
    case 'document':
      return 'document-knowledge-base';
    case 'image':
      return 'image-knowledge-base';
    default:
      return (section || 'bid-projects') as SectionId;
  }
}

export interface AppMenuNotice {
  message: string;
}

export interface AppSubMenuItem {
  id: SectionId;
  label: string;
  description: string;
  icon?: 'document' | 'expand' | 'briefcase' | 'compare' | 'shield' | 'code' | 'prompt' | 'file' | 'export' | 'tool';
  badge?: string;
  notice?: AppMenuNotice;
}

export interface AppMenuItem {
  id: SectionId;
  label: string;
  description: string;
  children?: AppSubMenuItem[];
  notice?: AppMenuNotice;
}
