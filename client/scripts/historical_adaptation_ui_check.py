import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright


OUTPUT_DIR = Path(os.environ.get("HISTORICAL_UI_OUTPUT_DIR", r"C:\Users\admin\.codex\visualizations\2026\10\02\01a0fa92-e230-7ba3-a686-1f9fd9f1ded0"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

TENDER_NAME = "本次招标文件-横泾街道房地一体农村不动产登记服务-发布稿.docx"
HISTORY_NAME = "五峰村常态化办理不动产登记证书服务费-技术方案V2.0(1).docx"


def document_preview(name: str, chars: int):
    return {
        "success": True,
        "fileName": name,
        "parserLabel": "本地解析",
        "fileHash": f"file-{chars}",
        "contentHash": f"content-{chars}",
        "contentPreview": f"# {name}\n\n已成功提取文档正文，用于材料验收预览。",
        "markdownChars": chars,
        "size": chars * 3,
        "modifiedAt": "2026-09-30T08:00:00.000Z",
    }


def dismiss_toasts(page):
    # 每次关闭后列表会重排，始终重新定位第一条提示，避免跳过剩余提示。
    while page.locator(".app-toast-close").count():
        page.locator(".app-toast-close").first.click()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    page.set_default_timeout(5000)
    init_data = {
        "tenderName": TENDER_NAME,
        "historyName": HISTORY_NAME,
        "tenderPreview": document_preview(TENDER_NAME, 27184),
        "historyPreview": document_preview(HISTORY_NAME, 145601),
    }
    page.add_init_script(
        """
        (({ tenderName, historyName, tenderPreview, historyPreview }) => {
          const project = {
            projectId: 'adaptation-ui-project', projectName: '横泾街道历史标书适配',
            projectType: 'historical-bid-adaptation', status: 'incomplete', uniquenessStatus: 'none',
            uniquenessAttempts: 0, uniquenessAutoRunRequested: false, sourceSequence: 1,
            sourceFileSize: 1, currentStep: 'sources', createdAt: '2026-09-30T08:00:00.000Z',
            updatedAt: '2026-09-30T08:00:00.000Z'
          };
          const bidTaskIds = [
            'projectOverview', 'techRequirements', 'projectInfo', 'partAInfo',
            'deliveryAndServiceRequirements', 'procurementList', 'responseFileRequirements',
            'agentInfo', 'keyInfo', 'marginInfo', 'qualificationReview', 'complianceCheck',
            'openBid', 'evaluationBid', 'businessScoring', 'discardedBids',
            'signingProcess', 'terminationCondition'
          ];
          const differences = [
            {
              id: 'delete-registration-database', category: '删除内容', priority: 'high',
              title: '删除数据建库和登记发证章节', historical_location: '第四章 4.数据建库和登记发证',
              historical_excerpt: '完成不动产数据库建设、登记审核及证书发放。',
              tender_requirement: '横泾街道本次采购范围不包含数据建库和登记发证。',
              action: '删除本章及全文中与数据建库、登记发证相关的承诺和进度节点。', note: '', decision: 'pending', content_change_scope: 'none',
              difference_schema_version: 2, target_action: 'remove', evidence_kind: 'locked-range', confidence: 'high', replacements: [], old_content_evidence: ['完成不动产数据库建设、登记审核及证书发放。']
            },
            {
              id: 'replace-location', category: '名称地点替换', priority: 'high',
              title: '项目实施地点由五峰村调整为横泾街道', historical_location: '全文项目名称、服务地点及组织架构',
              historical_excerpt: '项目实施范围为五峰村，配合村级工作人员开展服务。',
              tender_requirement: '本项目实施范围为横泾街道，表述层级统一为街道。',
              action: '全文替换地点和行政层级，不保留“五峰村”及村级表述。', note: '', decision: 'pending', content_change_scope: 'location-target',
              difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', replacements: [{ old_value: '五峰村', new_value: '横泾街道' }], old_content_evidence: ['项目实施范围为五峰村']
            },
            {
              id: 'update-workload', category: '数据更新', priority: 'medium',
              title: '按横泾街道实际工作量更新数量', historical_location: '第二章 项目概况与工作量测算',
              historical_excerpt: '原方案工作量按五峰村存量宗地数量测算。',
              tender_requirement: '以横泾街道招标文件载明的服务规模和数量为准。',
              action: '更新工作量基数、人员投入和设备配置中的关联数据。', note: '', decision: 'pending', content_change_scope: 'workload',
              difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', replacements: [{ old_value: '120户', new_value: '350户' }], old_content_evidence: ['工作量120户']
            },
            {
              id: 'update-schedule', category: '工期进度更新', priority: 'high',
              title: '重排三年服务期及分阶段节点', historical_location: '第六章 项目进度计划',
              historical_excerpt: '原方案以2026年6月开标为起点安排三年进度。',
              tender_requirement: '按2026年10月开标时间重新计算三年服务周期。',
              action: '更新起止日期，并同步调整准备、实施、验收各阶段节点。', note: '', decision: 'pending', content_change_scope: 'schedule',
              difference_schema_version: 2, target_action: 'replace', evidence_kind: 'exact-value', confidence: 'high', replacements: [{ old_value: '2026年6月', new_value: '2026年10月' }], old_content_evidence: ['原方案以2026年6月开标为起点安排三年进度。']
            }
          ];
          const originalOutline = { outline: [
            { id: '1', title: '项目概况', description: '历史目录', children: [
              { id: '1.1', title: '五峰村服务范围', description: '原地点范围', content_mode: 'ai-generate' }
            ] },
            { id: '2', title: '数据建库和登记发证', description: '原服务内容', content_mode: 'ai-generate' },
            { id: '3', title: '项目进度计划', description: '原三年计划', content_mode: 'ai-generate' }
          ] };
          const adaptedOutline = { outline: [
            { id: '1', title: '横泾街道项目概况', description: '说明项目范围与实际工作量', children: [
              { id: '1.1', title: '横泾街道服务范围', description: '统一使用街道层级表述', content_mode: 'ai-generate' }
            ] },
            { id: '2', title: '三年服务进度安排', description: '按2026年10月起点重排阶段节点', content_mode: 'ai-generate' }
          ], project_name: '横泾街道历史标书适配' };
          const outlineChanges = [
            { id: 'rename-1', change_type: 'renamed', original_path: '项目概况', target_node_id: '1', target_title: '横泾街道项目概况', reason: '地点和行政层级统一为横泾街道', difference_ids: ['replace-location'] },
            { id: 'delete-2', change_type: 'deleted', original_path: '数据建库和登记发证', target_node_id: '', target_title: '', reason: '本次采购范围不包含该服务', difference_ids: ['delete-registration-database'] },
            { id: 'update-2', change_type: 'updated', original_path: '项目进度计划', target_node_id: '2', target_title: '三年服务进度安排', reason: '按2026年10月重新计算三年节点', difference_ids: ['update-schedule'] }
          ];
          let taskListener = null;
          let workspaceState = {
            workflowKind: 'existing-plan-expansion', step: 'sources',
            tenderFile: {
              fileName: tenderName, markdownPath: 'tender.md', markdownChars: 27184,
              contentHash: 'tender-hash', parserLabel: '本地解析',
              importedAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z'
            },
            tenderFiles: [{
              id: 'tender-1', fileName: tenderName, markdownPath: 'tender.md', markdownChars: 27184,
              contentHash: 'tender-hash', parserLabel: '本地解析',
              importedAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z'
            }],
            originalPlanFile: {
              fileName: historyName, markdownPath: 'history.md', markdownChars: 145601,
              contentHash: 'history-hash', parserLabel: '本地解析',
              importedAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z'
            },
            projectOverview: '', techRequirements: '', bidAnalysisMode: 'key',
            bidAnalysisSelectedTaskIds: [], bidAnalysisTasks: {}, bidAnalysisProgress: 0,
            historicalAdaptationDifferences: [], historicalAdaptationDifferenceConfirmedAt: undefined,
            historicalAdaptationOriginalOutline: null, historicalAdaptationOutlineChanges: [],
            historicalAdaptationOutlineConfirmedAt: undefined,
            historicalAdaptationContentItems: [], historicalAdaptationContentConfirmedAt: undefined,
            historicalAdaptationContentCheck: { status: 'idle', findings: [], checked_content_hash: '', checked_inputs_hash: '' },
            bidSectionMode: 'single', bidSections: [], bidSectionExtractionStatus: 'idle',
            outlineMode: 'standalone-technical', outlineExpansionMode: 'ai-complement',
            outlineWordControlOptions: {}, outlineMinimumDepth: 3,
            referenceKnowledgeDocumentIds: [], remoteKnowledgeScopes: [], globalFacts: [],
            contentGenerationSections: {}, contentGenerationPlans: {}, outlineData: null
          };
          const immutableSources = new Map();
          const emitTask = (task, patch, delta = {}) => {
            workspaceState = { ...workspaceState, ...patch };
            if (delta.contentItemPatch) {
              workspaceState.historicalAdaptationContentItems = workspaceState.historicalAdaptationContentItems.map((item) => item.node_id === delta.contentItemPatch.node_id ? { ...item, ...delta.contentItemPatch } : item);
            }
            if (delta.outlineContentPatch) {
              const update = (items) => items.map((item) => item.id === delta.outlineContentPatch.nodeId ? { ...item, content: delta.outlineContentPatch.content } : item.children?.length ? { ...item, children: update(item.children) } : item);
              workspaceState.outlineData = { ...workspaceState.outlineData, outline: update(workspaceState.outlineData.outline) };
            }
            taskListener?.({ task, technicalPlanPatch: patch, ...delta });
          };
          window.__historicalMock = {
            calls: [],
            failStrategyOnce: false,
            failStartOnce: false,
            failPrepareOnce: false,
            markMissingSource() {
              const items = workspaceState.historicalAdaptationContentItems.map((item, index) => index === 0
                ? { ...item, source_path: '', source_section_id: '', source_excerpt: '', recommended_mode: null, manual_mode: undefined, manual_instruction: '', status: 'review' } : item);
              emitTask({ task_id: 'missing-source', type: 'historical-adaptation-content', status: 'success', progress: 100, project_id: project.projectId }, { historicalAdaptationContentItems: items });
            },
            completeBaseline() {
              const bidAnalysisTasks = Object.fromEntries(bidTaskIds.map((id) => [id, {
                id, label: id, status: 'success', content: id === 'projectOverview' ? '横泾街道项目概述' : '{}'
              }]));
              emitTask(
                { task_id: 'baseline-complete', type: 'bid-analysis', status: 'success', progress: 100, project_id: project.projectId },
                { bidAnalysisTasks, bidAnalysisProgress: 100, projectOverview: '横泾街道项目概述', techRequirements: '技术评分要求' }
              );
            },
            showDifferences() {
              emitTask(
                { task_id: 'difference-complete', type: 'historical-adaptation-difference', status: 'success', progress: 100, project_id: project.projectId },
                { historicalAdaptationDifferences: differences, historicalAdaptationDifferenceTask: { type: 'historical-adaptation-difference', status: 'success', progress: 100 } }
              );
            },
            showOutline() {
              emitTask(
                { task_id: 'outline-complete', type: 'historical-adaptation-outline', status: 'success', progress: 100, project_id: project.projectId },
                { historicalAdaptationOriginalOutline: originalOutline, historicalAdaptationOutlineChanges: outlineChanges, outlineData: adaptedOutline, historicalAdaptationOutlineConfirmedAt: undefined }
              );
            },
            showContent(nodeId) {
              if (nodeId) {
                const migration = workspaceState.historicalAdaptationContentItems.find((item) => item.node_id === nodeId);
                const mode = migration.manual_mode || migration.recommended_mode;
                const content = mode === 'rewrite' ? `按人工要求迁移：${migration.manual_instruction}。` : immutableSources.get(nodeId);
                emitTask({ task_id: 'single-content', type: 'historical-adaptation-content', status: 'success', progress: 100, project_id: project.projectId }, {
                  historicalAdaptationContentConfirmedAt: undefined,
                  historicalAdaptationContentCheck: { status: 'stale', findings: [], checked_content_hash: '', checked_inputs_hash: '' }
                }, {
                  contentItemPatch: { ...migration, status: 'success', content_origin: mode === 'rewrite' ? 'ai-rewrite' : 'migrated', error: undefined, residuals: [] },
                  outlineContentPatch: { nodeId, content }
                });
                return;
              }
              const contentByTitle = {
                '横泾街道服务范围': '本项目服务范围为横泾街道。项目组将依据招标文件开展农村不动产登记服务，具体工作量以招标清单为准。',
                '三年服务进度安排': '项目服务期为三年，自2026年10月起分为准备、常态实施和总结验收三个阶段。具体起止日期以合同约定为准。'
              };
              const leaves = [];
              const previousById = new Map(workspaceState.historicalAdaptationContentItems.map((item) => [item.node_id, item]));
              const applyContent = (items, parents = []) => items.map((item) => {
                const path = [...parents, item.title];
                if (item.children?.length) return { ...item, children: applyContent(item.children, path) };
                const previous = previousById.get(item.id);
                if (previous?.content_origin === 'manual' || previous?.status === 'success') {
                  leaves.push({ item, path, content: item.content || '', preserved: true });
                  return item;
                }
                const table = '<table><tbody><tr><td><p>设备</p></td><td><p>拟投入数量</p></td><td><p>备注</p></td></tr><tr><td><p>无人机</p></td><td><p>1台</p></td><td><p>依据项目实际情况调整投入数量</p></td></tr><tr><td><p>全站仪</p></td><td><p>2台</p></td><td><p>依据项目实际情况调整投入数量</p></td></tr><tr><td><p>GNSS-RTK</p></td><td><p>2台</p></td><td><p>依据项目实际情况调整投入数量</p></td></tr><tr><td><p>手持式测距仪</p></td><td><p>3台</p></td><td><p>依据项目实际情况调整投入数量</p></td></tr></tbody></table>';
                const mergedTable = '<table>\\n<tbody>\\n<tr><td rowspan="2">测量组</td><td colspan="2">设备配置</td></tr>\\n<tr><td>无人机</td><td>1台</td></tr>\\n</tbody>\\n</table>';
                const content = (contentByTitle[item.title] || '本节已依据横泾街道招标要求完成迁移，具体项目事实不足处使用【待核实】标记。') + '\\n\\n## 设备投入\\n\\n' + table + '\\n\\n' + mergedTable + '\\n\\n- 按实际需求配置\\n- 保持设备完好';
                leaves.push({ item, path, content });
                return { ...item, content };
              });
              const outlineData = { ...workspaceState.outlineData, outline: applyContent(workspaceState.outlineData.outline) };
              const historicalAdaptationContentItems = leaves.map(({ item, path, content, preserved }, index) => preserved ? previousById.get(item.id) : ({
                node_id: item.id, source_path: path.join(' / '), source_section_id: `source-${index}`,
                recommended_mode: index === 0 ? 'local-rewrite' : 'direct', manual_mode: undefined,
                manual_instruction: '', status: 'success', content_origin: index === 0 ? 'local-rewrite' : 'migrated',
                reason: index === 0 ? '地点和行政层级按招标要求局部改写' : '历史正文定位可靠且未受差异影响',
                difference_ids: index === 0 ? ['replace-location'] : [], source_excerpt: '存储快照不包含历史原文',
                blocked_terms: index === 0 ? ['五峰村'] : [], residuals: [],
                source_locator: path.join(' / '), source_hash: `source-${index}`, input_fingerprint: `input-${index}`
              }));
              leaves.forEach(({ item, content }, index) => {
                if (!immutableSources.has(item.id)) immutableSources.set(item.id, index === 0 ? content.replace('横泾街道。', '五峰村。').replace('<td><p>1台</p>', '<td><p>4台</p>') : content);
                emitTask(
                  { task_id: 'content-complete', type: 'historical-adaptation-content', status: 'success', progress: 100, project_id: project.projectId },
                  { historicalAdaptationContentCheck: { status: 'stale', findings: [], checked_content_hash: '', checked_inputs_hash: '' } },
                  { contentItemPatch: historicalAdaptationContentItems[index], outlineContentPatch: { nodeId: item.id, content } }
                );
              });
            }
          };
          window.yibiao = {
            config: { load: async () => ({ developer_mode: false }) },
            database: {
              getStatus: async () => ({ phase: 'ready', ready: true, message: '本地数据库已就绪' }),
              onStatus: () => () => {}
            },
            getGpuHardwareAccelerationStatus: async () => ({ enabled: true, configured: true, restartRequired: false }),
            requiredOnlineServices: { getStatus: async () => ({ available: true }) },
            agent: {
              onQuestion: () => () => {}, getPendingQuestion: async () => null,
              onStatus: () => () => {}, getStatus: async () => ({ status: 'ready' })
            },
            autoConfirmation: {
              onChanged: () => () => {}, getState: async () => ({ enabled: false })
            },
            tasks: {
              onTaskEvent: (listener) => { taskListener = listener; return () => { taskListener = null; }; },
              getActiveTasks: async () => [], startBidAnalysis: async () => ({ status: 'running' }),
              startHistoricalAdaptationDifference: async () => ({ status: 'running' }),
              startHistoricalAdaptationOutline: async () => {
                setTimeout(() => window.__historicalMock.showOutline(), 20);
                return { status: 'running' };
              },
              startHistoricalAdaptationContent: async (request) => {
                window.__historicalMock.calls.push({ action: 'start', ...request });
                if (window.__historicalMock.failStartOnce) {
                  window.__historicalMock.failStartOnce = false;
                  throw new Error('模拟启动失败');
                }
                setTimeout(() => window.__historicalMock.showContent(request.nodeId), 20);
                return { status: 'running' };
              },
              retryHistoricalAdaptationContent: async (request) => {
                window.__historicalMock.calls.push({ action: 'retry', ...request });
                setTimeout(() => window.__historicalMock.showContent(), 20);
                return { status: 'running' };
              },
              startHistoricalAdaptationContentCheck: async () => {
                setTimeout(() => emitTask(
                  { task_id: 'content-check-complete', type: 'historical-adaptation-content-check', status: 'success', progress: 100, project_id: project.projectId },
                  { historicalAdaptationContentCheck: { status: 'success', findings: [], checked_content_hash: 'content-current', checked_inputs_hash: 'inputs-current', checked_at: '2026-10-01T12:20:00.000Z' }, historicalAdaptationContentCheckTask: { type: 'historical-adaptation-content-check', status: 'success', progress: 100 } }
                ), 20);
                return { status: 'running' };
              }
            },
            file: {
              selectDuplicateCheckFiles: async ({ multiple }) => ({
                success: true,
                files: [{
                  file_name: multiple ? tenderName : historyName,
                  file_path: multiple ? 'D:/mock/tender.docx' : 'D:/mock/history.docx',
                  size: multiple ? 81552 : 436803,
                  modified_at: '2026-09-30T08:00:00.000Z'
                }]
              }),
              getPathForFile: () => ''
            },
            bidProject: {
              prepareExpansionImport: async ({ tenderFilePaths, originalPlanFilePaths }) => {
                const complete = tenderFilePaths.length > 0 && originalPlanFilePaths.length === 1;
                return {
                  success: complete, canceled: false, token: complete ? 'ui-token' : null,
                  tender: {
                    success: tenderFilePaths.length > 0,
                    requestedCount: tenderFilePaths.length,
                    documents: tenderFilePaths.length ? [tenderPreview] : [], errors: []
                  },
                  originalPlan: originalPlanFilePaths.length ? historyPreview : { success: false, message: '请上传历史标书' }
                };
              },
              discardExpansionImport: async () => ({ success: true }),
              confirmExpansionImport: async () => project,
              get: async () => project,
              close: async () => {},
              list: async () => [project],
              listRecentDuplicateSummaries: async () => ({})
            },
            technicalPlan: {
              saveBidAnalysisConfig: async () => {},
              loadState: async () => workspaceState,
              saveHistoricalAdaptationDifferences: async ({ differences: nextDifferences }) => {
                const complete = nextDifferences.every((item) => item.decision !== 'pending');
                workspaceState = {
                  ...workspaceState,
                  historicalAdaptationDifferences: nextDifferences,
                  historicalAdaptationDifferenceConfirmedAt: complete ? '2026-09-30T10:30:00.000Z' : undefined
                };
                return workspaceState;
              },
              saveHistoricalAdaptationOutline: async ({ outlineData, changes }) => {
                workspaceState = { ...workspaceState, outlineData, historicalAdaptationOutlineChanges: changes, historicalAdaptationOutlineConfirmedAt: undefined };
                return workspaceState;
              },
              confirmHistoricalAdaptationOutline: async () => {
                workspaceState = { ...workspaceState, historicalAdaptationOutlineConfirmedAt: '2026-10-01T11:00:00.000Z' };
                return workspaceState;
              },
              prepareHistoricalAdaptationContentPlan: async () => {
                window.__historicalMock.calls.push({ action: 'prepare' });
                if (window.__historicalMock.failPrepareOnce) {
                  window.__historicalMock.failPrepareOnce = false;
                  throw new Error('模拟方案失败');
                }
                const previousById = new Map(workspaceState.historicalAdaptationContentItems.map((item) => [item.node_id, item]));
                const leaves = [];
                const collect = (items, parents = []) => items.forEach((item, index) => {
                  const path = [...parents, item.title];
                  if (item.children?.length) collect(item.children, path);
                  else leaves.push({ item, path, index });
                });
                collect(workspaceState.outlineData.outline);
                workspaceState = {
                  ...workspaceState,
                  historicalAdaptationContentItems: leaves.map(({ item, path }, index) => previousById.get(item.id) || ({
                    node_id: item.id, source_path: path.join(' / '), recommended_mode: index === 0 ? 'local-rewrite' : 'direct',
                    manual_instruction: '', status: 'idle', reason: index === 0 ? '地点和实施对象需局部改写' : '可靠历史正文默认直接迁移',
                    difference_ids: index === 0 ? ['replace-location'] : [], source_excerpt: `历史章节：${item.title}`,
                    blocked_terms: index === 0 ? ['五峰村'] : [], residuals: [], source_locator: path.join(' / '),
                    source_hash: `source-${index}`, input_fingerprint: `input-${index}`
                  })),
                  historicalAdaptationContentCheck: { status: 'stale', findings: [], checked_content_hash: '', checked_inputs_hash: '' }
                };
                if (window.__historicalMock.failStartOnce) {
                  window.__historicalMock.failStartOnce = false;
                  setTimeout(() => emitTask({ task_id: 'prepare-content-error', type: 'historical-adaptation-content', status: 'error', progress: 0, error: '模拟迁移失败', project_id: project.projectId }, {}), 20);
                } else {
                  setTimeout(() => window.__historicalMock.showContent(), 20);
                }
                return workspaceState;
              },
              getHistoricalAdaptationSourceSection: async ({ nodeId }) => {
                const item = workspaceState.historicalAdaptationContentItems.find((entry) => entry.node_id === nodeId);
                const available = Boolean(item?.source_path && immutableSources.has(nodeId));
                return { available, content: available ? immutableSources.get(nodeId) : '', sourceVersionHash: 'immutable-history' };
              },
              saveHistoricalAdaptationContentStrategy: async ({ nodeId, mode, instruction }) => {
                window.__historicalMock.calls.push({ action: 'save', nodeId, mode, instruction });
                if (window.__historicalMock.failStrategyOnce) {
                  window.__historicalMock.failStrategyOnce = false;
                  throw new Error('模拟保存失败');
                }
                workspaceState = { ...workspaceState, historicalAdaptationContentItems: workspaceState.historicalAdaptationContentItems.map((item) => item.node_id === nodeId ? { ...item, manual_mode: mode, manual_instruction: instruction || '' } : item) };
                return workspaceState;
              },
              resetHistoricalAdaptationContentStrategies: async () => {
                window.__historicalMock.calls.push({ action: 'reset' });
                workspaceState = {
                  ...workspaceState,
                  historicalAdaptationContentItems: workspaceState.historicalAdaptationContentItems.map((item) => ({
                    ...item, manual_mode: undefined, manual_instruction: '',
                    status: item.content_origin === 'manual' ? item.status : !item.recommended_mode ? 'review' : item.status === 'idle' ? 'idle' : 'stale'
                  })),
                  historicalAdaptationContentConfirmedAt: undefined,
                  historicalAdaptationContentCheck: { status: 'stale', findings: [], checked_content_hash: '', checked_inputs_hash: '' }
                };
                return workspaceState;
              },
              getHistoricalAdaptationContentReadiness: async () => ({ ready: workspaceState.historicalAdaptationContentCheck.status === 'success', blockingCount: workspaceState.historicalAdaptationContentCheck.status === 'success' ? 0 : 1, findings: [] }),
              aiEditContent: async ({ mode }) => ({ mode, replacementText: mode === 'expand' ? '扩写后的实施正文。' : '精简后的实施正文。' }),
              saveHistoricalAdaptationChapterContent: async ({ nodeId, content }) => {
                const update = (items) => items.map((item) => item.id === nodeId ? { ...item, content } : { ...item, children: item.children ? update(item.children) : item.children });
                workspaceState = {
                  ...workspaceState,
                  outlineData: { ...workspaceState.outlineData, outline: update(workspaceState.outlineData.outline) },
                  historicalAdaptationContentItems: workspaceState.historicalAdaptationContentItems.map((item) => item.node_id === nodeId ? { ...item, status: 'success', content_origin: 'manual', confirmed_at: undefined, residuals: [] } : item),
                  historicalAdaptationContentConfirmedAt: undefined,
                  historicalAdaptationContentCheck: { status: 'stale', findings: [], checked_content_hash: '', checked_inputs_hash: '' }
                };
                return workspaceState;
              },
              confirmHistoricalAdaptationContent: async () => {
                workspaceState = { ...workspaceState, historicalAdaptationContentConfirmedAt: '2026-10-01T12:30:00.000Z' };
                return workspaceState;
              }
            }
          };
        })(__INIT_DATA__);
        """.replace("__INIT_DATA__", json.dumps(init_data, ensure_ascii=False)),
    )
    page.goto("http://127.0.0.1:5173", wait_until="networkidle")
    page.get_by_role("button", name="历史标书适配", exact=True).click()
    page.get_by_role("heading", name="创建适配项目").wait_for()
    assert page.locator('[aria-current="step"]').count() == 1
    assert page.get_by_text("完成材料上传后开放招标基线").count() >= 1
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-upload.png", full_page=True)

    page.get_by_role("button", name="选择文件").nth(0).click()
    page.wait_for_function(
        "() => [...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === '选择文件')[1]?.disabled === false"
    )
    page.get_by_role("button", name="选择文件").nth(1).click()
    page.wait_for_function(
        "() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('创建适配项目'))?.disabled === false"
    )
    assert page.get_by_role("button", name="创建适配项目").is_enabled()
    page.get_by_label("项目名称").fill("横泾街道历史标书适配")
    page.get_by_role("button", name="创建适配项目").click()
    page.get_by_text("招标基线", exact=True).last.wait_for()
    assert page.get_by_role("button", name="开始提取基线").is_visible()
    assert page.get_by_text("完整招标基线").is_visible()
    assert page.locator(".bid-analysis-task-item").count() == 18
    assert page.get_by_role("button", name="差异确认 待开放").is_disabled()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-baseline.png", full_page=True)

    page.get_by_role("button", name="上传材料 已完成").click()
    page.get_by_text("材料已完成验收").wait_for()
    assert page.get_by_text("全部成功").is_visible()
    assert page.get_by_text("解析成功").count() == 2
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-acceptance.png", full_page=True)

    page.get_by_role("button", name="招标基线 可开始").click()
    page.get_by_role("button", name="开始提取基线").wait_for()

    page.set_viewport_size({"width": 760, "height": 900})
    page.get_by_role("button", name="开始提取基线").scroll_into_view_if_needed()
    assert page.get_by_text("项目概述", exact=True).first.is_visible()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-baseline-narrow.png", full_page=True)

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.evaluate("window.__historicalMock.completeBaseline()")
    page.get_by_role("button", name="差异确认 可开始").wait_for()
    page.get_by_role("button", name="差异确认 可开始").click()
    page.get_by_role("heading", name="横泾街道历史标书适配").wait_for()
    assert page.get_by_role("button", name="目录适配 待开放").is_disabled()

    page.evaluate("window.__historicalMock.showDifferences()")
    page.get_by_text("删除数据建库和登记发证章节", exact=True).wait_for()
    assert page.get_by_text("识别差异").is_visible()
    assert page.get_by_text("五峰村", exact=True).count() == 0
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences.png", full_page=True)

    first_item = page.locator(".historical-adaptation-difference-item").first
    first_item.get_by_label("处理要求").fill("删除相关章节，并清理全文交叉引用和对应进度节点。")
    first_item.get_by_label("确认备注").fill("已核对横泾街道招标范围")
    first_item.get_by_role("button", name="保存修改").click()
    first_item.get_by_role("button", name="确认此项").click()
    confirmed_item = page.locator(".historical-adaptation-difference-item").filter(has_text="删除数据建库和登记发证章节")
    assert confirmed_item.get_by_role("button", name="删除数据建库和登记发证章节已确认").is_disabled()

    page.get_by_role("button", name="确认全部待确认项（3）").click()
    page.get_by_role("heading", name="确认全部 3 个待确认项").wait_for()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-bulk-dialog.png", full_page=True)
    page.get_by_role("button", name="确认全部待确认项", exact=True).click()
    page.get_by_text("全部差异已处理，等待验收", exact=True).wait_for()
    assert page.locator(".historical-adaptation-difference-confirmed-action").count() == 4
    assert page.get_by_role("button", name="目录适配 可开始").is_enabled()
    page.wait_for_timeout(2500)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-complete.png", full_page=True)

    page.set_viewport_size({"width": 780, "height": 900})
    page.locator(".historical-adaptation-difference-item").first.scroll_into_view_if_needed()
    assert page.locator(".historical-adaptation-difference-item").first.evaluate("node => node.scrollWidth <= node.clientWidth")
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-medium.png", full_page=True)

    page.set_viewport_size({"width": 760, "height": 900})
    page.locator(".historical-adaptation-difference-item").first.scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-narrow.png", full_page=True)

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="目录适配 可开始").click()
    page.get_by_role("button", name="开始目录适配").click()
    page.get_by_text("适配后目录", exact=True).wait_for()
    assert page.get_by_text("原目录", exact=True).is_visible()
    assert page.get_by_text("变更依据", exact=True).is_visible()
    page.get_by_text("横泾街道项目概况", exact=True).last.click()
    page.get_by_label("目录标题").fill("横泾街道项目总体概况")
    page.get_by_role("button", name="保存编辑").click()
    page.get_by_role("button", name="增加子目录").click()
    page.get_by_role("button", name="上移").click()
    page.wait_for_timeout(4000)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-outline.png", full_page=True)
    page.get_by_role("button", name="确认目录").click()
    page.get_by_text("目录适配已确认，等待验收", exact=True).wait_for()
    assert page.get_by_role("button", name="正文迁移 可开始").is_enabled()

    page.set_viewport_size({"width": 760, "height": 900})
    page.get_by_text("适配后目录", exact=True).scroll_into_view_if_needed()
    page.wait_for_timeout(4000)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-outline-narrow.png", full_page=True)

    page.set_viewport_size({"width": 1440, "height": 1000})
    page.get_by_role("button", name="正文迁移 可开始").click()
    plan = page.get_by_role("button", name="建立/更新迁移方案", exact=True)
    assert page.get_by_role("button", name="一键迁移待处理章节", exact=True).count() == 0
    page.evaluate("window.__historicalMock.failPrepareOnce = true")
    plan.click()
    page.get_by_text("建立正文迁移方案失败：模拟方案失败", exact=True).wait_for()
    assert page.evaluate("window.__historicalMock.calls.slice(-1)[0].action") == "prepare"
    page.evaluate("window.__historicalMock.failStartOnce = true")
    plan.click()
    page.get_by_text('模拟迁移失败', exact=True).wait_for()
    assert page.locator(".adaptation-content-preview").inner_text() == "当前章节正文为空。"
    dismiss_toasts(page)
    page.get_by_role("button", name="重试未完成章节", exact=True).click()
    page.locator(".adaptation-content-preview table").first.wait_for()
    assert [item["action"] for item in page.evaluate("window.__historicalMock.calls.slice(-2)")] == ["prepare", "retry"]
    assert page.get_by_role("button", name="批量设为直接迁移").count() == 0
    reset = page.get_by_role("button", name="恢复默认处理方式", exact=True)
    mode = page.get_by_label("迁移方式", exact=True)
    assert mode.input_value() == "local-rewrite"
    mode.select_option("rewrite")
    page.get_by_label("定向改写要求").fill("尚未应用的要求")
    reset.click()
    assert mode.input_value() == "local-rewrite"
    assert page.get_by_label("定向改写要求").count() == 0
    dismiss_toasts(page)
    plan.click()
    page.get_by_text("历史原文 / 迁移依据", exact=True).wait_for()
    assert page.get_by_text("迁移后正文", exact=True).is_visible()
    assert page.get_by_role("button", name="审核导出 待开放").is_disabled()
    source = page.locator(".adaptation-content-source-markdown")
    source.locator("table").first.wait_for()
    assert "存储快照不包含历史原文" not in source.inner_text()
    assert source.locator("table").count() == 2
    assert source.locator("table").first.locator("tr").count() == 5
    assert source.locator('td[rowspan="2"]').inner_text() == "测量组"
    assert source.locator('td[colspan="2"]').inner_text() == "设备配置"
    assert "<table>" not in source.inner_text()
    page.get_by_role("button", name="修改对比", exact=True).click()
    preview = page.locator(".adaptation-content-preview")
    preview.locator("table").first.wait_for()
    assert preview.locator("table").count() == 2
    assert preview.locator("table").first.locator("tr").count() == 5
    assert preview.locator('td[rowspan="2"]').inner_text() == "测量组"
    assert preview.locator('td[colspan="2"]').inner_text() == "设备配置"
    assert "<table>" not in preview.inner_text()
    assert preview.get_by_role("heading", name="设备投入").is_visible()
    assert preview.locator("li").count() == 2
    assert "五峰村" in source.locator("mark.adaptation-content-diff-removed").all_text_contents()
    assert "横泾街道" in preview.locator("mark.adaptation-content-diff-added").all_text_contents()
    assert source.locator("table").first.locator("mark").all_text_contents() == ["4"]
    assert preview.locator("table").first.locator("mark").all_text_contents() == ["1"]
    assert source.get_by_role("heading", name="设备投入").locator("mark").count() == 0
    assert preview.locator("li mark").count() == 0
    assert source.locator("mark").first.evaluate("element => getComputedStyle(element).backgroundColor") == "rgb(255, 226, 226)"
    assert preview.locator("mark").first.evaluate("element => getComputedStyle(element).backgroundColor") == "rgb(217, 245, 228)"
    dismiss_toasts(page)
    page.locator(".historical-adaptation-content-head").scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-content-tables.png", full_page=True)
    for width in [780, 900, 1000, 1100]:
        page.set_viewport_size({"width": width, "height": 900})
        workbench = page.locator(".historical-adaptation-content-workbench")
        assert workbench.evaluate("element => element.scrollWidth <= element.clientWidth + 2"), f"workbench clipped at {width}px"
        bounds = workbench.bounding_box()
        editor_bounds = page.locator(".adaptation-content-column.is-editor").bounding_box()
        assert editor_bounds["x"] + editor_bounds["width"] <= bounds["x"] + bounds["width"] + 2, f"editor clipped at {width}px"
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-content-comparison-medium.png", full_page=True)
    page.set_viewport_size({"width": 760, "height": 900})
    source.scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-content-comparison-narrow.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.locator(".adaptation-content-outline-list button").nth(1).click()
    assert page.locator(".adaptation-content-source-markdown mark").count() == 0
    assert page.locator(".adaptation-content-preview mark").count() == 0
    page.locator(".adaptation-content-outline-list button").first.click()
    page.get_by_role("button", name="编辑", exact=True).click()
    page.get_by_role("button", name="AI扩缩写").first.click()
    assert page.get_by_text("扩写整章", exact=True).is_visible()
    assert page.get_by_text("缩写整章", exact=True).is_visible()
    page.keyboard.press("Escape")
    page.wait_for_timeout(1000)
    editor = page.locator(".adaptation-content-markdown-editor .markdown-editor-textarea")
    original_content = editor.input_value()
    mode = page.get_by_label("迁移方式", exact=True)
    assert mode.locator("option").all_text_contents() == ["直接迁移", "局部改写", "定向改写"]
    assert page.get_by_role("button", name="保存处理方式", exact=True).count() == 0
    assert page.get_by_role("button", name="重新迁移本章", exact=True).count() == 0
    mode.select_option("rewrite")
    migrate = page.get_by_role("button", name="按此方式迁移本章", exact=True)
    assert migrate.is_disabled()
    page.get_by_label("定向改写要求").fill("突出横泾服务响应流程")
    assert editor.input_value() == original_content
    assert page.get_by_text("选择尚未应用，点击下方按钮后才会迁移正文。", exact=True).is_visible()
    calls_before = page.evaluate("window.__historicalMock.calls.length")
    plan.click()
    assert page.evaluate("window.__historicalMock.calls.length") == calls_before
    page.evaluate("window.__historicalMock.failStrategyOnce = true")
    migrate.click()
    page.get_by_text("迁移方式未应用：模拟保存失败", exact=True).wait_for()
    assert page.evaluate("window.__historicalMock.calls.slice(-1)[0].action") == "save"
    assert page.evaluate("window.__historicalMock.calls.length") == calls_before + 1
    assert editor.input_value() == original_content
    page.evaluate("window.__historicalMock.failStartOnce = true")
    migrate.click()
    page.get_by_text("方式已应用，迁移启动失败：模拟启动失败。请重试迁移。", exact=True).wait_for()
    assert editor.input_value() == original_content
    migrate.click()
    page.wait_for_function("() => document.querySelector('.adaptation-content-markdown-editor .markdown-editor-textarea').value.includes('突出横泾服务响应流程')")
    calls = page.evaluate("window.__historicalMock.calls.slice(-2)")
    assert [item["action"] for item in calls] == ["save", "start"]
    assert calls[0]["mode"] == "rewrite"
    assert calls[0]["nodeId"] == calls[1]["nodeId"]
    assert not calls[1].get("forceOverwriteManual", False)
    original_content = editor.input_value()
    page.get_by_text('当前章节已按“定向改写”开始迁移', exact=True).wait_for()
    dismiss_toasts(page)
    reset.click()
    assert mode.input_value() == "local-rewrite"
    assert editor.input_value() == original_content
    assert page.get_by_label("定向改写要求").count() == 0
    assert page.locator(".adaptation-content-outline-list button").first.get_by_text("待重新迁移", exact=True).is_visible()
    editor.press("End")
    editor.type("\n\nmanual draft")
    page.get_by_role("button", name="保存人工修改").wait_for(state="visible")
    assert page.get_by_role("button", name="保存人工修改").is_enabled()
    assert reset.is_disabled()
    assert plan.is_disabled()
    page.locator(".adaptation-content-outline-list button").nth(1).click()
    page.get_by_text("当前章节有未保存修改", exact=True).wait_for()
    assert page.get_by_role("button", name="放弃修改并继续").is_visible()
    page.get_by_role("button", name="继续编辑").click()
    assert editor.input_value().endswith("manual draft")
    page.get_by_role("button", name="目录适配 待验收").click()
    page.get_by_text("切换流程环节会放弃当前章节尚未保存的内容。", exact=True).wait_for()
    assert page.get_by_role("button", name="放弃修改并切换").is_visible()
    page.get_by_role("button", name="继续编辑").click()
    assert editor.input_value().endswith("manual draft")
    page.get_by_role("button", name="保存人工修改", exact=True).click()
    page.wait_for_function("() => [...document.querySelectorAll('button')].find(b => b.textContent === '保存人工修改')?.disabled")
    manual_content = editor.input_value()
    page.get_by_text("当前章节正文已保存；请重新运行一致性检查", exact=True).wait_for()
    dismiss_toasts(page)
    reset.click()
    assert editor.input_value() == manual_content
    assert mode.input_value() == "local-rewrite"
    assert page.locator(".adaptation-content-outline-list button").first.get_by_text("已完成", exact=True).is_visible()
    dismiss_toasts(page)
    plan.click()
    page.get_by_text('方案已更新，待处理章节已按推荐或已应用的人工方式开始迁移', exact=True).wait_for()
    page.wait_for_function("() => !document.querySelector('.adaptation-content-outline-list button small')?.textContent.includes('待重新迁移')")
    page.get_by_role("button", name="编辑", exact=True).click()
    assert editor.input_value() == manual_content
    mode.select_option("direct")
    calls_before = page.evaluate("window.__historicalMock.calls.length")
    migrate.click()
    page.get_by_text("覆盖人工正文", exact=True).wait_for()
    page.get_by_role("button", name="取消", exact=True).click()
    assert page.evaluate("window.__historicalMock.calls.length") == calls_before
    assert editor.input_value() == manual_content
    dismiss_toasts(page)
    page.set_viewport_size({"width": 760, "height": 900})
    migrate.click()
    page.get_by_role("heading", name="覆盖人工正文", exact=True).wait_for()
    page.wait_for_timeout(400)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-manual-cancel-narrow.png", full_page=True)
    page.get_by_role("button", name="取消", exact=True).click()
    assert page.evaluate("window.__historicalMock.calls.length") == calls_before
    assert editor.input_value() == manual_content
    page.set_viewport_size({"width": 1440, "height": 1000})
    migrate.click()
    page.get_by_role("button", name="确认覆盖并迁移", exact=True).click()
    page.wait_for_function("() => !document.querySelector('.adaptation-content-markdown-editor .markdown-editor-textarea').value.includes('manual draft')")
    calls = page.evaluate("window.__historicalMock.calls.slice(-2)")
    assert [item["action"] for item in calls] == ["save", "start"]
    assert calls[0]["mode"] == "direct"
    assert calls[1]["forceOverwriteManual"] is True
    page.get_by_text('当前章节已按“直接迁移”开始迁移', exact=True).wait_for()
    page.evaluate("window.__historicalMock.markMissingSource()")
    page.get_by_text("请选择迁移方式", exact=True).wait_for(state="attached")
    assert page.get_by_role("button", name="修改对比", exact=True).is_disabled()
    assert page.locator(".adaptation-content-preview mark").count() == 0
    dismiss_toasts(page)
    reset.click()
    assert mode.input_value() == ""
    assert migrate.is_disabled()
    assert mode.locator('option[value="direct"]').is_disabled()
    assert mode.locator('option[value="local-rewrite"]').is_disabled()
    mode.select_option("rewrite")
    page.get_by_label("定向改写要求").fill("补充横泾应急响应内容")
    migrate.click()
    page.wait_for_function("() => document.querySelector('.adaptation-content-markdown-editor .markdown-editor-textarea').value.includes('补充横泾应急响应内容')")
    page.get_by_role("button", name="运行一致性检查").click()
    page.get_by_text("检查通过", exact=True).wait_for()
    page.get_by_role("button", name="确认本阶段").click()
    page.get_by_text("正文迁移已按阶段确认", exact=True).wait_for()
    assert page.get_by_role("button", name="审核导出 待审核").is_enabled()
    dismiss_toasts(page)
    page.wait_for_timeout(400)
    page.locator(".historical-adaptation-content-head").scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-content.png", full_page=True)

    page.set_viewport_size({"width": 760, "height": 900})
    page.get_by_text("历史原文 / 迁移依据", exact=True).scroll_into_view_if_needed()
    page.wait_for_timeout(1000)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-content-narrow.png", full_page=True)
    print("历史标书适配 UI 验证通过：建立方案后自动迁移、方案/启动失败重试、两侧精确高亮、直接迁移无高亮、表格及合并单元格、三种方式、单章迁移、恢复默认、草稿/人工正文保护、无来源补充、扩缩写、一致性检查、阶段确认和窄屏布局。")
    browser.close()
