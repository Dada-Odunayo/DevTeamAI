import { getPath } from '../../lib/report-utils';
import { AgentOutputCard } from './AgentOutputCard';
import { ReportSection } from './ReportSection';

type QAPlanPanelProps = {
  qa: Record<string, unknown>;
};

export function QAPlanPanel({ qa }: QAPlanPanelProps) {
  return (
    <ReportSection
      eyebrow="F"
      title="QA Plan"
      description="Validation strategy across happy paths, negative paths, integration, performance, and security."
    >
      <AgentOutputCard title="Test strategy" value={getPath(qa, ['test_strategy', 'summary'])} />
      <AgentOutputCard title="Functional tests" value={getPath(qa, ['acceptance_tests', 'functional_tests'])} />
      <AgentOutputCard title="Negative tests" value={getPath(qa, ['negative_tests'])} />
      <AgentOutputCard title="Integration tests" value={getPath(qa, ['integration_tests'])} />
      <AgentOutputCard title="Edge cases" value={getPath(qa, ['edge_cases'])} />
      <AgentOutputCard title="Performance tests" value={getPath(qa, ['performance_tests'])} />
      <AgentOutputCard title="Security tests" value={getPath(qa, ['security_tests'])} />
      <AgentOutputCard title="Automation plan" value={getPath(qa, ['automation_plan'])} />
    </ReportSection>
  );
}
