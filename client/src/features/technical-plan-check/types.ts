export type TechnicalPlanCheckFileRole = 'tender' | 'requirements' | 'scoring' | 'proposal';

export interface TechnicalPlanCheckFile {
  path: string;
  name: string;
}

export interface TechnicalPlanCheckSummary {
  total: number;
  info: number;
  review: number;
  issue: number;
  req_unresp: number;
  req_part: number;
  score_uncov: number;
  score_pcov: number;
  internal_total: number;
}

export interface TechnicalPlanCheckTask {
  task_id: string;
  type: string;
  status: string;
  progress: number;
  logs: string[];
  started_at: string;
  updated_at: string;
  error?: string;
  stats?: unknown;
}

export interface TechnicalPlanCheckState {
  tenderFile: TechnicalPlanCheckFile | null;
  requirementsFile: TechnicalPlanCheckFile | null;
  scoringFile: TechnicalPlanCheckFile | null;
  proposalFile: TechnicalPlanCheckFile | null;
  outputPath: string;
  reportPath: string;
  summary: TechnicalPlanCheckSummary | null;
  checkTask?: TechnicalPlanCheckTask;
}
