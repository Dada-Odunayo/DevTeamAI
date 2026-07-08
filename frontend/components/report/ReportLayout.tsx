import { getArtifact, getPath, isEmptyValue, isPlainObject, pickEntries } from '../../lib/report-utils';
import { SectionTooltip } from '../Collapsible';
import { AgentOutputCard } from './AgentOutputCard';
import { BaselineComparisonPanel } from './BaselineComparisonPanel';
import { DatabaseSchemaPanel } from './DatabaseSchemaPanel';
import { EmptyState } from './EmptyState';
import { KeyValueList } from './KeyValueList';
import { MetricCard } from './MetricCard';
import { RawJsonDetails } from './RawJsonDetails';
import { ReportSection } from './ReportSection';

type ReportLayoutProps = {
  result: unknown;
  apiBaseUrl: string;
  expandedStageName?: string;
  requestContext?: {
    targetUsers?: string;
    platform?: string;
    preferredFrontendStack?: string;
  };
};

type StageMeta = {
  name: string;
  status?: string;
  version?: number;
  assigned_agent?: string;
  content?: unknown;
};

function scoreValue(score: unknown, key = 'overall_score') {
  const value = getPath(score, [key]) || getPath(score, ['overall']);
  return typeof value === 'number' || typeof value === 'string' ? value : 'N/A';
}

function hasValue(value: unknown) {
  return !isEmptyValue(value);
}

function stageMeta(result: unknown, stageName: string): StageMeta | undefined {
  if (!isPlainObject(result) || !Array.isArray(result.stages)) return undefined;
  return result.stages.find((stage): stage is StageMeta => isPlainObject(stage) && stage.name === stageName);
}

function isStageRenderable(stage?: StageMeta) {
  if (!stage) return false;
  return hasValue(stage.content) || stage.status === 'approved' || stage.status === 'awaiting_approval';
}

function getStageOutput(stage?: StageMeta) {
  const content = isPlainObject(stage?.content) ? stage.content : {};
  return content.output;
}

function SectionHeaderMeta({ stage }: { stage?: StageMeta }) {
  if (!stage) return null;
  return (
    <KeyValueList
      entries={[
        ['agent', stage.assigned_agent || 'Agent'],
        ['status', stage.status || 'not run'],
        ['version', typeof stage.version === 'number' ? stage.version : 0],
      ]}
    />
  );
}

export function ReportLayout({ result, apiBaseUrl, expandedStageName, requestContext }: ReportLayoutProps) {
  if (!isPlainObject(result)) {
    return <EmptyState message="Run stages to generate a polished DevTeam AI report." />;
  }

  const projectId = getPath(result, ['project_id']) || getPath(result, ['id']);
  const idea = getPath(result, ['idea']);
  const score = isPlainObject(result.score) ? result.score : {};
  const exportHref = typeof projectId === 'string' ? `${apiBaseUrl}/projects/${projectId}/export.zip` : '';

  const decompositionStage = stageMeta(result, 'decomposition');
  const prdStage = stageMeta(result, 'prd');
  const architectureStage = stageMeta(result, 'architecture');
  const backendStage = stageMeta(result, 'backend_plan');
  const frontendStage = stageMeta(result, 'frontend_plan');
  const qaStage = stageMeta(result, 'qa_plan');
  const ctoStage = stageMeta(result, 'cto_review');
  const negotiationStage = stageMeta(result, 'negotiation');
  const revisionStage = stageMeta(result, 'revision_summary');
  const codeGenerationStage = stageMeta(result, 'code_generation');
  const codeReviewStage = stageMeta(result, 'code_review');

  const prd = getArtifact(result, 'prd');
  const architecture = getArtifact(result, 'architecture');
  const backend = getArtifact(result, 'backend');
  const frontend = getArtifact(result, 'frontend');
  const legacyMobile = getArtifact(result, 'mobile');
  const frontendArtifact = Object.keys(frontend).length > 0 ? frontend : legacyMobile;
  const frontendArchitecture = isPlainObject(getPath(frontendArtifact, ['frontend_architecture']))
    ? getPath(frontendArtifact, ['frontend_architecture'])
    : frontendArtifact;
  const frontendStackDecision = getPath(frontendArtifact, ['frontend_stack_decision']);
  const qa = getArtifact(result, 'qa');
  const ctoReview = getArtifact(result, 'cto_review');
  const negotiation = getArtifact(result, 'negotiation');
  const revision = getArtifact(result, 'revision');
  const codeGeneration = getArtifact(result, 'code_generation');
  const codeReview = getArtifact(result, 'code_review');
  const baseline = result.baseline || result.baseline_comparison;
  const hasAnyReportContent =
    hasValue(prd) ||
    hasValue(architecture) ||
    hasValue(backend) ||
    hasValue(frontendArtifact) ||
    hasValue(qa) ||
    hasValue(ctoReview) ||
    hasValue(negotiation) ||
    hasValue(revision) ||
    hasValue(codeGeneration) ||
    hasValue(codeReview);

  if (!hasAnyReportContent) {
    return (
      <article className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-6 text-center shadow-sm">
        <div className="flex items-start justify-center gap-3">
          <h2 className="text-xl font-bold text-slate-950">Final Report</h2>
          <SectionTooltip
            label="About Final Report"
            text="The final report appears here after project stages produce structured planning outputs."
          />
        </div>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
          Run and approve stages to build the final report.
        </p>
      </article>
    );
  }

  return (
    <article className="space-y-2">
      <header className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Final Report</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">DevTeam AI Planning Report</h1>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-slate-600">
              Completed stage outputs are shown as accordions. Locked or unrun stages are hidden until they produce content.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SectionTooltip
              label="About Final Report"
              text="Collects every approved or generated artifact into a readable report. Use the accordions to inspect each stage output."
            />
            {exportHref && (
              <a
                className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                href={exportHref}
              >
                Export Deliverables
              </a>
            )}
          </div>
        </div>
      </header>

      {(hasValue(prd) || hasValue(score)) && (
        <ReportSection
          collapsible
          defaultExpanded={false}
          description="The project at a glance, with current stage score and recommendation."
          eyebrow="Summary"
          title="Executive Summary"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="DevTeam score" value={scoreValue(score)} helper="Deterministic artifact coverage score" />
            <MetricCard label="Architecture" value={scoreValue(score, 'architecture_completeness_score')} />
            <MetricCard label="Frontend" value={scoreValue(score, 'frontend_completeness_score')} />
            <MetricCard label="QA" value={scoreValue(score, 'qa_coverage_score')} />
          </div>
          <KeyValueList
            entries={([
              ['project_idea', idea || 'Not included in response'],
              ['target_users', getPath(prd, ['target_users']) || requestContext?.targetUsers],
              ['platform', getPath(result, ['platform']) || requestContext?.platform],
              [
                'preferred_frontend_stack',
                requestContext?.preferredFrontendStack ||
                  getPath(getPath(frontendArtifact, ['frontend_stack_decision']), ['selected_stack']),
              ],
              ['main_recommendation', getPath(revision, ['final_recommendation']) || getPath(ctoReview, ['revision_brief']) || getPath(prd, ['summary'])],
            ] as Array<[string, unknown]>).filter(([, value]) => hasValue(value))}
          />
        </ReportSection>
      )}

      {isStageRenderable(decompositionStage) && (
        <ReportSection
          agentName={decompositionStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={decompositionStage?.status}
          title="Task Decomposition"
          version={decompositionStage?.version}
        >
          <SectionHeaderMeta stage={decompositionStage} />
          <AgentOutputCard title="Summary" value={getPath(getStageOutput(decompositionStage), ['summary'])} />
          <AgentOutputCard title="Decomposed tasks" value={getPath(getStageOutput(decompositionStage), ['decomposed_tasks'])} />
          <AgentOutputCard title="Execution plan" value={getPath(getStageOutput(decompositionStage), ['execution_plan'])} />
          <AgentOutputCard title="Expected artifacts" value={getPath(getStageOutput(decompositionStage), ['expected_artifacts'])} />
          <AgentOutputCard title="Collaboration plan" value={getPath(getStageOutput(decompositionStage), ['collaboration_plan'])} />
          <AgentOutputCard title="Dependencies" value={getPath(getStageOutput(decompositionStage), ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(getStageOutput(decompositionStage), ['uncertainties'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(getStageOutput(decompositionStage), ['acceptance_criteria'])} />
        </ReportSection>
      )}

      {hasValue(prd) && (
        <ReportSection
          agentName={prdStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={prdStage?.status}
          title="Product Requirements"
          version={prdStage?.version}
        >
          <AgentOutputCard title="Problem statement" value={getPath(prd, ['problem_statement', 'summary'])} />
          <AgentOutputCard title="Target users and personas" value={getPath(prd, ['target_users', 'personas'])} />
          <AgentOutputCard title="Core features" value={getPath(prd, ['core_features', 'features'])} />
          <AgentOutputCard title="Functional requirements" value={getPath(prd, ['functional_requirements'])} />
          <AgentOutputCard title="Non-functional requirements" value={getPath(prd, ['non_functional_requirements'])} />
          <AgentOutputCard title="User stories" value={getPath(prd, ['user_stories'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(prd, ['acceptance_criteria'])} />
          <AgentOutputCard title="MVP scope" value={getPath(prd, ['mvp_scope'])} />
          <AgentOutputCard title="Out of scope" value={getPath(prd, ['out_of_scope', 'future_scope'])} />
          <AgentOutputCard title="Success metrics" value={getPath(prd, ['success_metrics'])} />
          <AgentOutputCard title="Risks" value={getPath(prd, ['risks'])} />
          <AgentOutputCard title="Dependencies" value={getPath(prd, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(prd, ['uncertainties'])} />
          <AgentOutputCard title="Assumptions" value={getPath(prd, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(architecture) && (
        <ReportSection
          agentName={architectureStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={architectureStage?.status}
          title="Architecture"
          version={architectureStage?.version}
        >
          <AgentOutputCard title="Architecture overview" value={getPath(architecture, ['summary'])} />
          <AgentOutputCard title="Architecture style" value={getPath(architecture, ['architecture_style'])} />
          <AgentOutputCard title="Services" value={getPath(architecture, ['services'])} />
          <AgentOutputCard title="Service boundaries" value={getPath(architecture, ['service_boundaries'])} />
          <AgentOutputCard title="Data storage plan" value={getPath(architecture, ['data_storage_plan'])} />
          <AgentOutputCard title="Sync strategy" value={getPath(architecture, ['sync_strategy'])} />
          <AgentOutputCard title="Integration strategy" value={getPath(architecture, ['integration_strategy'])} />
          <AgentOutputCard title="Data flow" value={getPath(architecture, ['data_flow'])} />
          <AgentOutputCard title="Security controls" value={getPath(architecture, ['security_controls'])} />
          <AgentOutputCard title="Reliability controls" value={getPath(architecture, ['reliability_controls'])} />
          <AgentOutputCard title="Deployment plan" value={getPath(architecture, ['deployment_plan'])} />
          <AgentOutputCard title="Risks" value={getPath(architecture, ['risks'])} />
          <AgentOutputCard title="Dependencies" value={getPath(architecture, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(architecture, ['uncertainties'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(architecture, ['acceptance_criteria'])} />
          <AgentOutputCard title="Architecture diagram" value={getPath(architecture, ['mermaid_diagram'])} codeLanguage="mermaid" />
        </ReportSection>
      )}

      {hasValue(backend) && (
        <ReportSection
          agentName={backendStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={backendStage?.status}
          title="Backend Plan"
          version={backendStage?.version}
        >
          <AgentOutputCard title="Backend overview" value={getPath(backend, ['summary', 'overview'])} />
          <DatabaseSchemaPanel backend={backend} />
          <AgentOutputCard title="API endpoints" value={getPath(backend, ['api_endpoints'])} />
          <AgentOutputCard title="Authentication and security strategy" value={getPath(backend, ['auth_strategy', 'security_notes'])} />
          <AgentOutputCard title="Validation rules and business rules" value={getPath(backend, ['validation_rules', 'business_rules'])} />
          <AgentOutputCard title="Background jobs" value={getPath(backend, ['background_jobs'])} />
          <AgentOutputCard title="Error handling" value={getPath(backend, ['error_handling'])} />
          <AgentOutputCard title="Observability and integration events" value={getPath(backend, ['observability', 'logging', 'integration_events'])} />
          <AgentOutputCard title="Frontend contract notes" value={getPath(backend, ['frontend_contract_notes'])} />
          <AgentOutputCard title="Risks" value={getPath(backend, ['risks'])} />
          <AgentOutputCard title="Dependencies" value={getPath(backend, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(backend, ['uncertainties'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(backend, ['acceptance_criteria'])} />
        </ReportSection>
      )}

      {hasValue(frontendArtifact) && (
        <ReportSection
          agentName={frontendStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={frontendStage?.status}
          title="Frontend Plan"
          version={frontendStage?.version}
        >
          <AgentOutputCard title="Frontend overview" value={getPath(frontendArtifact, ['summary', 'overview'])} />
          <AgentOutputCard title="Stack decision" value={frontendStackDecision} />
          <AgentOutputCard title="Screens or pages" value={getPath(frontendArchitecture, ['screens_or_pages', 'screens'])} />
          <AgentOutputCard title="Navigation flow" value={getPath(frontendArchitecture, ['navigation_flow', 'flows'])} />
          <AgentOutputCard title="State management" value={getPath(frontendArchitecture, ['state_management'])} />
          <AgentOutputCard title="API integration strategy" value={getPath(frontendArchitecture, ['api_integration_strategy', 'api_integration_plan', 'api_integration'])} />
          <AgentOutputCard title="Offline strategy" value={getPath(frontendArchitecture, ['offline_strategy', 'offline'])} />
          <AgentOutputCard title="Authentication flow" value={getPath(frontendArchitecture, ['authentication_flow', 'auth_flow'])} />
          <AgentOutputCard title="Permissions" value={getPath(frontendArchitecture, ['permissions'])} />
          <AgentOutputCard title="Performance considerations" value={getPath(frontendArchitecture, ['performance_considerations', 'performance_concerns'])} />
          <AgentOutputCard title="Recommended libraries" value={getPath(frontendArchitecture, ['recommended_libraries'])} />
          <AgentOutputCard title="Accessibility notes" value={getPath(frontendArtifact, ['accessibility_notes'])} />
          <AgentOutputCard title="Design system notes" value={getPath(frontendArtifact, ['design_system_notes'])} />
          <AgentOutputCard title="Frontend/backend contracts" value={getPath(frontendArtifact, ['frontend_backend_contracts'])} />
          <AgentOutputCard title="Implementation plan" value={getPath(frontendArtifact, ['implementation_plan'])} />
          <AgentOutputCard title="Risks" value={getPath(frontendArtifact, ['risks', 'edge_cases'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(frontendArtifact, ['acceptance_criteria'])} />
          <AgentOutputCard title="Dependencies" value={getPath(frontendArtifact, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(frontendArtifact, ['uncertainties'])} />
          <AgentOutputCard title="Assumptions" value={getPath(frontendArtifact, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(qa) && (
        <ReportSection
          agentName={qaStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={qaStage?.status}
          title="QA Plan"
          version={qaStage?.version}
        >
          <AgentOutputCard title="QA overview" value={getPath(qa, ['summary'])} />
          <AgentOutputCard title="Test strategy" value={getPath(qa, ['test_strategy'])} />
          <AgentOutputCard title="Acceptance tests" value={getPath(qa, ['acceptance_tests'])} />
          <AgentOutputCard title="Negative tests" value={getPath(qa, ['negative_tests'])} />
          <AgentOutputCard title="Integration tests" value={getPath(qa, ['integration_tests'])} />
          <AgentOutputCard title="Performance tests" value={getPath(qa, ['performance_tests'])} />
          <AgentOutputCard title="Security tests" value={getPath(qa, ['security_tests'])} />
          <AgentOutputCard title="Offline and sync tests" value={getPath(qa, ['offline_and_sync_tests'])} />
          <AgentOutputCard title="Regression tests" value={getPath(qa, ['regression_tests'])} />
          <AgentOutputCard title="Automation plan" value={getPath(qa, ['automation_plan'])} />
          <AgentOutputCard title="Coverage gaps" value={getPath(qa, ['coverage_gaps'])} />
          <AgentOutputCard title="Dependencies" value={getPath(qa, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(qa, ['uncertainties'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(qa, ['acceptance_criteria'])} />
          <AgentOutputCard title="Assumptions" value={getPath(qa, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(ctoReview) && (
        <ReportSection
          agentName={ctoStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={ctoStage?.status}
          title="CTO Review"
          version={ctoStage?.version}
        >
          <AgentOutputCard title="CTO summary" value={getPath(ctoReview, ['summary'])} />
          <AgentOutputCard title="Critical findings" value={getPath(ctoReview, ['critical_findings'])} />
          <AgentOutputCard title="Conflicts detected" value={getPath(ctoReview, ['conflicts_detected'])} />
          <AgentOutputCard title="Agent challenges" value={getPath(ctoReview, ['agent_challenges'])} />
          <AgentOutputCard title="Missing requirements" value={getPath(ctoReview, ['missing_requirements'])} />
          <AgentOutputCard title="Security gaps" value={getPath(ctoReview, ['security_gaps'])} />
          <AgentOutputCard title="Frontend/backend mismatches" value={getPath(ctoReview, ['frontend_backend_mismatches'])} />
          <AgentOutputCard title="QA gaps" value={getPath(ctoReview, ['qa_gaps'])} />
          <AgentOutputCard title="MVP risks" value={getPath(ctoReview, ['mvp_risks'])} />
          <KeyValueList
            entries={([
              ['requires_revision', getPath(ctoReview, ['requires_revision'])],
              ['quality_score', getPath(ctoReview, ['quality_score'])],
              ['approved_for_mvp', getPath(ctoReview, ['approved_for_mvp'])],
            ] as Array<[string, unknown]>).filter(([, value]) => hasValue(value))}
          />
          <AgentOutputCard title="Revision brief" value={getPath(ctoReview, ['revision_brief'])} />
          <AgentOutputCard title="Dependencies" value={getPath(ctoReview, ['dependencies'])} />
          <AgentOutputCard title="Uncertainties" value={getPath(ctoReview, ['uncertainties'])} />
          <AgentOutputCard title="Assumptions" value={getPath(ctoReview, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(negotiation) && (
        <ReportSection
          agentName={negotiationStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={negotiationStage?.status}
          title="Negotiation Decisions"
          version={negotiationStage?.version}
        >
          <AgentOutputCard title="Decision title" value={getPath(negotiation, ['decision_title'])} />
          <AgentOutputCard title="Context" value={getPath(negotiation, ['context'])} />
          <AgentOutputCard title="Options considered" value={getPath(negotiation, ['options_considered'])} />
          <AgentOutputCard title="Agent positions" value={getPath(negotiation, ['agent_positions'])} />
          <AgentOutputCard title="Final decision" value={getPath(negotiation, ['final_decision'])} />
          <AgentOutputCard title="Decision rationale" value={getPath(negotiation, ['decision_rationale'])} />
          <AgentOutputCard title="Tradeoffs" value={getPath(negotiation, ['tradeoffs'])} />
          <AgentOutputCard title="Follow-up changes" value={getPath(negotiation, ['follow_up_changes'])} />
          <AgentOutputCard title="Affected artifacts" value={getPath(negotiation, ['affected_artifacts'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(negotiation, ['acceptance_criteria'])} />
          <AgentOutputCard title="Assumptions" value={getPath(negotiation, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(revision) && (
        <ReportSection
          agentName={revisionStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={revisionStage?.status}
          title="Revision Summary"
          version={revisionStage?.version}
        >
          <AgentOutputCard title="Revision overview" value={getPath(revision, ['summary'])} />
          <AgentOutputCard title="What changed" value={getPath(revision, ['changes'])} />
          <AgentOutputCard title="Resolved conflicts" value={getPath(revision, ['resolved_conflicts'])} />
          <AgentOutputCard title="Remaining risks" value={getPath(revision, ['remaining_risks'])} />
          <AgentOutputCard title="Final recommendation" value={getPath(revision, ['final_recommendation'])} />
          <AgentOutputCard title="Readiness for code generation" value={getPath(revision, ['readiness_for_code_generation'])} />
          <AgentOutputCard title="Dependencies" value={getPath(revision, ['dependencies'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(revision, ['acceptance_criteria'])} />
          <AgentOutputCard title="Assumptions" value={getPath(revision, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(codeGeneration) && (
        <ReportSection
          agentName={codeGenerationStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={codeGenerationStage?.status}
          title="Code Generation"
          version={codeGenerationStage?.version}
        >
          <AgentOutputCard title="Code generation summary" value={getPath(codeGeneration, ['summary'])} />
          <AgentOutputCard title="File tree" value={getPath(codeGeneration, ['file_tree'])} />
          <AgentOutputCard title="Environment variables" value={getPath(codeGeneration, ['environment_variables'])} />
          <AgentOutputCard title="Run instructions" value={getPath(codeGeneration, ['run_instructions'])} />
          <AgentOutputCard title="Generated files" value={getPath(codeGeneration, ['files'])} />
          <AgentOutputCard title="Acceptance criteria" value={getPath(codeGeneration, ['acceptance_criteria'])} />
          <AgentOutputCard title="Assumptions" value={getPath(codeGeneration, ['assumptions'])} />
        </ReportSection>
      )}

      {hasValue(codeReview) && (
        <ReportSection
          agentName={codeReviewStage?.assigned_agent}
          collapsible
          defaultExpanded={false}
          status={codeReviewStage?.status}
          title="Code Review"
          version={codeReviewStage?.version}
        >
          <AgentOutputCard title="Code review summary" value={getPath(codeReview, ['summary'])} />
          <AgentOutputCard title="Findings" value={getPath(codeReview, ['findings'])} />
          <AgentOutputCard title="Missing files" value={getPath(codeReview, ['missing_files'])} />
          <AgentOutputCard title="Contract gaps" value={getPath(codeReview, ['contract_gaps'])} />
          <AgentOutputCard title="Security gaps" value={getPath(codeReview, ['security_gaps'])} />
          <AgentOutputCard title="Run readiness" value={getPath(codeReview, ['run_readiness'])} />
          <KeyValueList
            entries={([
              ['approved_as_starter', getPath(codeReview, ['approved_as_starter'])],
            ] as Array<[string, unknown]>).filter(([, value]) => hasValue(value))}
          />
          <AgentOutputCard title="Acceptance criteria" value={getPath(codeReview, ['acceptance_criteria'])} />
          <AgentOutputCard title="Assumptions" value={getPath(codeReview, ['assumptions'])} />
        </ReportSection>
      )}

      {Boolean(baseline) && <BaselineComparisonPanel baseline={baseline} defaultExpanded={false} devteamScore={score} />}

      <ReportSection collapsible defaultExpanded={false} title="Additional Agent Details">
        <AgentOutputCard title="Product extras" value={Object.fromEntries(pickEntries(prd, ['agent', 'assumptions']))} />
        <AgentOutputCard title="Architecture extras" value={Object.fromEntries(pickEntries(architecture, ['agent', 'assumptions']))} />
        <AgentOutputCard title="Backend extras" value={Object.fromEntries(pickEntries(backend, ['agent', 'assumptions']))} />
        <AgentOutputCard title="Frontend extras" value={Object.fromEntries(pickEntries(frontendArtifact, ['agent', 'assumptions']))} />
        <AgentOutputCard title="QA extras" value={Object.fromEntries(pickEntries(qa, ['agent', 'assumptions']))} />
      </ReportSection>

      <RawJsonDetails value={result} />
    </article>
  );
}
