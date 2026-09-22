export type BidProjectStatus = 'generating' | 'incomplete' | 'completed' | 'failed';
export type BidProjectType = 'technical-plan' | 'existing-plan-expansion';

export interface BidProject {
  projectId: string;
  projectName: string;
  projectType: BidProjectType;
  status: BidProjectStatus;
  sourceGroupId?: string;
  sourceSequence: number;
  sourceFileName?: string;
  sourceFileHash?: string;
  sourceContentHash?: string;
  sourceFileSize: number;
  sourceFileModifiedAt?: string;
  sectionLabel?: string;
  currentStep: string;
  lastTaskType?: string;
  lastTaskStatus?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BidProjectSourceFile {
  sourceId?: string;
  fileName: string;
  fileHash?: string;
  contentHash?: string;
  sourceDocxPath?: string;
  markdownPath?: string;
  size?: number;
  modifiedAt?: string;
}

export interface BidProjectCreateOptions {
  projectName?: string;
  projectType?: BidProjectType;
  sourceFile?: BidProjectSourceFile;
  sourceGroupId?: string;
  sectionLabel?: string;
}

export interface BidProjectImportPreview {
  success: boolean;
  message?: string;
  token?: string;
  fileName?: string;
  parserLabel?: string | null;
  fileHash?: string;
  contentHash?: string;
  documents?: Array<{ fileName: string; fileHash: string; contentHash: string; size: number; modifiedAt: string }>;
  matches?: BidProject[];
}

export interface ExpansionImportDocumentSuccessPreview {
  success: true;
  message?: string;
  fileName: string;
  parserLabel: string | null;
  fileHash: string;
  contentHash: string;
  contentPreview: string;
  markdownChars: number;
  size: number;
  modifiedAt: string;
}

export interface ExpansionImportDocumentFailurePreview {
  success: false;
  message?: string;
  fileName?: string;
  parserLabel?: string | null;
  fileHash?: string;
  contentHash?: string;
  contentPreview?: string;
  markdownChars?: number;
  size?: number;
  modifiedAt?: string;
}

export type ExpansionImportDocumentPreview =
  | ExpansionImportDocumentSuccessPreview
  | ExpansionImportDocumentFailurePreview;

export interface ExpansionImportTenderPreview {
  success: boolean;
  requestedCount: number;
  documents: ExpansionImportDocumentPreview[];
  errors: string[];
}

export interface ExpansionProjectImportPreview {
  success: boolean;
  canceled: boolean;
  message?: string;
  token: string | null;
  tender: ExpansionImportTenderPreview;
  originalPlan: ExpansionImportDocumentPreview;
}

export interface ExpansionProjectImportOptions {
  projectName?: string;
}

export interface BidProjectContent {
  projectId: string;
  paragraphs: Array<{ nodeId: string; title: string; content: string }>;
  content: string;
}

export interface BidContentDuplicateMatch {
  id: string;
  similarity: number;
  level: 'medium' | 'high';
  matchType?: 'similar-paragraph' | 'exact-sentence' | 'mixed';
  exactSentences?: Array<{
    normalized: string;
    left: string;
    right: string;
  }>;
  leftParagraph: { index: number; text: string };
  rightParagraph: { index: number; text: string };
  suggestion: { title: string; reason: string; instruction: string };
  leftNodeId?: string;
  rightNodeId?: string;
  decision?: 'pending' | 'ignored' | 'rewritten';
  decisionTargetSide?: 'left' | 'right' | 'none';
  rewriteDraft?: string;
  ignoredAt?: string;
  rewrittenAt?: string;
}

export interface BidContentDuplicateResult {
  resultId?: string;
  sensitivity: 'low' | 'medium' | 'high';
  threshold: number;
  summary: {
    leftParagraphCount: number;
    rightParagraphCount: number;
    duplicateParagraphCount: number;
    exactSentenceCount?: number;
    maxSimilarity: number;
    threshold?: number;
  };
  matches: BidContentDuplicateMatch[];
  leftProjectId?: string;
  rightProjectId?: string;
  leftProject?: BidProject;
  rightProject?: BidProject;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  totalMatches?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

export interface BidProjectDuplicateSummary {
  projectId: string;
  resultId: string;
  otherProjectId: string;
  otherProjectName: string;
  sensitivity: 'low' | 'medium' | 'high';
  threshold: number;
  duplicateParagraphCount: number;
  maxSimilarity: number;
  updatedAt: string;
}

export type BidContentDuplicateDecision = 'pending' | 'ignored' | 'rewritten';
export type BidContentDuplicateTargetSide = 'left' | 'right' | 'none';

export interface BidContentDuplicateRewriteRequest {
  resultId: string;
  matchId: string;
  targetSide: Exclude<BidContentDuplicateTargetSide, 'none'>;
  leftProjectId: string;
  rightProjectId: string;
}

export interface BidContentDuplicateRewriteResult {
  rewrittenText: string;
  reason: string;
  riskNote: string;
}
