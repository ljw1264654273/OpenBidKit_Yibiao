import { useState } from 'react';
import RemoteKnowledgePicker from '../../technical-plan/components/RemoteKnowledgePicker';
import type { RemoteKnowledgeScope } from '../../technical-plan/types';

export default function RemoteKnowledgeBasePage() {
  const [scopes, setScopes] = useState<RemoteKnowledgeScope[]>([]);

  return (
    <div className="page-stack knowledge-page remote-knowledge-page">
      <section className="knowledge-workspace-bar knowledge-category-header">
        <div className="knowledge-breadcrumb">
          <span>一级知识库</span>
          <strong>远程知识库</strong>
          <small>当前页面的选择仅保留在本次页面会话中</small>
        </div>
      </section>
      <section className="remote-knowledge-page-panel">
        <RemoteKnowledgePicker scopes={scopes} onChange={setScopes} />
      </section>
    </div>
  );
}
