const { OUTLINE_AGENT_TASK_KEY } = require('./outlineGenerationAgentV2Config.cjs');
const {
  OUTLINE_OUTPUT_FILE,
  OUTLINE_WORKING_JSON_SCHEMA,
  SCORE_COVERAGE_MAP_SCHEMA,
  buildFinalOutline,
  stripOutlineInternalFields,
  readJson,
  formatProgressTitle,
  validateFinalOutline,
} = require('./outlineGenerationTaskV2.cjs');

// 只保留 Agent 目录结构字段，正文等业务字段不进入 Agent 工作区。
function buildAgentOutlineInput(outlineData) {
  let originIndex = 0;
  const strip = (items, root) => (items || []).map((item) => {
    const hasChildren = Array.isArray(item?.children) && item.children.length;
    originIndex += 1;
    return {
      id: String(item?.id || ''),
      origin_id: `existing-${originIndex}`,
      title: String(item?.title || '').trim(),
      description: String(item?.description || '').trim() || String(item?.title || '').trim(),
      ...(root ? { attr: item?.attr } : {}),
      ...(hasChildren
        ? { children: strip(item.children, false) }
        : {
          content_mode: item?.content_mode,
          ...(item?.content_mode === 'other' && String(item?.content_mode_note || '').trim()
            ? { content_mode_note: String(item.content_mode_note).trim() }
            : {}),
        }),
    };
  });
  return { outline: strip(outlineData?.outline || [], true) };
}

function buildAdjustmentBaseline(outline) {
  const singleChildRelations = new Set();
  const nodeFingerprints = new Map();
  const visit = (items, parentOriginId = '') => {
    for (const item of items || []) {
      const originId = String(item?.origin_id || item?.id || '');
      nodeFingerprints.set(originId, {
        title: item?.title,
        description: item?.description,
        parentOriginId,
      });
      const children = Array.isArray(item?.children) ? item.children : [];
      if (children.length === 1) {
        singleChildRelations.add(`${originId}>${children[0]?.origin_id || children[0]?.id || ''}`);
      }
      visit(children, originId);
    }
  };
  visit(outline?.outline || []);
  return { singleChildRelations, nodeFingerprints };
}

function inheritCoverageOverrides(previous, generated) {
  if (previous?.coverage_mode !== 'full') {
    return { version: 1, coverage_mode: 'legacy-structure-only', records: [] };
  }
  const generatedRecords = Array.isArray(generated?.records) ? generated.records : [];
  const nextBySource = new Map(generatedRecords.map((record) => [record.source_id, { ...record }]));
  for (const previousRecord of previous.records || []) {
    if (previousRecord.user_override === 'none') continue;
    const generatedRecord = nextBySource.get(previousRecord.source_id);
    if (!generatedRecord) {
      nextBySource.set(previousRecord.source_id, { ...previousRecord });
      continue;
    }
    generatedRecord.user_override = previousRecord.user_override;
    if (previousRecord.user_override === 'removed') {
      generatedRecord.node_ids = [];
      generatedRecord.coverage_location = 'none';
    }
  }
  return {
    version: 1,
    coverage_mode: 'full',
    records: [...nextBySource.values()],
  };
}

function createOutlineAdjustmentPrompt(requirement, coverageMode) {
  return `用户已经在最终目录基础上提出新的调整要求。程序已把当前最新的完整目录覆盖写入 ${OUTLINE_OUTPUT_FILE}（用户可能在主界面手动修改过目录，请以该文件为准，不要沿用你记忆中的旧目录）。

用户的调整要求：
${requirement}

请按以下要求完成目录调整：
1. 先读取 ${OUTLINE_OUTPUT_FILE}，理解当前目录结构，再严格按照用户的调整要求修改目录；与要求无关的目录保持原样，不要顺带重写。
2. 修改后仍须保持完整根结构 {"outline":[一级目录节点]}：一级目录包含 attr（从"通用""商务""资信""技术""其他"中选择），子目录不包含 attr；所有 id 使用与父子位置一致的层级点号编号（一级为 1、2，二级为 2.1、2.2，依此类推）。
3. 每个最终叶子节点必须填写 content_mode：技术方案正文为 ai-generate；从招标文件提取后按模板填写为 template-fill；需要在 Word 页码确定后回填为 point-to-point；其他特殊内容为 other，并用 content_mode_note 说明。父节点只包含 children，不包含 content_mode 或 content_mode_note。
4. 任意由你新增或改变的非叶子节点必须至少包含两个 children，目录最多七级；越往下标题和 description 必须越具体。输入中已有的手工单子节点可以原样保留，但不得新增此类结构。
5. 如果用户要求含糊或存在多种理解，选择最符合投标文件专业惯例的做法直接执行，不要调用 ask-user 反复确认；只有当要求明显违反上述结构规则且无法合理变通时，才在最终回复中说明未执行的部分及原因。
6. 每个输入节点都带有 origin_id。未修改节点必须原样保留其 origin_id；新增节点使用 new-1、new-2 等任务内唯一值。不得在不同节点间交换 origin_id。
7. 当前评分覆盖模式为 ${coverageMode}。full 模式必须读取并同步更新 score-coverage-map.json，保留用户已有的 renamed、partially-removed、removed、added 决定；不得恢复用户明确删除或改名的评分节点。legacy-structure-only 模式不得伪造评分来源记录。
8. 评分来源标题只删除评分外壳，保留“项目实施过程中”等限定词；评价维度写入 description。总体架构设计等受控补充不得替代评分原文要求。
9. 将调整后的完整目录覆盖写回 ${OUTLINE_OUTPUT_FILE}，并同步写回 score-coverage-map.json。程序已为两个文件预置 Schema，写入后分别调用 json-validation；校验失败后必须先修改再校验。
10. 全部完成后，用简体中文输出一段简短的最终总结（不超过 200 字，不使用 Markdown 标题），说明本次实际做了哪些目录调整；如有未能执行的要求，一并说明原因。该总结会直接展示给用户。`;
}

// 复用目录生成的持久 Agent 会话，按用户要求调整已生成的目录。
async function runOutlineAdjustmentTask({ agentService, workspaceStore, updateTask, checkpointTask, taskControl, payload }) {
  const requirement = String(payload?.requirement || '').trim();
  if (!requirement) {
    throw new Error('调整要求不能为空');
  }
  const storedPlan = workspaceStore.loadTechnicalPlan() || {};
  if (!storedPlan.outlineData?.outline?.length) {
    throw new Error('当前没有可调整的目录，请先完成目录生成');
  }
  if (!agentService.hasPersistentTaskSession(OUTLINE_AGENT_TASK_KEY)) {
    throw new Error('目录生成的 Agent 工作空间不存在，请重新生成目录后再使用 AI 调整');
  }

  let logs = ['开始 AI 调整目录'];
  let currentProgress = 10;
  let task = checkpointTask({ status: 'running', progress: currentProgress, logs }).task;

  function publish(message, progress) {
    const text = String(message || '').trim();
    if (text && text !== logs[logs.length - 1]) logs = [...logs, text];
    currentProgress = Math.max(currentProgress, progress || currentProgress);
    task = updateTask({ status: 'running', progress: currentProgress, logs });
  }

  function publishAgentActivity(event = {}) {
    const title = formatProgressTitle(event.message);
    if (!title || event.visible === false) return;
    publish(title, Math.max(currentProgress, 20));
  }

  // 持久任务的 run_id 与当前业务任务对齐后才能 resume 同一 Session。
  agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
    run_id: task.task_id,
    status: 'running',
    phase: 'outline-adjustment',
    agent_connection: 'running',
    error: null,
  });

  const previousCoverageMap = storedPlan.outlineGenerationTask?.stats?.score_coverage_map;
  const coverageMode = previousCoverageMap?.coverage_mode === 'full' ? 'full' : 'legacy-structure-only';
  const initialCoverageMap = coverageMode === 'full'
    ? previousCoverageMap
    : { version: 1, coverage_mode: 'legacy-structure-only', records: [] };
  const workingOutline = buildAgentOutlineInput(storedPlan.outlineData);
  const baseline = buildAdjustmentBaseline(workingOutline);
  let adjustedOutline = null;
  let adjustedCoverageMap = null;

  const agentResult = await agentService.runTask({
    task_id: task.task_id,
    title: '技术方案目录 AI 调整',
    prompt: createOutlineAdjustmentPrompt(requirement, coverageMode),
    output_file: OUTLINE_OUTPUT_FILE,
    files: [
      { path: OUTLINE_OUTPUT_FILE, content: JSON.stringify(workingOutline, null, 2) },
      { path: 'score-coverage-map.json', content: JSON.stringify(initialCoverageMap, null, 2) },
    ],
    signal: taskControl.signal,
    persistent_task: {
      task_key: OUTLINE_AGENT_TASK_KEY,
      mode: 'resume',
    },
    initial_stage: 'outline-adjustment',
    json_validation_schemas: {
      [OUTLINE_OUTPUT_FILE]: OUTLINE_WORKING_JSON_SCHEMA,
      'score-coverage-map.json': SCORE_COVERAGE_MAP_SCHEMA,
    },
    max_retries: 0,
    onActivity: publishAgentActivity,
    continueTask: async (candidate, meta) => {
      adjustedOutline = buildFinalOutline(
        readJson(candidate.output_content, OUTLINE_OUTPUT_FILE),
        { preserveOriginIds: true },
      );
      const generatedCoverageMap = readJson(
        await meta.readFile('score-coverage-map.json'),
        'score-coverage-map.json',
      );
      adjustedCoverageMap = inheritCoverageOverrides(initialCoverageMap, generatedCoverageMap);
      const validation = validateFinalOutline({
        outline: adjustedOutline,
        scoreCoverageMap: adjustedCoverageMap,
        baseline,
        requiredCoverageRecords: initialCoverageMap.records,
      });
      if (!validation.valid) {
        const details = validation.mandatoryIssues.map((issue) => issue.message).join('；');
        throw new Error(`目录调整最终校验未通过：${details}`);
      }
      return { complete: true };
    },
  });

  if (!adjustedOutline || !adjustedCoverageMap) {
    throw new Error('目录调整最终校验未执行，已保留调整前目录');
  }
  const persistedOutline = stripOutlineInternalFields(adjustedOutline);
  const summary = String(agentResult.assistant_text || '').trim() || '目录已按要求调整完成。';

  // 目录调整属于目录变更，saveOutline(replace) 会按既有规则清空旧正文与生成缓存。
  const saved = workspaceStore.saveOutline({
    outlineData: {
      ...persistedOutline,
      project_name: storedPlan.outlineData.project_name,
      project_overview: storedPlan.outlineData.project_overview,
    },
    reason: 'replace',
    scoreCoverageMap: adjustedCoverageMap,
  });

  logs = [...logs, '目录 AI 调整完成'];
  checkpointTask({
    status: 'success',
    progress: 100,
    error: undefined,
    logs,
    stats: {
      ...(task.stats || {}),
      adjustment: {
        requirement,
        summary,
        coverage_mode: coverageMode,
        ...(coverageMode === 'legacy-structure-only'
          ? { notice: '旧目录仅完成结构检查，重新生成目录后可启用评分覆盖保护。' }
          : {}),
      },
    },
  }, {}, {
    outlineData: saved.outlineData,
    technicalPlanPatch: {
      outlineData: saved.outlineData,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
      contentIllustrationPlan: undefined,
      contentGenerationRuntime: undefined,
    },
  });
  agentService.updatePersistentTask(OUTLINE_AGENT_TASK_KEY, {
    status: 'success',
    phase: 'completed',
    agent_connection: 'idle',
    error: null,
    completed_at: new Date().toISOString(),
  });
}

module.exports = {
  runOutlineAdjustmentTask,
  buildAgentOutlineInput,
  buildAdjustmentBaseline,
  inheritCoverageOverrides,
};
