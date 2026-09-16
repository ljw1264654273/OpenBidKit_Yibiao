import type { BidProject } from '../types';

interface BidProjectCompareBarProps {
  selectedProjects: BidProject[];
  sensitivity: 'low' | 'medium' | 'high';
  loading?: boolean;
  onSensitivityChange: (sensitivity: 'low' | 'medium' | 'high') => void;
  onSwap: () => void;
  onClear: () => void;
  onStart: () => void;
}

function BidProjectCompareBar({
  selectedProjects,
  sensitivity,
  loading = false,
  onSensitivityChange,
  onSwap,
  onClear,
  onStart,
}: BidProjectCompareBarProps) {
  if (!selectedProjects.length) return null;
  const hasPair = selectedProjects.length === 2;
  const left = selectedProjects[0];
  const right = selectedProjects[1];

  return (
    <section className={`bid-project-compare-bar${hasPair ? ' is-ready' : ' is-pending'}`} aria-label="正文对比选择">
      <div className="bid-project-compare-bar-copy">
        <span className="section-kicker">正文查重</span>
        <strong>{hasPair ? '已选择两份标书，可以开始对比' : '请选择另一份标书'}</strong>
        <small>{hasPair ? '左右顺序只影响结果展示，不会修改任何正文。' : `已选择：${left.projectName}`}</small>
      </div>
      <div className="bid-project-compare-pair">
        <div className="bid-project-compare-project">
          <span>左侧方案</span>
          <strong>{left.projectName}</strong>
        </div>
        <span className="bid-project-compare-arrow">对比</span>
        <div className={`bid-project-compare-project${hasPair ? '' : ' is-empty'}`}>
          <span>右侧方案</span>
          <strong>{right?.projectName || '等待选择'}</strong>
        </div>
      </div>
      <div className="bid-project-compare-actions">
        {hasPair ? (
          <>
            <label>
              <span>灵敏度</span>
              <select value={sensitivity} onChange={(event) => onSensitivityChange(event.target.value as 'low' | 'medium' | 'high')}>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <button type="button" className="secondary-action" onClick={onSwap} disabled={loading}>交换左右</button>
            <button type="button" className="secondary-action" onClick={onClear} disabled={loading}>取消选择</button>
            <button type="button" className="primary-action" onClick={onStart} disabled={loading}>
              {loading ? '正在对比…' : '开始对比'}
            </button>
          </>
        ) : (
          <button type="button" className="secondary-action" onClick={onClear}>取消选择</button>
        )}
      </div>
    </section>
  );
}

export default BidProjectCompareBar;
