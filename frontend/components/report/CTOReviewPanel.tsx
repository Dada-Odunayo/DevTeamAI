import { getPath } from '../../lib/report-utils';
import { AgentOutputCard } from './AgentOutputCard';
import { MetricCard } from './MetricCard';
import { ReportSection } from './ReportSection';

type CTOReviewPanelProps = {
  ctoReview: Record<string, unknown>;
};

export function CTOReviewPanel({ ctoReview }: CTOReviewPanelProps) {
  const qualityScore = getPath(ctoReview, ['quality_score']);
  const approved = getPath(ctoReview, ['approved_for_mvp']);
  const requiresRevision = getPath(ctoReview, ['requires_revision']);

  return (
    <ReportSection
      eyebrow="G"
      title="CTO Review"
      description="Senior technical review of missing requirements, contradictions, risks, and final decision."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Quality score" value={typeof qualityScore === 'number' ? qualityScore : 'N/A'} />
        <MetricCard label="Approved for MVP" value={approved === true ? 'Yes' : approved === false ? 'No' : 'N/A'} />
        <MetricCard label="Revision required" value={requiresRevision === true ? 'Yes' : requiresRevision === false ? 'No' : 'N/A'} />
      </div>
      <AgentOutputCard title="Review summary" value={getPath(ctoReview, ['summary'])} />
      <AgentOutputCard title="Missing requirements and critical findings" value={getPath(ctoReview, ['critical_findings', 'missing_requirements'])} />
      <AgentOutputCard title="Contradictions" value={getPath(ctoReview, ['conflicts_detected', 'contradictions'])} />
      <AgentOutputCard title="Technical and MVP risks" value={getPath(ctoReview, ['mvp_risks', 'technical_risks', 'risks'])} />
      <AgentOutputCard title="Recommended changes" value={getPath(ctoReview, ['revision_brief', 'recommended_changes'])} />
    </ReportSection>
  );
}
