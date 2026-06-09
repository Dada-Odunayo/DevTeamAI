import { getPath, isPlainObject } from '../../lib/report-utils';
import { AgentOutputCard } from './AgentOutputCard';
import { KeyValueList } from './KeyValueList';
import { ReportSection } from './ReportSection';

type FrontendPlanPanelProps = {
  frontend: Record<string, unknown>;
};

export function FrontendPlanPanel({ frontend }: FrontendPlanPanelProps) {
  const stackDecision = getPath(frontend, ['frontend_stack_decision']);
  const architecture = getPath(frontend, ['frontend_architecture']);
  const frontendArchitecture = isPlainObject(architecture) ? architecture : frontend;

  return (
    <ReportSection
      eyebrow="E"
      title="Frontend Plan"
      description="Frontend stack decision, screens/pages, flows, state, offline behavior, authentication, permissions, and implementation risks."
    >
      <AgentOutputCard title="Frontend overview" value={getPath(frontend, ['summary', 'overview'])} />
      <AgentOutputCard title="Stack decision" value={stackDecision} />
      {isPlainObject(stackDecision) && (
        <KeyValueList
          entries={[
            ['selected_stack', getPath(stackDecision, ['selected_stack'])],
            ['recommended_stack', getPath(stackDecision, ['recommended_stack'])],
            ['reasoning', getPath(stackDecision, ['reasoning'])],
            ['tradeoffs', getPath(stackDecision, ['tradeoffs'])],
            ['alternative_stacks', getPath(stackDecision, ['alternative_stacks'])],
          ]}
        />
      )}
      <AgentOutputCard title="Screens or pages" value={getPath(frontendArchitecture, ['screens_or_pages', 'screens'])} />
      <AgentOutputCard title="Navigation flow" value={getPath(frontendArchitecture, ['navigation_flow', 'flows'])} />
      <AgentOutputCard title="State management" value={getPath(frontendArchitecture, ['state_management'])} />
      <AgentOutputCard title="API integration strategy" value={getPath(frontendArchitecture, ['api_integration_strategy', 'api_integration_plan', 'api_integration'])} />
      <AgentOutputCard title="Offline strategy" value={getPath(frontendArchitecture, ['offline_strategy', 'offline'])} />
      <AgentOutputCard title="Authentication flow" value={getPath(frontendArchitecture, ['authentication_flow', 'auth_flow'])} />
      <AgentOutputCard title="Permissions" value={getPath(frontendArchitecture, ['permissions'])} />
      <AgentOutputCard title="Performance considerations" value={getPath(frontendArchitecture, ['performance_considerations', 'performance_concerns'])} />
      <AgentOutputCard title="Recommended libraries" value={getPath(frontendArchitecture, ['recommended_libraries'])} />
      <AgentOutputCard title="Implementation plan" value={getPath(frontend, ['implementation_plan'])} />
      <AgentOutputCard title="Risks" value={getPath(frontend, ['risks', 'edge_cases'])} />
      <AgentOutputCard title="Acceptance criteria" value={getPath(frontend, ['acceptance_criteria'])} />
    </ReportSection>
  );
}
