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

export interface BidProjectContent {
  projectId: string;
  paragraphs: Array<{ nodeId: string; title: string; content: string }>;
  content: string;
}

export interface BidContentDuplicateMatch {
  id: string;
  similarity: number;
  level: 'medium' | 'high';
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
