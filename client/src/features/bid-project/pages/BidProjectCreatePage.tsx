import { EmptyState, useToast } from '../../../shared/ui';
import { createBidProjectFromTenderFiles } from '../services/createBidProjectFromTenderFiles';
import type { BidProject } from '../types';

interface BidProjectCreatePageProps {
  onBack: () => void;
  onProjectOpen: (project: BidProject) => Promise<void>;
}

function BidProjectCreatePage({ onBack, onProjectOpen }: BidProjectCreatePageProps) {
  const { showToast } = useToast();

  return (
    <div className="bid-project-page">
      <header className="bid-project-page-head">
        <div>
          <span className="section-kicker">新建标书</span>
          <h1>新建标书</h1>
          <p>导入招标文件，创建一份新的标书项目。</p>
        </div>
        <button type="button" className="secondary-action" onClick={onBack}>返回标书目录</button>
      </header>
      <section className="bid-project-list-panel">
        <EmptyState title="选择招标文件" hint="可同时导入多份招标文件。">
          <button
            type="button"
            className="primary-action"
            onClick={() => { void createBidProjectFromTenderFiles({ showToast, onProjectOpen }); }}
          >
            选择招标文件
          </button>
        </EmptyState>
      </section>
    </div>
  );
}

export default BidProjectCreatePage;
