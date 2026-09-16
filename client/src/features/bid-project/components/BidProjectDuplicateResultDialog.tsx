import { useEffect, useMemo, useRef, useState } from 'react';
import { AppDialog, useToast } from '../../../shared/ui';
import { bidProjectStorage } from '../services/bidProjectStorage';
import {
  buildIgnoredDecisionPatch,
  canConfirmRewrite,
  getRewriteTarget,
} from '../services/duplicateRewriteUi';
import type {
  BidContentDuplicateMatch,
  BidContentDuplicateResult,
  BidContentDuplicateTargetSide,
  BidProject,
} from '../types';

interface BidProjectDuplicateResultDialogProps {
  open: boolean;
  result: BidContentDuplicateResult | null;
  leftProject: BidProject | null;
  rightProject: BidProject | null;
  onOpenChange: (open: boolean) => void;
  onResultChange: (result: BidContentDuplicateResult) => void;
  onRecompare: () => Promise<void>;
}

type MatchDrafts = Record<string, string>;
type MatchTargets = Record<string, Exclude<BidContentDuplicateTargetSide, 'none'>>;
type MatchLoading = Record<string, boolean>;
type MatchErrors = Record<string, string>;
type MatchMeta = Record<string, { reason: string; riskNote: string }>;

function getInitialTarget(match: BidContentDuplicateMatch): Exclude<BidContentDuplicateTargetSide, 'none'> {
  return match.decisionTargetSide === 'left' || match.decisionTargetSide === 'right'
    ? match.decisionTargetSide
    : 'right';
}

function BidProjectDuplicateResultDialog({
  open,
  result,
  leftProject,
  rightProject,
  onOpenChange,
  onResultChange,
  onRecompare,
}: BidProjectDuplicateResultDialogProps) {
  const { showToast } = useToast();
  const [targets, setTargets] = useState<MatchTargets>({});
  const [drafts, setDrafts] = useState<MatchDrafts>({});
  const [loading, setLoading] = useState<MatchLoading>({});
  const [errors, setErrors] = useState<MatchErrors>({});
  const [meta, setMeta] = useState<MatchMeta>({});
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const matchRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!result) return;
    setTargets(Object.fromEntries(result.matches.map((match) => [match.id, getInitialTarget(match)])));
    setDrafts(Object.fromEntries(result.matches.map((match) => [match.id, match.rewriteDraft || ''])));
    setLoading({});
    setErrors({});
    setMeta({});
    setActiveMatchId(result.matches[0]?.id || null);
  }, [result?.resultId]);

  const checkedMatches = useMemo(() => result?.matches || [], [result]);

  const focusMatch = (matchId: string) => {
    setActiveMatchId(matchId);
    matchRefs.current[matchId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const rewriteMatch = async (match: BidContentDuplicateMatch) => {
    if (!result || !leftProject || !rightProject) return;
    const targetSide = targets[match.id] || 'right';
    setLoading((previous) => ({ ...previous, [match.id]: true }));
    setErrors((previous) => ({ ...previous, [match.id]: '' }));
    try {
      const response = await bidProjectStorage.rewriteDuplicateMatch({
        resultId: result.resultId || '',
        matchId: match.id,
        targetSide,
        leftProjectId: leftProject.projectId,
        rightProjectId: rightProject.projectId,
      });
      setDrafts((previous) => ({ ...previous, [match.id]: response.rewrittenText }));
      setMeta((previous) => ({
        ...previous,
        [match.id]: { reason: response.reason, riskNote: response.riskNote },
      }));
      showToast('AI 改写草稿已生成，请核对后再确认替换', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 改写失败，请重试';
      setErrors((previous) => ({ ...previous, [match.id]: message }));
      showToast(message, 'error');
    } finally {
      setLoading((previous) => ({ ...previous, [match.id]: false }));
    }
  };

  const confirmRewrite = async (match: BidContentDuplicateMatch) => {
    if (!result || !leftProject || !rightProject) return;
    const targetSide = targets[match.id] || 'right';
    const draft = drafts[match.id] || '';
    if (!canConfirmRewrite(draft)) {
      showToast('请先生成或填写改写草稿', 'info');
      return;
    }
    const target = getRewriteTarget(
      match,
      targetSide,
      leftProject.projectId,
      rightProject.projectId,
      leftProject.projectName,
      rightProject.projectName,
    );
    if (!target.nodeId) {
      showToast('当前重复组缺少正文节点定位，请重新查重', 'error');
      return;
    }
    setLoading((previous) => ({ ...previous, [match.id]: true }));
    setErrors((previous) => ({ ...previous, [match.id]: '' }));
    try {
      await bidProjectStorage.replaceContent(target.projectId, {
        nodeId: target.nodeId,
        oldText: target.oldText,
        newText: draft.trim(),
      });
      const updated = await bidProjectStorage.updateDuplicateMatchDecision({
        resultId: result.resultId || '',
        matchId: match.id,
        decision: 'rewritten',
        targetSide,
        rewriteDraft: draft.trim(),
      });
      onResultChange(updated);
      showToast(`已替换${target.projectLabel}正文，正在重新查重`, 'success');
      await onRecompare();
    } catch (error) {
      const message = error instanceof Error ? error.message : '替换正文失败，请重新查重';
      setErrors((previous) => ({ ...previous, [match.id]: message }));
      showToast(message, 'error');
    } finally {
      setLoading((previous) => ({ ...previous, [match.id]: false }));
    }
  };

  const ignoreMatch = async (match: BidContentDuplicateMatch) => {
    if (!result) return;
    setLoading((previous) => ({ ...previous, [match.id]: true }));
    setErrors((previous) => ({ ...previous, [match.id]: '' }));
    try {
      const updated = await bidProjectStorage.updateDuplicateMatchDecision(
        buildIgnoredDecisionPatch(result.resultId || '', match.id),
      );
      onResultChange(updated);
      showToast('已标记为无需改写', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存人工判断失败';
      setErrors((previous) => ({ ...previous, [match.id]: message }));
      showToast(message, 'error');
    } finally {
      setLoading((previous) => ({ ...previous, [match.id]: false }));
    }
  };

  const changeRewriteTarget = (matchId: string, targetSide: Exclude<BidContentDuplicateTargetSide, 'none'>) => {
    setTargets((previous) => ({ ...previous, [matchId]: targetSide }));
    setDrafts((previous) => ({ ...previous, [matchId]: '' }));
    setMeta((previous) => {
      const next = { ...previous };
      delete next[matchId];
      return next;
    });
    setErrors((previous) => ({ ...previous, [matchId]: '' }));
  };

  return (
    <AppDialog
      open={open && Boolean(result && leftProject && rightProject)}
      onOpenChange={onOpenChange}
      cardClassName="bid-project-duplicate-dialog-card"
      kicker="同源正文对比查重"
      title={leftProject && rightProject ? `${leftProject.projectName} / ${rightProject.projectName}` : '正文对比查重'}
      description="两侧正文仅用于定位重复内容。AI 改写只生成当前组草稿，确认替换后才会写回目标文件。"
      actions={<button type="button" className="secondary-action" onClick={() => onOpenChange(false)}>关闭</button>}
    >
      {result ? (
        <div className="bid-project-duplicate-dialog">
          <div className="bid-project-duplicate-result-overview">
            <div>
              <span>本次比较</span>
              <strong>{result.summary.leftParagraphCount} / {result.summary.rightParagraphCount} 段</strong>
            </div>
            <div>
              <span>重复组</span>
              <strong>{result.summary.duplicateParagraphCount}</strong>
            </div>
            <div>
              <span>最高相似度</span>
              <strong>{Math.round(result.summary.maxSimilarity * 100)}%</strong>
            </div>
            <div>
              <span>判定阈值</span>
              <strong>{Math.round((result.threshold || result.summary.threshold || 0) * 100)}%</strong>
            </div>
          </div>
          {checkedMatches.length === 0 ? (
            <div className="bid-project-duplicate-empty">
              <strong>暂未发现需要处理的重复内容</strong>
              <span>可以关闭结果窗口，列表页仍会保留本次查重摘要。</span>
            </div>
          ) : (
            <div className="bid-project-match-list">
              {checkedMatches.map((match, index) => {
                const targetSide = targets[match.id] || 'right';
                const target = targetSide === 'left' ? match.leftParagraph.text : match.rightParagraph.text;
                const reference = targetSide === 'left' ? match.rightParagraph.text : match.leftParagraph.text;
                const ignored = match.decision === 'ignored';
                return (
                  <article
                    className={`bid-project-match${activeMatchId === match.id ? ' is-active' : ''}`}
                    key={match.id}
                    ref={(element) => { matchRefs.current[match.id] = element; }}
                  >
                    <div className="bid-project-match-heading">
                      <div>
                        <span>重复组 {index + 1}</span>
                        <strong>相似度 {Math.round(match.similarity * 100)}%</strong>
                      </div>
                      {ignored ? <em>已标记无需改写</em> : null}
                    </div>
                    <div className="bid-project-match-columns">
                      <button type="button" className={`bid-project-match-side${activeMatchId === match.id ? ' is-focused' : ''}`} onClick={() => focusMatch(match.id)} aria-pressed={activeMatchId === match.id}>
                        <span>左侧文件 · {leftProject?.projectName}</span>
                        <p>{match.leftParagraph.text}</p>
                      </button>
                      <button type="button" className={`bid-project-match-side${activeMatchId === match.id ? ' is-focused' : ''}`} onClick={() => focusMatch(match.id)} aria-pressed={activeMatchId === match.id}>
                        <span>右侧文件 · {rightProject?.projectName}</span>
                        <p>{match.rightParagraph.text}</p>
                      </button>
                    </div>
                    <div className="bid-project-match-workbench">
                      <div className="bid-project-match-instruction">
                        <strong>{match.suggestion.title}</strong>
                        <p>{match.suggestion.instruction}</p>
                      </div>
                      {!ignored ? (
                        <>
                          <div className="bid-project-match-target-row">
                            <label>
                              <span>改写目标文件</span>
                              <select
                                value={targetSide}
                                onChange={(event) => changeRewriteTarget(
                                  match.id,
                                  event.target.value as Exclude<BidContentDuplicateTargetSide, 'none'>,
                                )}
                              >
                                <option value="left">改写左侧文件</option>
                                <option value="right">改写右侧文件</option>
                              </select>
                            </label>
                            <small>另一侧作为参考：只帮助理解重复点，不会被修改，也不会照搬其表达。</small>
                          </div>
                          <div className="bid-project-rewrite-preview">
                            <div>
                              <span>当前目标原文</span>
                              <p>{target}</p>
                            </div>
                            <div>
                              <span>参考文本</span>
                              <p>{reference}</p>
                            </div>
                          </div>
                          <textarea
                            value={drafts[match.id] || ''}
                            onChange={(event) => setDrafts((previous) => ({ ...previous, [match.id]: event.target.value }))}
                            placeholder="点击“AI 改写”生成草稿，也可以直接手动编辑"
                            aria-label={`重复组 ${index + 1} 的改写草稿`}
                          />
                          {meta[match.id] ? (
                            <div className="bid-project-rewrite-note">
                              <span>改写说明：{meta[match.id].reason}</span>
                              <span>风险提示：{meta[match.id].riskNote}</span>
                            </div>
                          ) : null}
                          {errors[match.id] ? <div className="bid-project-rewrite-error">{errors[match.id]}</div> : null}
                          <div className="bid-project-match-action-row">
                            <button type="button" className="secondary-action" onClick={() => { void rewriteMatch(match); }} disabled={loading[match.id]}>
                              {loading[match.id] ? '处理中…' : 'AI 改写'}
                            </button>
                            <button type="button" className="primary-action" onClick={() => { void confirmRewrite(match); }} disabled={loading[match.id] || !canConfirmRewrite(drafts[match.id]) || !((targetSide === 'left' ? match.leftNodeId : match.rightNodeId))}>
                              确认替换
                            </button>
                            <button type="button" className="text-button" onClick={() => { void ignoreMatch(match); }} disabled={loading[match.id]}>
                              无需改写
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="bid-project-ignored-row">
                          <span>已保留人工判断，不修改任何正文。</span>
                          <button type="button" className="text-button" onClick={() => {
                            void bidProjectStorage.updateDuplicateMatchDecision({
                              resultId: result.resultId || '',
                              matchId: match.id,
                              decision: 'pending',
                              targetSide: 'none',
                            }).then(onResultChange).catch((error) => {
                              showToast(error instanceof Error ? error.message : '恢复处理状态失败', 'error');
                            });
                          }}>恢复处理</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </AppDialog>
  );
}

export default BidProjectDuplicateResultDialog;
