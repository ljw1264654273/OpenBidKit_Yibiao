import { useEffect, useState } from 'react';
import { DEFAULT_OUTLINE_MINIMUM_DEPTH, DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS } from '../../../shared/types';
import { technicalPlanStorage } from '../services/technicalPlanStorage';
import type { GlobalFactsMode, TechnicalPlanState } from '../types';

function normalizeGlobalFactsMode(value: unknown): GlobalFactsMode {
  return value === 'placeholder' ? 'placeholder' : 'omit';
}

const initialState: TechnicalPlanState = {
  workflowKind: 'technical-plan',
  step: 'document-analysis',
  tenderFile: null,
  tenderFiles: [],
  bidTemplateExists: false,
  originalPlanFile: null,
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key',
  bidAnalysisSelectedTaskIds: [],
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  historicalAdaptationDifferences: [],
  historicalAdaptationDifferenceConfirmedAt: undefined,
  historicalAdaptationOriginalOutline: null,
  historicalAdaptationOutlineChanges: [],
  historicalAdaptationOutlineConfirmedAt: undefined,
  historicalAdaptationContentItems: [],
  historicalAdaptationContentConfirmedAt: undefined,
  historicalAdaptationContentFactOverrides: [],
  historicalAdaptationContentCheck: { status: 'idle', findings: [], checked_content_hash: '', checked_inputs_hash: '' },
  historicalAdaptationReviewFindings: [],
  historicalAdaptationReviewConfirmedAt: undefined,
  bidSectionMode: 'single',
  bidSections: [],
  bidSectionExtractionStatus: 'idle',
  bidSectionExtractionError: undefined,
  outlineMode: 'standalone-technical',
  outlineExpansionMode: 'ai-complement',
  outlineWordControlOptions: { ...DEFAULT_OUTLINE_WORD_CONTROL_OPTIONS },
  outlineWordControlSnapshot: undefined,
  outlineMinimumDepth: DEFAULT_OUTLINE_MINIMUM_DEPTH,
  outlineMinimumDepthSnapshot: undefined,
  referenceKnowledgeDocumentIds: [],
  remoteKnowledgeScopes: [],
  bidSectionExtractionTask: undefined,
  bidAnalysisTask: undefined,
  historicalAdaptationDifferenceTask: undefined,
  historicalAdaptationOutlineTask: undefined,
  historicalAdaptationContentTask: undefined,
  historicalAdaptationContentCheckTask: undefined,
  outlineGenerationTask: undefined,
  outlineAdjustmentTask: undefined,
  globalFactsMode: 'omit',
  globalFactsTask: undefined,
  globalFactsAdjustmentTask: undefined,
  globalFacts: [],
  contentGenerationTask: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  contentGenerationRuntime: undefined,
  outlineData: null,
};

export function useTechnicalPlanWorkflow(projectId?: string, isNewProject = false) {
  const [state, setState] = useState<TechnicalPlanState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (isNewProject) {
      setState(initialState);
      setHydrated(true);
      return;
    }

    const loadCache = async () => {
      try {
        const cachedState = await technicalPlanStorage.load(projectId);
        if (mounted && cachedState) {
          setState({ ...initialState, ...cachedState, outlineExpansionMode: cachedState.outlineExpansionMode || 'ai-complement', globalFactsMode: normalizeGlobalFactsMode(cachedState.globalFactsMode) });
        }
      } catch (error) {
        console.warn('技术方案缓存读取失败', error);
      } finally {
        if (mounted) {
          setHydrated(true);
        }
      }
    };

    loadCache();

    return () => {
      mounted = false;
    };
  }, [projectId, isNewProject]);

  return {
    hydrated,
    state,
    setState,
  };
}
