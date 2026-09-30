import json
from pathlib import Path
from playwright.sync_api import sync_playwright


OUTPUT_DIR = Path(r"C:\Users\admin\.codex\visualizations\2026\09\30\01a0f164-5561-7f10-bcc5-805d1d93504b")
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
              action: '删除本章及全文中与数据建库、登记发证相关的承诺和进度节点。', note: '', decision: 'pending'
            },
            {
              id: 'replace-location', category: '名称地点替换', priority: 'high',
              title: '项目实施地点由五峰村调整为横泾街道', historical_location: '全文项目名称、服务地点及组织架构',
              historical_excerpt: '项目实施范围为五峰村，配合村级工作人员开展服务。',
              tender_requirement: '本项目实施范围为横泾街道，表述层级统一为街道。',
              action: '全文替换地点和行政层级，不保留“五峰村”及村级表述。', note: '', decision: 'pending'
            },
            {
              id: 'update-workload', category: '数据更新', priority: 'medium',
              title: '按横泾街道实际工作量更新数量', historical_location: '第二章 项目概况与工作量测算',
              historical_excerpt: '原方案工作量按五峰村存量宗地数量测算。',
              tender_requirement: '以横泾街道招标文件载明的服务规模和数量为准。',
              action: '更新工作量基数、人员投入和设备配置中的关联数据。', note: '', decision: 'pending'
            },
            {
              id: 'update-schedule', category: '工期进度更新', priority: 'high',
              title: '重排三年服务期及分阶段节点', historical_location: '第六章 项目进度计划',
              historical_excerpt: '原方案以2026年6月开标为起点安排三年进度。',
              tender_requirement: '按2026年10月开标时间重新计算三年服务周期。',
              action: '更新起止日期，并同步调整准备、实施、验收各阶段节点。', note: '', decision: 'pending'
            }
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
            bidSectionMode: 'single', bidSections: [], bidSectionExtractionStatus: 'idle',
            outlineMode: 'standalone-technical', outlineExpansionMode: 'ai-complement',
            outlineWordControlOptions: {}, outlineMinimumDepth: 3,
            referenceKnowledgeDocumentIds: [], remoteKnowledgeScopes: [], globalFacts: [],
            contentGenerationSections: {}, contentGenerationPlans: {}, outlineData: null
          };
          const emitTask = (task, patch) => {
            workspaceState = { ...workspaceState, ...patch };
            taskListener?.({ task, technicalPlanPatch: patch });
          };
          window.__historicalMock = {
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
              startHistoricalAdaptationDifference: async () => ({ status: 'running' })
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
    first_item.locator("textarea").fill("删除相关章节，并清理全文交叉引用和对应进度节点。")
    first_item.locator("input").fill("已核对横泾街道招标范围")
    first_item.get_by_role("button", name="保存修改").click()
    first_item.get_by_role("button", name="确认此项").click()
    page.get_by_role("button", name="名称地点替换").click()
    page.get_by_text("项目实施地点由五峰村调整为横泾街道", exact=True).wait_for()
    page.get_by_role("button", name="待确认").click()

    page.locator(".historical-adaptation-difference-item").first.get_by_role("button", name="无需处理").click()
    page.locator(".historical-adaptation-difference-item").first.get_by_role("button", name="确认此项").click()
    page.locator(".historical-adaptation-difference-item").first.get_by_role("button", name="确认此项").click()
    page.get_by_text("全部差异已处理，等待验收", exact=True).wait_for()
    assert page.get_by_role("button", name="目录适配 待开放").is_disabled()
    page.wait_for_timeout(2500)
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-complete.png", full_page=True)

    page.set_viewport_size({"width": 760, "height": 900})
    page.locator(".historical-adaptation-difference-item").first.scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT_DIR / "historical-adaptation-differences-narrow.png", full_page=True)
    print("历史标书适配 UI 验证通过：上传、招标基线、差异筛选编辑、逐项确认、验收锁定和窄屏布局均已检查。")
    browser.close()
