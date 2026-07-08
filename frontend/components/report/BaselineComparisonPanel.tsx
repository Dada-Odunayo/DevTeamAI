import { getPath, isPlainObject, objectEntries } from '../../lib/report-utils';
import { AgentOutputCard, DataTable } from './AgentOutputCard';
import { MetricCard } from './MetricCard';
import { ReportSection } from './ReportSection';

type BaselineComparisonPanelProps = {
  baseline: unknown;
  devteamScore: unknown;
  defaultExpanded?: boolean;
};

export function BaselineComparisonPanel({ baseline, devteamScore, defaultExpanded = false }: BaselineComparisonPanelProps) {
  const isComparison = isPlainObject(baseline) && isPlainObject(getPath(baseline, ['single_agent']));
  const singleAgent = isComparison ? getPath(baseline, ['single_agent']) : baseline;
  const multiAgent = isComparison ? getPath(baseline, ['multi_agent']) : null;
  const efficiencyGain = isComparison ? getPath(baseline, ['efficiency_gain']) : null;
  const baselineScore = isComparison ? getPath(singleAgent, ['metrics']) : getPath(baseline, ['score']);
  const baselineOverall =
    getPath(singleAgent, ['overall_score']) ||
    getPath(baselineScore, ['overall_score']) ||
    getPath(baselineScore, ['overall']);
  const devteamOverall =
    getPath(multiAgent, ['overall_score']) ||
    getPath(devteamScore, ['overall_score']) ||
    getPath(devteamScore, ['overall']);
  const metricRows = [
    ...(isPlainObject(getPath(multiAgent, ['metrics']))
      ? objectEntries(getPath(multiAgent, ['metrics'])).map(([metric, value]) => ({
          metric,
          devteam: value,
          single_agent: getPath(baselineScore, [metric]),
        }))
      : isPlainObject(devteamScore)
        ? objectEntries(devteamScore).map(([metric, value]) => ({ metric, devteam: value }))
        : []),
  ];

  return (
    <ReportSection
      collapsible
      defaultExpanded={defaultExpanded}
      eyebrow="I"
      title="Baseline Comparison"
      description="Comparison between the single-agent baseline and the coordinated DevTeam AI workflow."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="DevTeam AI score" value={typeof devteamOverall === 'number' ? devteamOverall : 'N/A'} />
        <MetricCard label="Single-agent score" value={typeof baselineOverall === 'number' ? baselineOverall : 'N/A'} />
        <MetricCard
          label={isComparison ? "Improvement" : "Score delta"}
          value={
            isComparison && isPlainObject(efficiencyGain)
              ? `${getPath(efficiencyGain, ['score_improvement_percentage']) || 0}%`
              : typeof devteamOverall === 'number' && typeof baselineOverall === 'number'
              ? Math.round((devteamOverall - baselineOverall) * 10) / 10
              : 'N/A'
          }
        />
      </div>
      {metricRows.length > 0 && <DataTable rows={metricRows} />}
      {isComparison && <AgentOutputCard title="Efficiency gain" value={efficiencyGain} />}
      <AgentOutputCard title="Single-agent output" value={singleAgent} />
      <AgentOutputCard title="Improvements and missing baseline detail" value={getPath(baseline, ['missing_items', 'improvements', 'score', 'explanation'])} />
    </ReportSection>
  );
}
