'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CollapsibleCard, SectionTooltip, StageAccordion } from '../components/Collapsible';
import { ErrorState } from '../components/report/ErrorState';
import { ReportLayout } from '../components/report/ReportLayout';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/backend';
const STREAM_API_BASE_URL = API_BASE_URL.startsWith('/') ? DEFAULT_BACKEND_URL : API_BASE_URL;
const REQUEST_TIMEOUT_MS = 30_000;
const STAGE_RUN_TIMEOUT_MS = 300_000;
const HISTORY_BATCH_SIZE = 8;

type StageStatus = 'locked' | 'running' | 'awaiting_approval' | 'approved' | 'needs_revision' | 'failed';

type Stage = {
  id: string;
  name: string;
  status: StageStatus;
  version: number;
  assigned_agent: string;
  dependencies: string[];
  content?: Record<string, unknown> | null;
  user_feedback?: string | null;
  can_run: boolean;
  human_approval_required: boolean;
};

type DialogueItem = {
  id: string;
  stage_name: string;
  speaker: string;
  recipient?: string | null;
  type: string;
  message: string;
  related_artifact?: string | null;
  created_at: string;
};

type Conflict = {
  id: string;
  severity: string;
  affected_agents: string[];
  description: string;
  evidence: string[];
  recommended_resolution: string;
  status: string;
  resolution?: Record<string, unknown> | null;
};

type GeneratedFile = {
  id: string;
  path: string;
  language: string;
  content: string;
};

type StagedProject = {
  id: string;
  idea: string;
  target_users?: string | null;
  platform?: string | null;
  constraints: string[];
  preferred_frontend_stack?: string | null;
  include_baseline: boolean;
  current_stage: string;
  stages: Stage[];
  dialogue: DialogueItem[];
  conflicts: Conflict[];
  baseline_comparison?: Record<string, unknown> | null;
  generated_files: GeneratedFile[];
  artifacts: Record<string, unknown>;
  score?: Record<string, unknown>;
};

type ProjectHistoryItem = {
  id: string;
  idea: string;
  created_at: string;
  updated_at?: string | null;
  current_stage?: string | null;
  type?: string;
  score?: Record<string, unknown>;
};

type UiEvent = {
  type: string;
  agent: string;
  stage?: string;
  message: string;
  timestamp: string;
  payload?: unknown;
};

const sampleIdea =
  'Build a lightweight single-page task tracker for freelancers to add tasks, mark them complete, filter by status, and save everything in local browser storage.';

const frontendStackOptions = [
  'Auto-select best stack',
  'Kotlin + Jetpack Compose',
  'React Native + TypeScript',
  'Flutter + Dart',
  'SwiftUI',
  'Next.js + TypeScript',
  'React + Vite',
  'Vue/Nuxt',
  'Angular',
  'Other / Not sure',
];

const stageLabels: Record<string, string> = {
  decomposition: 'Decomposition',
  prd: 'PRD',
  architecture: 'Architecture',
  backend_plan: 'Backend Plan',
  frontend_plan: 'Frontend Plan',
  qa_plan: 'QA Plan',
  cto_review: 'CTO Review',
  negotiation: 'Negotiation',
  revision_summary: 'Revision Summary',
  code_generation: 'Code Generation',
  code_review: 'Code Review',
};

function safeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function hasStageContent(stage?: Stage | null) {
  return hasContent(stage?.content?.output) || hasContent(stage?.content);
}

function stageDisplayOutput(stage?: Stage | null) {
  if (!stage?.content) return undefined;
  if (hasContent(stage.content.output)) return stage.content.output;
  return stage.content;
}

function isStageRenderable(stage?: Stage | null) {
  if (!stage) return false;
  return hasStageContent(stage) || stage.status === 'approved' || stage.status === 'awaiting_approval';
}

function getNextRunnableStage(stages: Stage[], currentStageName: string) {
  const currentIndex = stages.findIndex((stage) => stage.name === currentStageName);
  const afterCurrent = stages.slice(Math.max(0, currentIndex + 1));
  return afterCurrent.find((stage) => stage.can_run && stage.status !== 'approved') || stages.find((stage) => stage.can_run && stage.status !== 'approved');
}

function getLatestCompletedStage(stages: Stage[]) {
  const completed = stages.filter((stage) => hasStageContent(stage) || ['awaiting_approval', 'approved', 'needs_revision'].includes(stage.status));
  return completed[completed.length - 1] || null;
}

function getDefaultExpandedStage(stages: Stage[]) {
  const running = stages.find((stage) => stage.status === 'running');
  return running || getLatestCompletedStage(stages) || stages.find((stage) => stage.can_run) || stages[0] || null;
}

function isCardExpanded(cardId: string, activeCardId: string, expandedCards: Record<string, boolean>) {
  if (expandedCards[cardId] !== undefined) return expandedCards[cardId];
  return cardId === activeCardId;
}

function updateStageInProject(project: StagedProject, stageName: string, updates: Partial<Stage>): StagedProject {
  return {
    ...project,
    current_stage: stageName,
    stages: project.stages.map((stage) => (stage.name === stageName ? { ...stage, ...updates } : stage)),
  };
}

function stageStateAfterCancel(stage: Stage): Pick<Stage, 'status' | 'can_run'> {
  if (stage.status === 'running') return { status: 'failed', can_run: true };
  return { status: stage.status, can_run: stage.can_run };
}

function expandedCardsForLoadedProject(project: StagedProject, activeStageName: string) {
  const expanded: Record<string, boolean> = {};
  for (const stage of project.stages) {
    expanded[`stage:${stage.name}`] = stage.name === activeStageName;
  }
  expanded.dialogue = false;
  expanded.conflicts = false;
  expanded.baseline = false;
  expanded.code = false;
  return expanded;
}

function extractErrorDetail(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.detail === 'string') return record.detail;
  if (Array.isArray(record.detail)) return record.detail.map((item) => extractErrorDetail(item) || JSON.stringify(item)).join('; ');
  if (record.detail && typeof record.detail === 'object') return extractErrorDetail(record.detail);
  if (typeof record.message === 'string') return record.message;
  if (typeof record.msg === 'string') return record.msg;
  if (typeof record.error === 'string') return record.error;
  return null;
}

function normalizeErrorText(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  const stageFailedPrefix = 'Stage failed:';
  if (trimmed.startsWith(stageFailedPrefix)) {
    const normalized = normalizeErrorText(trimmed.slice(stageFailedPrefix.length));
    return normalized || trimmed;
  }
  const statusPrefixMatch = trimmed.match(/^\d{3}:\s*([\s\S]+)$/);
  if (statusPrefixMatch) {
    const normalized = normalizeErrorText(statusPrefixMatch[1]);
    return normalized || trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return extractErrorDetail(parsed) || trimmed;
  } catch {
    // Some server/runtime errors embed JSON inside a larger string.
  }
  const jsonMatch = trimmed.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const detail = extractErrorDetail(parsed);
      if (detail) return detail;
    } catch {
      // Keep falling through to regex extraction.
    }
  }
  const detailMatch = trimmed.match(/["']detail["']\s*:\s*["']([^"']+)["']/);
  if (detailMatch) return detailMatch[1];
  const messageMatch = trimmed.match(/["']message["']\s*:\s*["']([^"']+)["']/);
  if (messageMatch) return messageMatch[1];
  return trimmed;
}

async function responseErrorMessage(response: Response, path: string) {
  const contentType = response.headers.get('content-type') || '';
  const fallback = `Backend API returned ${response.status} for ${path}. Check the FastAPI terminal logs for the traceback.`;
  try {
    if (contentType.includes('application/json')) {
      const detail = extractErrorDetail(await response.json());
      return detail ? normalizeErrorText(detail) : fallback;
    }
    const text = (await response.text()).trim();
    if (!text || text === 'Internal Server Error') return fallback;
    return normalizeErrorText(text);
  } catch {
    return fallback;
  }
}

function linkedAbortSignal(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    },
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === 'AbortError') return fallback;
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return 'Could not reach the backend API. Start the FastAPI server on port 8000, then retry.';
  }
  if (error instanceof Error) {
    if (error.message.toLowerCase().includes('failed to fetch')) {
      return 'Could not reach the backend API. Start the FastAPI server on port 8000, then retry.';
    }
    return normalizeErrorText(error.message);
  }
  return fallback;
}

function parseSseEvent(chunk: string): UiEvent | null {
  const data = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('\n');
  if (!data) return null;
  return JSON.parse(data) as UiEvent;
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp?: string | null) {
  if (!timestamp) return 'Unknown date';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    function handleChange(event: MediaQueryListEvent) {
      setMatches(event.matches);
    }

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}

function statusStyles(status: StageStatus | string) {
  if (status === 'approved' || status === 'resolved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'running') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'awaiting_approval') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (status === 'needs_revision' || status === 'open') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 'failed' || status === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function severityStyles(severity: string) {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function Badge({ label, className = '' }: { label: string; className?: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

function FormattedValue({ value }: { value: unknown }) {
  if (value == null || value === '') {
    return <p className="text-sm text-slate-500">No content yet.</p>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="space-y-2 text-sm leading-6 text-slate-700">
        {value.map((item, index) => (
          <li className="rounded-md border border-slate-200 bg-white px-3 py-2" key={index}>
            <FormattedValue value={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === 'object') {
    return (
      <div className="space-y-3">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div className="rounded-md border border-slate-200 bg-white p-3" key={key}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key.replaceAll('_', ' ')}</p>
            <div className="mt-2">
              <FormattedValue value={item} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-sm leading-6 text-slate-700">{String(value)}</p>;
}

function ActivityTimeline({ events }: { events: UiEvent[] }) {
  const tooltip = 'Shows real-time workflow events, agent messages, stage starts, completions, and failures as the project runs.';

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="flex cursor-pointer items-start justify-between gap-3 font-semibold text-slate-800">
        <span>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Live workspace</p>
          <span className="mt-1 block text-xl font-bold text-slate-950">Agent Activity</span>
        </span>
        <SectionTooltip label="About Agent Activity" text={tooltip} />
      </summary>
      <div className="mt-4 space-y-3" aria-live="polite">
        {events.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            Create a project, then run stages to see agent activity.
          </p>
        )}
        {events.map((event, index) => (
          <article className="grid grid-cols-[12px_1fr] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4" key={`${event.timestamp}-${index}`}>
            <span className="mt-1 h-2.5 w-2.5 rounded-full bg-sky-500" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-950">{event.agent}</h3>
                <Badge className="border-slate-200 bg-white text-slate-600" label={event.type.replaceAll('_', ' ')} />
                {event.stage && <Badge className="border-sky-200 bg-sky-50 text-sky-700" label={stageLabels[event.stage] || event.stage} />}
                <time className="text-xs text-slate-500">{formatTime(event.timestamp)}</time>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-700">{event.message}</p>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}

function HistorySidebar({
  history,
  activeProjectId,
  expanded,
  hasLoaded,
  hasMore,
  totalCount,
  loading,
  error,
  busy,
  onOpen,
  onToggle,
  onRefresh,
  onLoadMore,
}: {
  history: ProjectHistoryItem[];
  activeProjectId?: string;
  expanded: boolean;
  hasLoaded: boolean;
  hasMore: boolean;
  totalCount: number;
  loading: boolean;
  error: string;
  busy: boolean;
  onOpen: (projectId: string) => void;
  onToggle: (expanded: boolean) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}) {
  const status = loading ? 'loading' : error ? 'unavailable' : hasLoaded ? `${totalCount} saved` : 'not loaded';
  const renderRefreshButton = () => (
    <button
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={loading || busy}
      onClick={(event) => {
        event.stopPropagation();
        onRefresh();
      }}
      type="button"
    >
      Refresh
    </button>
  );

  const content = (
    <div className="space-y-2">
      {loading && <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">Loading conversations...</p>}
      {!loading && !hasLoaded && !error && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          History will load when this section opens.
        </p>
      )}
      {!loading && error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-900">
          <p className="font-semibold">History unavailable</p>
          <p className="mt-1 leading-5">{error}</p>
        </div>
      )}
      {!loading && hasLoaded && !error && history.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          Created projects will appear here.
        </p>
      )}
      {history.map((item) => {
        const score = item.score?.overall_score ?? item.score?.total_score;
        const isActive = activeProjectId === item.id;
        return (
          <button
            aria-current={isActive ? 'true' : undefined}
            className={`relative w-full rounded-lg border px-3 py-3 text-left transition ${
              isActive
                ? 'border-indigo-600 bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200'
                : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50'
            }`}
            disabled={busy && !isActive}
            key={item.id}
            onClick={() => onOpen(item.id)}
            type="button"
          >
            {isActive && <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg bg-white/80" />}
            <div className="flex items-center justify-between gap-2">
              <Badge
                className={isActive ? 'border-white/30 bg-white/15 text-white' : statusStyles(item.current_stage ? 'awaiting_approval' : 'locked')}
                label={item.type === 'quick_run' ? 'quick run' : 'staged'}
              />
              {score != null && <span className={`text-xs font-semibold ${isActive ? 'text-indigo-50' : 'text-slate-500'}`}>{String(score)}</span>}
            </div>
            <p className={`mt-2 line-clamp-3 text-sm font-semibold leading-5 ${isActive ? 'text-white' : 'text-slate-900'}`}>{item.idea}</p>
            <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${isActive ? 'text-indigo-100' : 'text-slate-500'}`}>
              <span>{formatDate(item.updated_at || item.created_at)}</span>
              {item.current_stage && <span>{stageLabels[item.current_stage] || item.current_stage}</span>}
            </div>
          </button>
        );
      })}
      {hasMore && (
        <button
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || busy}
          onClick={onLoadMore}
          type="button"
        >
          Load more
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="xl:hidden">
        <CollapsibleCard
          defaultExpanded={expanded}
          onToggle={onToggle}
          rightAction={renderRefreshButton()}
          status={status}
          subtitle="Past Conversations"
          title="History"
          tooltip="Browse previously created projects. Open one to continue reviewing its stages, outputs, files, and report."
        >
          {content}
        </CollapsibleCard>
      </div>
      <aside className="hidden h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:block">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">History</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Past Conversations</h2>
          </div>
          <div className="flex items-center gap-2">
            <SectionTooltip
              label="About History"
              text="Browse previously created projects. Open one to continue reviewing its stages, outputs, files, and report."
            />
            {renderRefreshButton()}
          </div>
        </div>
        <div className="mt-4">{content}</div>
      </aside>
    </>
  );
}

function ProjectSetupPanel({
  idea,
  targetUsers,
  platform,
  preferredFrontendStack,
  constraints,
  includeBaseline,
  projectActive,
  busy,
  activeOperation,
  error,
  expanded,
  setIdea,
  setTargetUsers,
  setPlatform,
  setPreferredFrontendStack,
  setConstraints,
  setIncludeBaseline,
  onCreateProject,
  onCancel,
  onToggle,
}: {
  idea: string;
  targetUsers: string;
  platform: string;
  preferredFrontendStack: string;
  constraints: string;
  includeBaseline: boolean;
  projectActive: boolean;
  busy: boolean;
  activeOperation: string;
  error: string;
  expanded: boolean;
  setIdea: (value: string) => void;
  setTargetUsers: (value: string) => void;
  setPlatform: (value: string) => void;
  setPreferredFrontendStack: (value: string) => void;
  setConstraints: (value: string) => void;
  setIncludeBaseline: (value: boolean) => void;
  onCreateProject: () => void;
  onCancel: () => void;
  onToggle: (expanded: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <ErrorState message={error} />
      <CollapsibleCard
        defaultExpanded={expanded}
        onToggle={onToggle}
        status={error ? 'error' : projectActive ? 'project active' : 'ready'}
        subtitle={projectActive ? 'Create a new project or adjust the next brief.' : 'Describe the product and start the staged workflow.'}
        title="Project Setup"
        tooltip="Enter the product brief, target users, platform, constraints, and optional baseline setting before creating a staged workflow."
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Product idea</span>
            <textarea
              className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Target users</span>
            <textarea
              className="mt-2 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={targetUsers}
              onChange={(event) => setTargetUsers(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Platform</span>
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Preferred frontend/mobile stack</span>
            <select
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={preferredFrontendStack}
              onChange={(event) => setPreferredFrontendStack(event.target.value)}
            >
              {frontendStackOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Constraints, one per line</span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
            <input
              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              type="checkbox"
              checked={includeBaseline}
              onChange={(event) => setIncludeBaseline(event.target.checked)}
            />
            Include single-agent baseline
          </label>
          <button
            className="inline-flex w-full items-center justify-center rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy || idea.trim().length < 10}
            onClick={onCreateProject}
          >
            {projectActive ? 'Create New Project' : 'Create Staged Project'}
          </button>
          {busy && activeOperation && (
            <button
              className="inline-flex w-full items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100"
              onClick={onCancel}
              type="button"
            >
              Cancel {activeOperation}
            </button>
          )}
        </div>
      </CollapsibleCard>
    </div>
  );
}

function ProjectStepper({
  stages,
  selectedStage,
  nextRunnableName,
  onSelect,
}: {
  stages: Stage[];
  selectedStage: string;
  nextRunnableName?: string;
  onSelect: (stage: string) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Workflow map</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Project Stages</h2>
        </div>
        <SectionTooltip
          label="About Project Stages"
          text="Use this map to see each workflow stage, its status, assigned agent, and the next runnable step."
        />
      </header>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {stages.map((stage, index) => {
          const isSelected = selectedStage === stage.name;
          const isNext = nextRunnableName === stage.name && !isSelected;
          const isApproved = stage.status === 'approved';
          return (
            <button
              className={`rounded-lg border px-3 py-3 text-left transition ${
                isApproved && isSelected
                  ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100'
                  : isApproved
                    ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:bg-emerald-100'
                    : isSelected
                  ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-100'
                  : isNext
                    ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                    : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50'
              }`}
              key={stage.name}
              onClick={() => onSelect(stage.name)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <Badge className={statusStyles(stage.status)} label={stage.status.replaceAll('_', ' ')} />
              </div>
              <h3 className="mt-2 text-sm font-bold text-slate-950">{stageLabels[stage.name] || stage.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{stage.assigned_agent}</p>
              {isNext && <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Next step</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StageWorkspace({
  stage,
  busy,
  expanded,
  cardExpanded,
  feedback,
  generatedContentRef,
  isActive,
  setFeedback,
  stageWorkspaceRef,
  onToggleCard,
  onToggleExpanded,
  onRun,
  onApprove,
  onRevise,
  onRegenerate,
}: {
  stage?: Stage;
  busy: boolean;
  expanded: boolean;
  cardExpanded: boolean;
  feedback: string;
  generatedContentRef: { current: HTMLDivElement | null };
  isActive: boolean;
  setFeedback: (value: string) => void;
  stageWorkspaceRef: { current: HTMLDivElement | null };
  onToggleCard: (expanded: boolean) => void;
  onToggleExpanded: () => void;
  onRun: () => void;
  onApprove: () => void;
  onRevise: () => void;
  onRegenerate: () => void;
}) {
  if (!stage) return null;
  const output = stageDisplayOutput(stage);
  const stageHasContent = hasStageContent(stage);
  const strandedRunning = stage.status === 'running' && !busy;
  const canRun = stage.can_run && (stage.status !== 'running' || strandedRunning);
  const canApprove = stage.status === 'awaiting_approval' && stageHasContent;
  const canRegenerate = stageHasContent || stage.status === 'failed';
  const canRequestChanges = stageHasContent && feedback.trim().length > 0;

  return (
    <div ref={stageWorkspaceRef}>
      <StageAccordion
        defaultExpanded={cardExpanded}
        isActive={isActive}
        onToggle={onToggleCard}
        rightAction={<Badge className="border-slate-200 bg-slate-50 text-slate-700" label={`version ${stage.version}`} />}
        status={stage.status}
        subtitle={stage.assigned_agent}
        title={stageLabels[stage.name] || stage.name}
        tooltip="Run, approve, regenerate, or request changes for the selected active agent stage. Generated output appears inside this card."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dependencies</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {stage.dependencies.length ? stage.dependencies.map((dep) => stageLabels[dep] || dep).join(', ') : 'None'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {stage.human_approval_required ? 'Human approval required before dependent stages unlock.' : 'Auto-approved operational stage.'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Runnable</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{stage.can_run ? 'Dependencies satisfied.' : 'Waiting for approvals or required outputs.'}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy || !canRun}
            onClick={onRun}
          >
            {strandedRunning ? 'Retry Stage' : 'Run Stage'}
          </button>
          <button
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !canApprove}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !canRegenerate || stage.status === 'running'}
            onClick={onRegenerate}
          >
            {stage.status === 'failed' ? 'Retry Stage' : 'Regenerate'}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">Request changes</span>
            <textarea
              className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              placeholder="Add human feedback for this stage..."
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </label>
          <button
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !canRequestChanges || stage.status === 'running'}
            onClick={onRevise}
          >
            Request Changes
          </button>
        </div>

        {stageHasContent ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50" ref={generatedContentRef}>
            <button
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              onClick={onToggleExpanded}
              type="button"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated Content</span>
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                {expanded ? 'Collapse' : 'Expand'}
              </span>
            </button>
            {expanded && (
              <div className="overflow-x-auto border-t border-slate-200 p-4">
                <FormattedValue value={output} />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            {strandedRunning
              ? 'The previous run did not finish. Retry this stage to continue.'
              : `Run this stage to generate the ${stageLabels[stage.name] || stage.name} output.`}
          </div>
        )}
      </StageAccordion>
    </div>
  );
}

function AgentDialogueTimeline({
  dialogue,
  expanded,
  onToggle,
}: {
  dialogue: DialogueItem[];
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
}) {
  return (
    <CollapsibleCard
      defaultExpanded={expanded}
      onToggle={onToggle}
      status={`${dialogue.length} messages`}
      subtitle="Visible Collaboration"
      title="Agent Dialogue"
      tooltip="Shows the visible conversation between agents, including handoffs, critiques, requests, and decisions."
    >
      <div className="space-y-3">
        {dialogue.length === 0 && <p className="text-sm text-slate-500">No dialogue yet.</p>}
        {dialogue.map((item) => (
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-950">{item.speaker}</h3>
              {item.recipient && <span className="text-xs text-slate-500">to {item.recipient}</span>}
              <Badge className={statusStyles(item.type)} label={item.type.replaceAll('_', ' ')} />
              <time className="text-xs text-slate-500">{formatTime(item.created_at)}</time>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{item.message}</p>
          </article>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function ConflictPanel({
  conflicts,
  busy,
  expanded,
  onToggle,
  onResolve,
  onAcceptRisk,
}: {
  conflicts: Conflict[];
  busy: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  onResolve: (conflict: Conflict) => void;
  onAcceptRisk: (conflict: Conflict) => void;
}) {
  const openConflicts = conflicts.filter((conflict) => conflict.status === 'open').length;

  return (
    <CollapsibleCard
      defaultExpanded={expanded}
      onToggle={onToggle}
      status={openConflicts > 0 ? `${openConflicts} open` : 'none open'}
      subtitle="CTO Challenges and Decisions"
      title="Conflict Resolution"
      tooltip="Lists technical conflicts or CTO challenges. Resolve open conflicts or explicitly accept the risk before moving forward."
    >
      <div className="space-y-3">
        {conflicts.length === 0 && <p className="text-sm text-slate-500">No conflicts detected yet. CTO review can still challenge the plan later.</p>}
        {conflicts.map((conflict) => (
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={conflict.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={severityStyles(conflict.severity)} label={conflict.severity} />
              <Badge className={statusStyles(conflict.status)} label={conflict.status.replaceAll('_', ' ')} />
              <span className="text-xs text-slate-500">{conflict.affected_agents.join(', ')}</span>
            </div>
            <h3 className="mt-3 text-sm font-bold text-slate-950">{conflict.description}</h3>
            <FormattedValue value={conflict.evidence} />
            <p className="mt-3 text-sm leading-6 text-slate-700">{conflict.recommended_resolution}</p>
            {conflict.resolution && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <FormattedValue value={conflict.resolution} />
              </div>
            )}
            {conflict.status === 'open' && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={busy}
                  onClick={() => onResolve(conflict)}
                >
                  Resolve
                </button>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy}
                  onClick={() => onAcceptRisk(conflict)}
                >
                  Accept Risk
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </CollapsibleCard>
  );
}

function BaselinePanel({
  comparison,
  busy,
  expanded,
  onToggle,
  onRun,
}: {
  comparison?: Record<string, unknown> | null;
  busy: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  onRun: () => void;
}) {
  const single = comparison?.single_agent as Record<string, unknown> | undefined;
  const multi = comparison?.multi_agent as Record<string, unknown> | undefined;
  const gain = comparison?.efficiency_gain as Record<string, unknown> | undefined;

  return (
    <CollapsibleCard
      defaultExpanded={expanded}
      onToggle={onToggle}
      rightAction={
        <button
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onRun();
          }}
          type="button"
        >
          Run Baseline
        </button>
      }
      status={comparison ? 'complete' : 'not run'}
      subtitle="Single Agent vs DevTeam AI"
      title="Baseline Comparison"
      tooltip="Compares the coordinated multi-agent result against a single-agent baseline so you can judge workflow value."
    >
      <div className="space-y-4">
        {!comparison && <p className="text-sm text-slate-500">Run the baseline after at least a few planning stages to measure improvement.</p>}
        {comparison && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Single-agent score" value={single?.overall_score} />
              <Metric label="Multi-agent score" value={multi?.overall_score} />
              <Metric label="Improvement" value={gain?.score_improvement_percentage ? `${gain.score_improvement_percentage}%` : '0%'} />
              <Metric label="Conflicts resolved" value={gain?.conflicts_resolved ?? 0} />
            </div>
            <p className="text-sm leading-6 text-slate-700">{String(comparison.explanation || '')}</p>
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-950">{String(value ?? 'N/A')}</p>
    </div>
  );
}

function CodePanel({
  files,
  selectedFileId,
  setSelectedFileId,
  busy,
  expanded,
  onToggle,
  onGenerate,
  onReview,
  exportHref,
}: {
  files: GeneratedFile[];
  selectedFileId?: string;
  setSelectedFileId: (id: string) => void;
  busy: boolean;
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  onGenerate: () => void;
  onReview: () => void;
  exportHref: string;
}) {
  const selectedFile = files.find((file) => file.id === selectedFileId) || files[0];

  return (
    <CollapsibleCard
      defaultExpanded={expanded}
      onToggle={onToggle}
      rightAction={
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onGenerate();
            }}
            type="button"
          >
            Generate Full Project
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || files.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              onReview();
            }}
            type="button"
          >
            Review Code
          </button>
          {files.length > 0 && (
            <a
              className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100"
              href={exportHref}
              onClick={(event) => event.stopPropagation()}
            >
              Download ZIP
            </a>
          )}
        </div>
      }
      status={files.length > 0 ? `${files.length} files` : 'not generated'}
      subtitle="Starter Scaffold"
      title="Code Generation"
      tooltip="Generate starter project files, review generated code readiness, inspect individual files, and download the ZIP."
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">File Tree</p>
          <div className="mt-3 space-y-1">
            {files.length === 0 && <p className="text-sm text-slate-500">No generated files yet.</p>}
            {files.map((file) => (
              <button
                className={`block w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  selectedFile?.id === file.id ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-white'
                }`}
                key={file.id}
                onClick={() => setSelectedFileId(file.id)}
              >
                {file.path}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-64 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          {selectedFile ? (
            <>
              <div className="border-b border-slate-800 px-4 py-3 text-sm font-semibold text-slate-100">{selectedFile.path}</div>
              <pre className="overflow-auto p-4 text-xs leading-6 text-slate-100">{selectedFile.content}</pre>
            </>
          ) : (
            <p className="p-4 text-sm text-slate-300">Generated starter files will appear here after final approval.</p>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

export default function Home() {
  const [idea, setIdea] = useState(sampleIdea);
  const [targetUsers, setTargetUsers] = useState('Freelancers, solo founders, and students managing daily tasks');
  const [platform, setPlatform] = useState('Single-page responsive web app');
  const [preferredFrontendStack, setPreferredFrontendStack] = useState('Next.js + TypeScript');
  const [constraints, setConstraints] = useState('Single page only\nNo authentication for MVP\nPersist tasks in local browser storage');
  const [includeBaseline, setIncludeBaseline] = useState(false);
  const [project, setProject] = useState<StagedProject | null>(null);
  const [history, setHistory] = useState<ProjectHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(HISTORY_BATCH_SIZE);
  const [setupExpanded, setSetupExpanded] = useState(true);
  const [activeStageName, setActiveStageName] = useState('decomposition');
  const [expandedStageName, setExpandedStageName] = useState<string | null>('decomposition');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [, setManuallySelectedStage] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [feedback, setFeedback] = useState('');
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeOperation, setActiveOperation] = useState('');
  const [error, setError] = useState('');
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);
  const stageWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const generatedContentRef = useRef<HTMLDivElement | null>(null);
  const codePanelRef = useRef<HTMLDivElement | null>(null);
  const finalReportRef = useRef<HTMLElement | null>(null);
  const isFullScreenLayout = useMediaQuery('(min-width: 1280px)');

  useEffect(() => {
    if ((isFullScreenLayout || historyExpanded) && !historyLoaded && !historyLoading) {
      void loadHistory();
    }
  }, [isFullScreenLayout, historyExpanded, historyLoaded, historyLoading]);

  const selectedStage = useMemo(
    () => project?.stages.find((stage) => stage.name === activeStageName) || project?.stages[0],
    [project, activeStageName],
  );
  const nextRunnableStage = useMemo(
    () => (project ? getNextRunnableStage(project.stages, activeStageName) : null),
    [project, activeStageName],
  );
  const activeCardId = `stage:${selectedStage?.name || activeStageName}`;
  const stageCardExpanded = isCardExpanded(activeCardId, activeCardId, expandedCards);
  const dialogueExpanded = expandedCards.dialogue ?? false;
  const conflictsExpanded = expandedCards.conflicts ?? false;
  const baselineExpanded = expandedCards.baseline ?? false;
  const codeExpanded = expandedCards.code ?? false;
  const visibleHistory = useMemo(
    () => history.slice(0, historyVisibleCount),
    [history, historyVisibleCount],
  );
  const hasMoreHistory = historyVisibleCount < history.length;

  useEffect(() => {
    if (!project) return;
    setExpandedCards((prev) => {
      const next = { ...prev, [activeCardId]: true };
      for (const stage of project.stages) {
        const cardId = `stage:${stage.name}`;
        if (cardId !== activeCardId) next[cardId] = false;
      }
      return next;
    });
  }, [activeCardId, project]);

  function scrollToElement(element: HTMLElement | null) {
    window.setTimeout(() => {
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function selectStage(stageName: string, manual = false) {
    setActiveStageName(stageName);
    setExpandedStageName(stageName);
    setExpandedCards((prev) => ({ ...prev, [`stage:${stageName}`]: true }));
    setManuallySelectedStage(manual);
  }

  function toggleCard(cardId: string, currentExpanded = isCardExpanded(cardId, activeCardId, expandedCards)) {
    setExpandedCards((prev) => ({
      ...prev,
      [cardId]: !currentExpanded,
    }));
  }

  function addEvent(type: string, agent: string, message: string, stage?: string) {
    setEvents((prev) => [...prev, { type, agent, message, stage, timestamp: new Date().toISOString() }]);
  }

  function cancelRunningProcess() {
    if (!activeAbortControllerRef.current || !activeOperation) return;
    cancelRequestedRef.current = true;
    activeAbortControllerRef.current.abort();
    setError('');
    addEvent('workflow_cancelled', 'User', `${activeOperation} cancelled.`);
  }

  async function request<T>(path: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS, abortSignal?: AbortSignal) {
    const controller = linkedAbortSignal(timeoutMs, abortSignal);
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, path));
      }
      return (await response.json()) as T;
    } catch (err) {
      const fallback = abortSignal?.aborted && cancelRequestedRef.current ? 'Request cancelled.' : 'Request timed out. Please retry.';
      throw new Error(errorMessage(err, fallback));
    } finally {
      controller.cleanup();
    }
  }

  async function loadHistory() {
    if (historyLoading) return;
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const projects = await request<ProjectHistoryItem[]>('/projects');
      setHistory(projects);
      setHistoryVisibleCount(HISTORY_BATCH_SIZE);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not load project history');
    } finally {
      setHistoryLoaded(true);
      setHistoryLoading(false);
    }
  }

  function loadMoreHistory() {
    setHistoryVisibleCount((count) => Math.min(count + HISTORY_BATCH_SIZE, history.length));
  }

  function toggleHistory(nextExpanded: boolean) {
    setHistoryExpanded(nextExpanded);
    if (nextExpanded && !historyLoaded && !historyLoading) {
      void loadHistory();
    }
  }

  async function refreshHistoryIfVisible() {
    if (historyLoaded || historyExpanded || isFullScreenLayout) {
      await loadHistory();
    }
  }

  async function guarded(action: (abortSignal?: AbortSignal) => Promise<void>, operationLabel = 'Running process') {
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    cancelRequestedRef.current = false;
    setActiveOperation(operationLabel);
    setBusy(true);
    setError('');
    try {
      await action(controller.signal);
    } catch (err) {
      if (controller.signal.aborted && cancelRequestedRef.current) {
        setError('');
        return;
      }
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      addEvent('workflow_failed', 'System', message);
    } finally {
      if (activeAbortControllerRef.current === controller) {
        activeAbortControllerRef.current = null;
      }
      cancelRequestedRef.current = false;
      setActiveOperation('');
      setBusy(false);
    }
  }

  async function openProject(projectId: string) {
    await guarded(async (abortSignal) => {
      const loaded = await request<StagedProject>(`/projects/${projectId}`, {}, REQUEST_TIMEOUT_MS, abortSignal);
      if (!Array.isArray(loaded.stages)) {
        throw new Error('This saved item is from the older quick-run flow and cannot be reopened in the staged workspace.');
      }
      const defaultStage = getDefaultExpandedStage(loaded.stages);
      const activeStage = defaultStage?.name || loaded.current_stage || 'decomposition';
      setIdea(loaded.idea);
      setTargetUsers(loaded.target_users || '');
      setPlatform(loaded.platform || '');
      setPreferredFrontendStack(loaded.preferred_frontend_stack || 'Auto-select best stack');
      setConstraints(loaded.constraints.join('\n'));
      setIncludeBaseline(loaded.include_baseline);
      setProject(loaded);
      setActiveStageName(activeStage);
      setExpandedStageName(activeStage);
      setExpandedCards(expandedCardsForLoadedProject(loaded, activeStage));
      setManuallySelectedStage(false);
      setFeedback('');
      setEvents([]);
      setSelectedFileId(loaded.generated_files[0]?.id);
      addEvent('project_loaded', 'System', 'Loaded saved conversation.', activeStage);
      scrollToElement(stageWorkspaceRef.current);
    }, 'Opening project');
  }

  async function createProject() {
    await guarded(async (abortSignal) => {
      const created = await request<StagedProject>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          idea,
          target_users: targetUsers,
          platform,
          constraints: constraints.split('\n').map((item) => item.trim()).filter(Boolean),
          preferred_frontend_stack: preferredFrontendStack,
          include_baseline: includeBaseline,
        }),
      }, REQUEST_TIMEOUT_MS, abortSignal);
      setProject(created);
      setSetupExpanded(false);
      selectStage('decomposition');
      setEvents([]);
      addEvent('workflow_started', 'Orchestrator Agent', 'Project created. Decomposition is ready to run.', 'decomposition');
      await refreshHistoryIfVisible();
      scrollToElement(stageWorkspaceRef.current);
    }, 'Creating project');
  }

  async function runStage(stageName: string, stageFeedback?: string) {
    if (!project) return;
    const stage = project.stages.find((item) => item.name === stageName);
    await guarded(async (abortSignal) => {
      selectStage(stageName);
      setProject((current) =>
        current
          ? updateStageInProject(current, stageName, {
              status: 'running',
              can_run: true,
            })
          : current,
      );
      scrollToElement(stageWorkspaceRef.current);
      addEvent('stage_started', stage?.assigned_agent || 'Agent', `Running ${stageLabels[stageName] || stageName}.`, stageName);
      const controller = linkedAbortSignal(STAGE_RUN_TIMEOUT_MS, abortSignal);
      try {
        const response = await fetch(`${STREAM_API_BASE_URL}/projects/${project.id}/stages/${stageName}/run-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: stageFeedback || null }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(await responseErrorMessage(response, `/projects/${project.id}/stages/${stageName}/run-stream`));
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let updatedProject: StagedProject | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          for (const chunk of chunks) {
            const event = parseSseEvent(chunk);
            if (!event) continue;
            setEvents((prev) => [...prev, event]);
            if (event.type === 'stage_started' || event.type === 'task_decomposition_started') {
              setProject((current) =>
                current
                  ? updateStageInProject(current, stageName, {
                      status: 'running',
                      can_run: true,
                    })
                  : current,
              );
            }
            if (event.type === 'stage_completed' || event.type === 'task_decomposition_completed') {
              updatedProject = event.payload as StagedProject;
              setProject(updatedProject);
              selectStage(stageName);
            }
            if (event.type === 'workflow_failed') {
              throw new Error(event.message);
            }
          }
        }

        buffer += decoder.decode();
        const trailing = parseSseEvent(buffer);
        if (trailing) {
          setEvents((prev) => [...prev, trailing]);
          if (trailing.type === 'stage_started' || trailing.type === 'task_decomposition_started') {
            setProject((current) =>
              current
                ? updateStageInProject(current, stageName, {
                    status: 'running',
                    can_run: true,
                  })
                : current,
            );
          }
          if (trailing.type === 'stage_completed' || trailing.type === 'task_decomposition_completed') {
            updatedProject = trailing.payload as StagedProject;
            setProject(updatedProject);
            selectStage(stageName);
          }
          if (trailing.type === 'workflow_failed') {
            throw new Error(trailing.message);
          }
        }

        if (!updatedProject) {
          const updated = await request<StagedProject>(`/projects/${project.id}`, { method: 'GET' });
          updatedProject = updated;
          setProject(updated);
        }
        setFeedback('');
        addEvent('stage_awaiting_approval', stage?.assigned_agent || 'Agent', `${stageLabels[stageName] || stageName} is awaiting approval.`, stageName);
        await refreshHistoryIfVisible();
        scrollToElement(generatedContentRef.current);
      } catch (err) {
        if (abortSignal?.aborted && cancelRequestedRef.current) {
          if (stage) {
            setProject((current) =>
              current
                ? updateStageInProject(current, stageName, {
                    ...stageStateAfterCancel(stage),
                  })
                : current,
            );
          }
          return;
        }
        const message = errorMessage(err, `${stageLabels[stageName] || stageName} timed out. Click Retry Stage to run it again.`);
        setProject((current) => (current ? updateStageInProject(current, stageName, { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', stage?.assigned_agent || 'Agent', message, stageName);
        await refreshHistoryIfVisible();
        throw new Error(message);
      } finally {
        controller.cleanup();
      }
    }, `Running ${stageLabels[stageName] || stageName}`);
  }

  async function approveStage(stageName: string) {
    if (!project) return;
    await guarded(async (abortSignal) => {
      const updated = await request<StagedProject>(`/projects/${project.id}/stages/${stageName}/approve`, { method: 'POST' }, REQUEST_TIMEOUT_MS, abortSignal);
      setProject(updated);
      const nextStage = getNextRunnableStage(updated.stages, stageName);
      if (nextStage) {
        selectStage(nextStage.name);
      }
      addEvent('stage_completed', 'User', `Approved ${stageLabels[stageName] || stageName}.`, stageName);
      await refreshHistoryIfVisible();
      scrollToElement(stageWorkspaceRef.current);
    }, `Approving ${stageLabels[stageName] || stageName}`);
  }

  async function reviseStage(stageName: string) {
    if (!project) return;
    const stage = project.stages.find((item) => item.name === stageName);
    await guarded(async (abortSignal) => {
      selectStage(stageName);
      setProject((current) => (current ? updateStageInProject(current, stageName, { status: 'running', can_run: true }) : current));
      addEvent('agent_message', 'User', feedback, stageName);
      try {
        const updated = await request<StagedProject>(
          `/projects/${project.id}/stages/${stageName}/revise`,
          {
            method: 'POST',
            body: JSON.stringify({ feedback }),
          },
          STAGE_RUN_TIMEOUT_MS,
          abortSignal,
        );
        setProject(updated);
        selectStage(stageName);
        setFeedback('');
        addEvent('stage_awaiting_approval', updated.stages.find((stage) => stage.name === stageName)?.assigned_agent || 'Agent', 'Revision is awaiting approval.', stageName);
        await refreshHistoryIfVisible();
        scrollToElement(generatedContentRef.current);
      } catch (err) {
        if (abortSignal?.aborted && cancelRequestedRef.current) {
          if (stage) {
            setProject((current) =>
              current
                ? updateStageInProject(current, stageName, {
                    ...stageStateAfterCancel(stage),
                  })
                : current,
            );
          }
          return;
        }
        const message = errorMessage(err, `${stageLabels[stageName] || stageName} revision timed out. Click Retry Stage to run it again.`);
        setProject((current) => (current ? updateStageInProject(current, stageName, { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', stageName, message, stageName);
        await refreshHistoryIfVisible();
        throw new Error(message);
      }
    }, `Revising ${stageLabels[stageName] || stageName}`);
  }

  async function resolveConflict(conflict: Conflict, action: 'resolve' | 'accept_risk') {
    if (!project) return;
    await guarded(async (abortSignal) => {
      addEvent(action === 'resolve' ? 'negotiation_started' : 'agent_message', 'Negotiator Agent', conflict.description, 'negotiation');
      const updated = await request<StagedProject>(`/projects/${project.id}/conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }, STAGE_RUN_TIMEOUT_MS, abortSignal);
      setProject(updated);
      addEvent('negotiation_completed', 'Negotiator Agent', action === 'resolve' ? 'Conflict resolved.' : 'Risk accepted.', 'negotiation');
      await refreshHistoryIfVisible();
    }, action === 'resolve' ? 'Resolving conflict' : 'Accepting risk');
  }

  async function runBaseline() {
    if (!project) return;
    await guarded(async (abortSignal) => {
      addEvent('baseline_started', 'Single Agent Baseline', 'Running single-agent baseline comparison.');
      const updated = await request<StagedProject>(`/projects/${project.id}/baseline/run`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS, abortSignal);
      setProject(updated);
      addEvent('comparison_completed', 'System', 'Baseline comparison completed.');
      await refreshHistoryIfVisible();
    }, 'Running baseline');
  }

  async function generateCode() {
    if (!project) return;
    const stage = project.stages.find((item) => item.name === 'code_generation');
    await guarded(async (abortSignal) => {
      selectStage('code_generation');
      setProject((current) => (current ? updateStageInProject(current, 'code_generation', { status: 'running', can_run: true }) : current));
      addEvent('code_generation_started', 'Code Generator Agent', 'Generating starter scaffold.', 'code_generation');
      try {
        const updated = await request<StagedProject>(`/projects/${project.id}/generate-code`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS, abortSignal);
        setProject(updated);
        setSelectedFileId(updated.generated_files[0]?.id);
        addEvent('code_generation_completed', 'Code Generator Agent', 'Starter scaffold generated.', 'code_generation');
        await refreshHistoryIfVisible();
        scrollToElement(codePanelRef.current);
      } catch (err) {
        if (abortSignal?.aborted && cancelRequestedRef.current) {
          if (stage) {
            setProject((current) =>
              current
                ? updateStageInProject(current, 'code_generation', {
                    ...stageStateAfterCancel(stage),
                  })
                : current,
            );
          }
          return;
        }
        const message = errorMessage(err, 'Code generation timed out. Click Retry Stage to run it again.');
        setProject((current) => (current ? updateStageInProject(current, 'code_generation', { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', 'Code Generator Agent', message, 'code_generation');
        await refreshHistoryIfVisible();
        throw new Error(message);
      }
    }, 'Generating code');
  }

  async function reviewCode() {
    if (!project) return;
    const stage = project.stages.find((item) => item.name === 'code_review');
    await guarded(async (abortSignal) => {
      selectStage('code_review');
      setProject((current) => (current ? updateStageInProject(current, 'code_review', { status: 'running', can_run: true }) : current));
      try {
        const updated = await request<StagedProject>(`/projects/${project.id}/review-code`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS, abortSignal);
        setProject(updated);
        addEvent('stage_completed', 'Code Reviewer Agent', 'Code review completed.', 'code_review');
        await refreshHistoryIfVisible();
      } catch (err) {
        if (abortSignal?.aborted && cancelRequestedRef.current) {
          if (stage) {
            setProject((current) =>
              current
                ? updateStageInProject(current, 'code_review', {
                    ...stageStateAfterCancel(stage),
                  })
                : current,
            );
          }
          return;
        }
        const message = errorMessage(err, 'Code review timed out. Click Retry Stage to run it again.');
        setProject((current) => (current ? updateStageInProject(current, 'code_review', { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', 'Code Reviewer Agent', message, 'code_review');
        await refreshHistoryIfVisible();
        throw new Error(message);
      }
    }, 'Reviewing code');
  }

  const reportResult = project
    ? {
        ...project,
        project_id: project.id,
        baseline: project.baseline_comparison,
      }
    : null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="mx-auto mb-8 max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-sky-700 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Qwen Cloud - Agent Society
          </div>
          <h1 className="mx-auto mt-5 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
            DevTeam AI turns a rough product idea into a coordinated delivery plan.
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
            Watch specialist agents decompose the brief, challenge assumptions, negotiate decisions, approve stages,
            compare against a baseline, and produce starter code.
          </p>
          <div className="mx-auto mt-6 grid max-w-4xl gap-2 sm:grid-cols-4">
            {[
              ['01', 'Decompose'],
              ['02', 'Challenge'],
              ['03', 'Approve'],
              ['04', 'Generate'],
            ].map(([step, label], index) => {
              const isFirst = index === 0;
              const isLast = index === 3;
              const clipPath = isFirst
                ? 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)'
                : isLast
                  ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%)'
                  : 'polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)';

              return (
                <div
                  className="bg-slate-200 p-px shadow-sm"
                  key={step}
                  style={{ clipPath }}
                >
                  <div
                    className={`h-full bg-white px-4 py-3 text-left ${
                      isFirst ? 'pr-7' : isLast ? 'pl-7' : 'px-7'
                    }`}
                    style={{ clipPath }}
                  >
                    <span className="text-xs font-bold uppercase tracking-wide text-sky-700">{step}</span>
                    <p className="mt-1 text-sm font-bold text-slate-950">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-6 xl:self-start">
            <ProjectSetupPanel
              activeOperation={activeOperation}
              busy={busy}
              constraints={constraints}
              error={error}
              expanded={setupExpanded}
              idea={idea}
              includeBaseline={includeBaseline}
              platform={platform}
              preferredFrontendStack={preferredFrontendStack}
              projectActive={Boolean(project)}
              setConstraints={setConstraints}
              setIdea={setIdea}
              setIncludeBaseline={setIncludeBaseline}
              setPlatform={setPlatform}
              setPreferredFrontendStack={setPreferredFrontendStack}
              setTargetUsers={setTargetUsers}
              targetUsers={targetUsers}
              onCancel={cancelRunningProcess}
              onCreateProject={createProject}
              onToggle={setSetupExpanded}
            />
            <HistorySidebar
              activeProjectId={project?.id}
              busy={busy}
              expanded={historyExpanded}
              error={historyError}
              hasLoaded={historyLoaded}
              hasMore={hasMoreHistory}
              history={visibleHistory}
              loading={historyLoading}
              onLoadMore={loadMoreHistory}
              onOpen={openProject}
              onRefresh={() => {
                void loadHistory();
              }}
              onToggle={toggleHistory}
              totalCount={history.length}
            />
          </aside>

          <div className="min-w-0 space-y-6">
            {project ? (
              <>
                <ProjectStepper
                  nextRunnableName={nextRunnableStage?.name}
                  onSelect={(stageName) => selectStage(stageName, true)}
                  selectedStage={selectedStage?.name || activeStageName}
                  stages={project.stages}
                />
                <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
                  <div className="min-w-0 space-y-6">
                    <StageWorkspace
                      busy={busy}
                      cardExpanded={stageCardExpanded}
                      expanded={expandedStageName === selectedStage?.name}
                      feedback={feedback}
                      generatedContentRef={generatedContentRef}
                      isActive={selectedStage?.name === activeStageName}
                      onApprove={() => selectedStage && approveStage(selectedStage.name)}
                      onRegenerate={() => selectedStage && runStage(selectedStage.name)}
                      onRevise={() => selectedStage && reviseStage(selectedStage.name)}
                      onRun={() => selectedStage && runStage(selectedStage.name)}
                      onToggleCard={() => toggleCard(activeCardId, stageCardExpanded)}
                      onToggleExpanded={() => {
                        if (!selectedStage) return;
                        setExpandedStageName(expandedStageName === selectedStage.name ? null : selectedStage.name);
                      }}
                      setFeedback={setFeedback}
                      stage={selectedStage}
                      stageWorkspaceRef={stageWorkspaceRef}
                    />
                    <AgentDialogueTimeline
                      dialogue={project.dialogue}
                      expanded={dialogueExpanded}
                      onToggle={() => toggleCard('dialogue', dialogueExpanded)}
                    />
                    <ActivityTimeline events={events} />
                  </div>
                  <div className="min-w-0 space-y-6">
                    <ConflictPanel
                      busy={busy}
                      conflicts={project.conflicts}
                      expanded={conflictsExpanded}
                      onToggle={() => toggleCard('conflicts', conflictsExpanded)}
                      onAcceptRisk={(conflict) => resolveConflict(conflict, 'accept_risk')}
                      onResolve={(conflict) => resolveConflict(conflict, 'resolve')}
                    />
                    <BaselinePanel
                      busy={busy}
                      comparison={project.baseline_comparison}
                      expanded={baselineExpanded}
                      onRun={runBaseline}
                      onToggle={() => toggleCard('baseline', baselineExpanded)}
                    />
                    <div ref={codePanelRef}>
                      <CodePanel
                        busy={busy}
                        expanded={codeExpanded}
                        exportHref={`${API_BASE_URL}/projects/${project.id}/export`}
                        files={project.generated_files}
                        onGenerate={generateCode}
                        onReview={reviewCode}
                        onToggle={() => toggleCard('code', codeExpanded)}
                        selectedFileId={selectedFileId}
                        setSelectedFileId={setSelectedFileId}
                      />
                    </div>
                    <section aria-label="Final report" className="min-w-0" ref={finalReportRef}>
                      {reportResult && (
                        <ReportLayout
                          apiBaseUrl={API_BASE_URL}
                          expandedStageName={expandedStageName || getDefaultExpandedStage(project.stages)?.name || undefined}
                          requestContext={{ platform, preferredFrontendStack, targetUsers }}
                          result={reportResult}
                        />
                      )}
                    </section>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <ActivityTimeline events={events} />
                <article className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-8 text-center shadow-sm">
                  <div className="flex items-start justify-center gap-3">
                    <h2 className="text-xl font-bold text-slate-950">Agent Society Workspace</h2>
                    <SectionTooltip
                      label="About Agent Society Workspace"
                      text="This area fills with stage outputs, agent dialogue, conflict resolution, generated files, and the final report after you create a project."
                    />
                  </div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                    Create a staged project to unlock decomposition, approvals, dialogue, conflicts, baseline comparison,
                    and code generation.
                  </p>
                </article>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
