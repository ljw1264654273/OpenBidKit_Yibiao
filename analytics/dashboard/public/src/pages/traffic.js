import { assertReady, buildRangeQuery, getEncodedProjectAndDays, loadProjectOptions, requestJson, saveSettings } from '../api.js';
import { renderTable } from '../render.js';
import { state } from '../state.js';

const pageLabels = {
  'bid-generation': '标书生成',
  'technical-plan': '技术方案',
  'bid-projects': '我的标书',
  'existing-plan-expansion': '已有方案扩写',
  'technical-plan/document-analysis': '技术方案 - 上传招标文件',
  'technical-plan/bid-analysis': '技术方案 - 招标文件解析',
  'technical-plan/outline-generation': '技术方案 - 目录生成',
  'technical-plan/global-facts': '技术方案 - 全局事实设定',
  'technical-plan/content-edit': '技术方案 - 生成正文',
  'technical-plan/expand': '技术方案 - 扩写改写',
  'existing-plan-expansion/document-analysis': '已有方案扩写 - 选择标书',
  'existing-plan-expansion/bid-analysis': '已有方案扩写 - 招标文件解析',
  'existing-plan-expansion/outline-generation': '已有方案扩写 - 目录生成',
  'existing-plan-expansion/global-facts': '已有方案扩写 - 全局事实设定',
  'existing-plan-expansion/content-edit': '已有方案扩写 - 生成正文',
  'existing-plan-expansion/expand': '已有方案扩写 - 扩写改写',
  'feasibility-report': '可行性研究报告',
  'feasibility-report/materials': '可行性研究报告 - 项目资料',
  'feasibility-report/sources': '可行性研究报告 - 项目资料文件',
  'feasibility-report/analysis': '可行性研究报告 - 资料分析',
  'feasibility-report/outline': '可行性研究报告 - 报告目录',
  'feasibility-report/parameters': '可行性研究报告 - 关键参数',
  'feasibility-report/content': '可行性研究报告 - 正文生成',
  'business-bid': '商务标',
  'knowledge-base': '知识库',
  resources: '资源下载',
  'document-knowledge-base': '文档知识库',
  'national-standard-knowledge-base': '国标知识库',
  'provincial-standard-knowledge-base': '省标知识库',
  'municipal-standard-knowledge-base': '市标知识库',
  'industry-standard-knowledge-base': '行业标知识库',
  'enterprise-knowledge-base': '企业知识库',
  'remote-knowledge-base': '远程知识库',
  'image-knowledge-base': '图片知识库',
  'knowledge-base/library': '知识库 - 文档列表',
  'knowledge-base/viewer/items': '知识库 - 知识条目',
  'knowledge-base/viewer/markdown': '知识库 - Markdown 原文',
  'knowledge-base/viewer/analysis': '知识库 - 分析调试',
  'document-knowledge-base/library': '文档知识库 - 文档列表',
  'document-knowledge-base/viewer/items': '文档知识库 - 知识条目',
  'document-knowledge-base/viewer/markdown': '文档知识库 - Markdown 原文',
  'document-knowledge-base/viewer/analysis': '文档知识库 - 分析调试',
  'national-standard-knowledge-base/library': '国标知识库 - 文档列表',
  'national-standard-knowledge-base/viewer/items': '国标知识库 - 知识条目',
  'national-standard-knowledge-base/viewer/markdown': '国标知识库 - Markdown 原文',
  'national-standard-knowledge-base/viewer/analysis': '国标知识库 - 分析调试',
  'provincial-standard-knowledge-base/library': '省标知识库 - 文档列表',
  'provincial-standard-knowledge-base/viewer/items': '省标知识库 - 知识条目',
  'provincial-standard-knowledge-base/viewer/markdown': '省标知识库 - Markdown 原文',
  'provincial-standard-knowledge-base/viewer/analysis': '省标知识库 - 分析调试',
  'municipal-standard-knowledge-base/library': '市标知识库 - 文档列表',
  'municipal-standard-knowledge-base/viewer/items': '市标知识库 - 知识条目',
  'municipal-standard-knowledge-base/viewer/markdown': '市标知识库 - Markdown 原文',
  'municipal-standard-knowledge-base/viewer/analysis': '市标知识库 - 分析调试',
  'industry-standard-knowledge-base/library': '行业标知识库 - 文档列表',
  'industry-standard-knowledge-base/viewer/items': '行业标知识库 - 知识条目',
  'industry-standard-knowledge-base/viewer/markdown': '行业标知识库 - Markdown 原文',
  'industry-standard-knowledge-base/viewer/analysis': '行业标知识库 - 分析调试',
  'enterprise-knowledge-base/library': '企业知识库 - 文档列表',
  'enterprise-knowledge-base/viewer/items': '企业知识库 - 知识条目',
  'enterprise-knowledge-base/viewer/markdown': '企业知识库 - Markdown 原文',
  'enterprise-knowledge-base/viewer/analysis': '企业知识库 - 分析调试',
  'bid-check': '标书检查',
  'duplicate-check': '标书查重',
  'duplicate-check/upload': '标书查重 - 选择标书',
  'duplicate-check/analysis/metadata': '标书查重 - 元数据结果',
  'duplicate-check/analysis/outline': '标书查重 - 目录结果',
  'duplicate-check/analysis/content': '标书查重 - 正文结果',
  'duplicate-check/analysis/image': '标书查重 - 图片结果',
  'rejection-check': '废标项检查',
  'rejection-check/documents/tender': '废标项检查 - 招标文件',
  'rejection-check/documents/bid': '废标项检查 - 投标文件',
  'rejection-check/items/analysis': '废标项检查 - 解析结果',
  'rejection-check/items/custom': '废标项检查 - 自定义检查项',
  'rejection-check/results/rejection': '废标项检查 - 废标项结果',
  'rejection-check/results/typo': '废标项检查 - 错别字结果',
  'rejection-check/results/logic': '废标项检查 - 逻辑谬误结果',
  'template-settings': '模版设置',
  'my-templates': '模版设置 - 我的模板',
  'my-templates/edit': '模版设置 - 编辑模板',
  'new-template': '模版设置 - 新建模板',
  'export-format': '模版设置 - 新建模板',
  'bid-opportunity': '投标机会',
  'plugin-manager': '插件管理',
  'developer-test': '测试页',
  'developer-json-test': '测试页 - Json请求测试',
  'developer-multimodal-test': '测试页 - 多模态测试',
  'developer-prompt-lab': '测试页 - Prompt调试台',
  'developer-parser-sandbox': '测试页 - 文件解析沙盘',
  'developer-export-preview': '测试页 - 导出链路预演',
  'developer-agent-test': '测试页 - 智能体链路测试',
  settings: '设置',
};

function getPageLabel(page) {
  return pageLabels[page] || '未知页面';
}

export async function loadTraffic() {
  assertReady();
  await loadProjectOptions();
  saveSettings();

  const range = state.trafficRange.value;
  const { projectName } = getEncodedProjectAndDays();
  const summary = await requestJson(`/api/traffic?projectName=${projectName}&${buildRangeQuery(range)}`);
  const pages = (summary.pages || []).map((row) => ({
    ...row,
    pageLabel: getPageLabel(row.page),
  }));

  renderTable(state.pagesTable, pages, [
    { key: 'pageLabel', label: '功能名称' },
    { key: 'page', label: '路由', code: true },
    { key: 'count', label: range === 'history' ? '累计访问量' : '访问量' },
  ], '暂无页面访问数据');

  renderTable(state.versionsTable, summary.versions || [], [
    { key: 'version', label: '版本', code: true },
    { key: 'count', label: range === 'history' ? '累计事件数' : '事件数' },
    { key: 'clients', label: '客户端数' },
  ], '暂无版本数据');
}
