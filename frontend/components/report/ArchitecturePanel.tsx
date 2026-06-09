import { getPath, isPlainObject } from '../../lib/report-utils';
import { AgentOutputCard, CodeBlock } from './AgentOutputCard';
import { ReportSection } from './ReportSection';

type ArchitecturePanelProps = {
  architecture: Record<string, unknown>;
};

export function ArchitecturePanel({ architecture }: ArchitecturePanelProps) {
  const mermaid = getPath(architecture, ['mermaid_diagram', 'diagram', 'architecture_diagram']);

  return (
    <ReportSection
      eyebrow="C"
      title="Architecture"
      description="System shape, service boundaries, data movement, security, and deployment posture."
    >
      <AgentOutputCard title="Architecture overview" value={getPath(architecture, ['summary', 'overview'])} />
      <AgentOutputCard title="Architecture style" value={getPath(architecture, ['architecture_style', 'style'])} />
      <AgentOutputCard title="Services and modules" value={getPath(architecture, ['services', 'modules'])} />
      <AgentOutputCard title="Data flow" value={getPath(architecture, ['data_flow', 'flows'])} />
      <AgentOutputCard title="Technology and deployment choices" value={getPath(architecture, ['deployment_plan', 'technology_choices', 'tech_stack'])} />
      <AgentOutputCard title="Security considerations" value={getPath(architecture, ['security_controls', 'security_considerations', 'security'])} />
      <AgentOutputCard title="Reliability and risks" value={getPath(architecture, ['reliability_controls', 'risks'])} />
      {typeof mermaid === 'string' && mermaid.trim() && (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-slate-950">Mermaid diagram</h3>
          <CodeBlock code={mermaid} language="mermaid" />
        </article>
      )}
      {!isPlainObject(architecture) && <AgentOutputCard title="Architecture output" value={architecture} />}
    </ReportSection>
  );
}
