'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '../components/report/ErrorState';
import { ReportLayout } from '../components/report/ReportLayout';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';
const REQUEST_TIMEOUT_MS = 30_000;
const STAGE_RUN_TIMEOUT_MS = 240_000;

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
  'Build a logistics POS system for delivery companies that supports wallet payments, cash collections, dispatch rider assignment, transaction history, settlement tracking, and offline mode.';

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

function updateStageInProject(project: StagedProject, stageName: string, updates: Partial<Stage>): StagedProject {
  return {
    ...project,
    current_stage: stageName,
    stages: project.stages.map((stage) => (stage.name === stageName ? { ...stage, ...updates } : stage)),
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === 'AbortError') return fallback;
  if (error instanceof Error) return error.message;
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
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-semibold text-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Live workspace</p>
        <span className="mt-1 block text-xl font-bold text-slate-950">Agent Activity</span>
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
  loading,
  busy,
  onOpen,
  onRefresh,
}: {
  history: ProjectHistoryItem[];
  activeProjectId?: string;
  loading: boolean;
  busy: boolean;
  onOpen: (projectId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">History</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Past Conversations</h2>
        </div>
        <button
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={loading || busy}
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
      </div>
      <div className="mt-4 space-y-2">
        {loading && <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">Loading conversations...</p>}
        {!loading && history.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            Created projects will appear here.
          </p>
        )}
        {history.map((item) => {
          const score = item.score?.overall_score ?? item.score?.total_score;
          const isActive = activeProjectId === item.id;
          return (
            <button
              className={`relative w-full rounded-lg border px-3 py-3 text-left transition ${
                isActive
                  ? 'border-sky-600 bg-sky-100 shadow-md ring-2 ring-sky-300'
                  : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50'
              }`}
              disabled={busy && !isActive}
              key={item.id}
              onClick={() => onOpen(item.id)}
              type="button"
            >
              {isActive && (
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-lg bg-gradient-to-b from-sky-500 to-sky-400" />
              )}
              <div className="flex items-center justify-between gap-2">
                <Badge className={statusStyles(item.current_stage ? 'awaiting_approval' : 'locked')} label={item.type === 'quick_run' ? 'quick run' : 'staged'} />
                {score != null && <span className={`text-xs font-semibold ${isActive ? 'text-sky-800' : 'text-slate-500'}`}>{String(score)}</span>}
              </div>
              <p className={`mt-2 line-clamp-3 text-sm font-semibold leading-5 ${isActive ? 'text-sky-900' : 'text-slate-900'}`}>{item.idea}</p>
              <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${isActive ? 'text-sky-700' : 'text-slate-500'}`}>
                <span>{formatDate(item.updated_at || item.created_at)}</span>
                {item.current_stage && <span>{stageLabels[item.current_stage] || item.current_stage}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
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
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {stages.map((stage, index) => {
          const isSelected = selectedStage === stage.name;
          const isNext = nextRunnableName === stage.name && !isSelected;
          return (
            <button
              className={`rounded-lg border px-3 py-3 text-left transition ${
                isSelected
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
  feedback,
  generatedContentRef,
  setFeedback,
  stageWorkspaceRef,
  onToggleExpanded,
  onRun,
  onApprove,
  onRevise,
  onRegenerate,
}: {
  stage?: Stage;
  busy: boolean;
  expanded: boolean;
  feedback: string;
  generatedContentRef: { current: HTMLDivElement | null };
  setFeedback: (value: string) => void;
  stageWorkspaceRef: { current: HTMLElement | null };
  onToggleExpanded: () => void;
  onRun: () => void;
  onApprove: () => void;
  onRevise: () => void;
  onRegenerate: () => void;
}) {
  if (!stage) return null;
  const output = stageDisplayOutput(stage);
  const stageHasContent = hasStageContent(stage);
  const canRun = stage.can_run && stage.status !== 'running';
  const canApprove = stage.status === 'awaiting_approval' && stageHasContent;
  const canRegenerate = stageHasContent || stage.status === 'failed';
  const canRequestChanges = stageHasContent && feedback.trim().length > 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm" ref={stageWorkspaceRef}>
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Stage Workspace</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">{stageLabels[stage.name] || stage.name}</h2>
          <p className="mt-1 text-sm text-slate-600">{stage.assigned_agent}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge className={statusStyles(stage.status)} label={stage.status.replaceAll('_', ' ')} />
          <Badge className="border-slate-200 bg-slate-50 text-slate-700" label={`version ${stage.version}`} />
        </div>
      </header>

      <div className="space-y-5 px-5 py-5">
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
            Run Stage
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
              <div className="max-h-[560px] overflow-auto border-t border-slate-200 p-4">
                <FormattedValue value={output} />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            Run this stage to generate the {stageLabels[stage.name] || stage.name} output.
          </div>
        )}
      </div>
    </section>
  );
}

function AgentDialogueTimeline({ dialogue }: { dialogue: DialogueItem[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Agent Dialogue</p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">Visible Collaboration</h2>
      </header>
      <div className="space-y-3 px-5 py-5">
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
    </section>
  );
}

function ConflictPanel({
  conflicts,
  busy,
  onResolve,
  onAcceptRisk,
}: {
  conflicts: Conflict[];
  busy: boolean;
  onResolve: (conflict: Conflict) => void;
  onAcceptRisk: (conflict: Conflict) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Conflict Resolution</p>
        <h2 className="mt-1 text-xl font-bold text-slate-950">CTO Challenges and Decisions</h2>
      </header>
      <div className="space-y-3 px-5 py-5">
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
    </section>
  );
}

function BaselinePanel({ comparison, busy, onRun }: { comparison?: Record<string, unknown> | null; busy: boolean; onRun: () => void }) {
  const single = comparison?.single_agent as Record<string, unknown> | undefined;
  const multi = comparison?.multi_agent as Record<string, unknown> | undefined;
  const gain = comparison?.efficiency_gain as Record<string, unknown> | undefined;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Baseline Comparison</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">Single Agent vs DevTeam AI</h2>
        </div>
        <button
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={busy}
          onClick={onRun}
        >
          Run Baseline
        </button>
      </header>
      <div className="space-y-4 px-5 py-5">
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
    </section>
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
  onGenerate,
  onReview,
  exportHref,
}: {
  files: GeneratedFile[];
  selectedFileId?: string;
  setSelectedFileId: (id: string) => void;
  busy: boolean;
  onGenerate: () => void;
  onReview: () => void;
  exportHref: string;
}) {
  const selectedFile = files.find((file) => file.id === selectedFileId) || files[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Code Generation</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">Starter Scaffold</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={busy} onClick={onGenerate}>
            Generate Full Project
          </button>
          <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || files.length === 0} onClick={onReview}>
            Review Code
          </button>
          {files.length > 0 && (
            <a className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100" href={exportHref}>
              Download ZIP
            </a>
          )}
        </div>
      </header>
      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[280px_1fr]">
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
              <pre className="max-h-[520px] overflow-auto p-4 text-xs leading-6 text-slate-100">{selectedFile.content}</pre>
            </>
          ) : (
            <p className="p-4 text-sm text-slate-300">Generated starter files will appear here after final approval.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [idea, setIdea] = useState(sampleIdea);
  const [targetUsers, setTargetUsers] = useState('SME logistics companies, dispatch riders, cashiers, branch managers, finance teams');
  const [platform, setPlatform] = useState('Android mobile app and web dashboard');
  const [preferredFrontendStack, setPreferredFrontendStack] = useState('Auto-select best stack');
  const [constraints, setConstraints] = useState('Must work offline\nMust support low-end Android devices\nMust generate audit logs');
  const [includeBaseline, setIncludeBaseline] = useState(true);
  const [project, setProject] = useState<StagedProject | null>(null);
  const [history, setHistory] = useState<ProjectHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeStageName, setActiveStageName] = useState('decomposition');
  const [expandedStageName, setExpandedStageName] = useState<string | null>('decomposition');
  const [, setManuallySelectedStage] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [feedback, setFeedback] = useState('');
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stageWorkspaceRef = useRef<HTMLElement | null>(null);
  const generatedContentRef = useRef<HTMLDivElement | null>(null);
  const codePanelRef = useRef<HTMLDivElement | null>(null);
  const finalReportRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void loadHistory();
  }, []);

  const selectedStage = useMemo(
    () => project?.stages.find((stage) => stage.name === activeStageName) || project?.stages[0],
    [project, activeStageName],
  );
  const nextRunnableStage = useMemo(
    () => (project ? getNextRunnableStage(project.stages, activeStageName) : null),
    [project, activeStageName],
  );

  function scrollToElement(element: HTMLElement | null) {
    window.setTimeout(() => {
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function selectStage(stageName: string, manual = false) {
    setActiveStageName(stageName);
    setExpandedStageName(stageName);
    setManuallySelectedStage(manual);
  }

  function addEvent(type: string, agent: string, message: string, stage?: string) {
    setEvents((prev) => [...prev, { type, agent, message, stage, timestamp: new Date().toISOString() }]);
  }

  async function request<T>(path: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
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
        throw new Error(await response.text());
      }
      return (await response.json()) as T;
    } catch (err) {
      throw new Error(errorMessage(err, 'Request timed out. Please retry.'));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const projects = await request<ProjectHistoryItem[]>('/projects');
      setHistory(projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project history');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function guarded(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
      addEvent('workflow_failed', 'System', message);
    } finally {
      setBusy(false);
    }
  }

  async function openProject(projectId: string) {
    await guarded(async () => {
      const loaded = await request<StagedProject>(`/projects/${projectId}`);
      if (!Array.isArray(loaded.stages)) {
        throw new Error('This saved item is from the older quick-run flow and cannot be reopened in the staged workspace.');
      }
      const defaultStage = getDefaultExpandedStage(loaded.stages);
      setProject(loaded);
      selectStage(defaultStage?.name || loaded.current_stage || 'decomposition');
      setFeedback('');
      setEvents([]);
      setSelectedFileId(loaded.generated_files[0]?.id);
      addEvent('project_loaded', 'System', 'Loaded saved conversation.', defaultStage?.name || loaded.current_stage);
      scrollToElement(stageWorkspaceRef.current);
    });
  }

  async function createProject() {
    await guarded(async () => {
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
      });
      setProject(created);
      selectStage('decomposition');
      setEvents([]);
      addEvent('workflow_started', 'Orchestrator Agent', 'Project created. Decomposition is ready to run.', 'decomposition');
      await loadHistory();
      scrollToElement(stageWorkspaceRef.current);
    });
  }

  async function runStage(stageName: string, stageFeedback?: string) {
    if (!project) return;
    const stage = project.stages.find((item) => item.name === stageName);
    await guarded(async () => {
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
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), STAGE_RUN_TIMEOUT_MS);
      try {
        const response = await fetch(`${API_BASE_URL}/projects/${project.id}/stages/${stageName}/run-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: stageFeedback || null }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(await response.text());
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
        await loadHistory();
        scrollToElement(generatedContentRef.current);
      } catch (err) {
        const message = errorMessage(err, `${stageLabels[stageName] || stageName} timed out. Click Retry Stage to run it again.`);
        setProject((current) => (current ? updateStageInProject(current, stageName, { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', stage?.assigned_agent || 'Agent', message, stageName);
        await loadHistory();
        throw new Error(message);
      } finally {
        window.clearTimeout(timeoutId);
      }
    });
  }

  async function approveStage(stageName: string) {
    if (!project) return;
    await guarded(async () => {
      const updated = await request<StagedProject>(`/projects/${project.id}/stages/${stageName}/approve`, { method: 'POST' });
      setProject(updated);
      const nextStage = getNextRunnableStage(updated.stages, stageName);
      if (nextStage) {
        selectStage(nextStage.name);
      }
      addEvent('stage_completed', 'User', `Approved ${stageLabels[stageName] || stageName}.`, stageName);
      await loadHistory();
      scrollToElement(stageWorkspaceRef.current);
    });
  }

  async function reviseStage(stageName: string) {
    if (!project) return;
    await guarded(async () => {
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
        );
        setProject(updated);
        selectStage(stageName);
        setFeedback('');
        addEvent('stage_awaiting_approval', updated.stages.find((stage) => stage.name === stageName)?.assigned_agent || 'Agent', 'Revision is awaiting approval.', stageName);
        await loadHistory();
        scrollToElement(generatedContentRef.current);
      } catch (err) {
        const message = errorMessage(err, `${stageLabels[stageName] || stageName} revision timed out. Click Retry Stage to run it again.`);
        setProject((current) => (current ? updateStageInProject(current, stageName, { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', stageName, message, stageName);
        await loadHistory();
        throw new Error(message);
      }
    });
  }

  async function resolveConflict(conflict: Conflict, action: 'resolve' | 'accept_risk') {
    if (!project) return;
    await guarded(async () => {
      addEvent(action === 'resolve' ? 'negotiation_started' : 'agent_message', 'Negotiator Agent', conflict.description, 'negotiation');
      const updated = await request<StagedProject>(`/projects/${project.id}/conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setProject(updated);
      addEvent('negotiation_completed', 'Negotiator Agent', action === 'resolve' ? 'Conflict resolved.' : 'Risk accepted.', 'negotiation');
      await loadHistory();
    });
  }

  async function runBaseline() {
    if (!project) return;
    await guarded(async () => {
      addEvent('baseline_started', 'Single Agent Baseline', 'Running single-agent baseline comparison.');
      const updated = await request<StagedProject>(`/projects/${project.id}/baseline/run`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS);
      setProject(updated);
      addEvent('comparison_completed', 'System', 'Baseline comparison completed.');
      await loadHistory();
    });
  }

  async function generateCode() {
    if (!project) return;
    await guarded(async () => {
      selectStage('code_generation');
      setProject((current) => (current ? updateStageInProject(current, 'code_generation', { status: 'running', can_run: true }) : current));
      addEvent('code_generation_started', 'Code Generator Agent', 'Generating starter scaffold.', 'code_generation');
      try {
        const updated = await request<StagedProject>(`/projects/${project.id}/generate-code`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS);
        setProject(updated);
        setSelectedFileId(updated.generated_files[0]?.id);
        addEvent('code_generation_completed', 'Code Generator Agent', 'Starter scaffold generated.', 'code_generation');
        await loadHistory();
        scrollToElement(codePanelRef.current);
      } catch (err) {
        const message = errorMessage(err, 'Code generation timed out. Click Retry Stage to run it again.');
        setProject((current) => (current ? updateStageInProject(current, 'code_generation', { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', 'Code Generator Agent', message, 'code_generation');
        await loadHistory();
        throw new Error(message);
      }
    });
  }

  async function reviewCode() {
    if (!project) return;
    await guarded(async () => {
      selectStage('code_review');
      setProject((current) => (current ? updateStageInProject(current, 'code_review', { status: 'running', can_run: true }) : current));
      try {
        const updated = await request<StagedProject>(`/projects/${project.id}/review-code`, { method: 'POST' }, STAGE_RUN_TIMEOUT_MS);
        setProject(updated);
        addEvent('stage_completed', 'Code Reviewer Agent', 'Code review completed.', 'code_review');
        await loadHistory();
      } catch (err) {
        const message = errorMessage(err, 'Code review timed out. Click Retry Stage to run it again.');
        setProject((current) => (current ? updateStageInProject(current, 'code_review', { status: 'failed', can_run: true }) : current));
        addEvent('workflow_failed', 'Code Reviewer Agent', message, 'code_review');
        await loadHistory();
        throw new Error(message);
      }
    });
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
        <header className="mb-6">
          <div className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-700">
            Qwen Cloud - Agent Society
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">DevTeam AI</h1>
          <p className="mt-3 max-w-4xl text-base leading-7 text-slate-600">
            A staged multi-agent software delivery team with decomposition, role assignment, visible dialogue,
            CTO challenges, negotiation, approval gates, baseline scoring, and optional starter-code generation.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[280px_390px_1fr]">
          <HistorySidebar
            activeProjectId={project?.id}
            busy={busy}
            history={history}
            loading={historyLoading}
            onOpen={openProject}
            onRefresh={() => {
              void loadHistory();
            }}
          />

          <aside className="h-fit rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">Product idea</span>
                <textarea className="mt-2 min-h-40 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" value={idea} onChange={(event) => setIdea(event.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">Target users</span>
                <input className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" value={targetUsers} onChange={(event) => setTargetUsers(event.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">Platform</span>
                <input className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" value={platform} onChange={(event) => setPlatform(event.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">Preferred frontend/mobile stack</span>
                <select className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" value={preferredFrontendStack} onChange={(event) => setPreferredFrontendStack(event.target.value)}>
                  {frontendStackOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-800">Constraints, one per line</span>
                <textarea className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" value={constraints} onChange={(event) => setConstraints(event.target.value)} />
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <input className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" type="checkbox" checked={includeBaseline} onChange={(event) => setIncludeBaseline(event.target.checked)} />
                Include single-agent baseline
              </label>
              <button className="inline-flex w-full items-center justify-center rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400" disabled={busy || idea.trim().length < 10} onClick={createProject}>
                {project ? 'Create New Project' : 'Create Staged Project'}
              </button>
              <ErrorState message={error} />
            </div>
          </aside>

          <div className="space-y-6">
            {project ? (
              <>
                <ProjectStepper
                  nextRunnableName={nextRunnableStage?.name}
                  onSelect={(stageName) => selectStage(stageName, true)}
                  selectedStage={selectedStage?.name || activeStageName}
                  stages={project.stages}
                />
                <StageWorkspace
                  busy={busy}
                  expanded={expandedStageName === selectedStage?.name}
                  feedback={feedback}
                  generatedContentRef={generatedContentRef}
                  onApprove={() => selectedStage && approveStage(selectedStage.name)}
                  onRegenerate={() => selectedStage && runStage(selectedStage.name)}
                  onRevise={() => selectedStage && reviseStage(selectedStage.name)}
                  onRun={() => selectedStage && runStage(selectedStage.name)}
                  onToggleExpanded={() => {
                    if (!selectedStage) return;
                    setExpandedStageName(expandedStageName === selectedStage.name ? null : selectedStage.name);
                  }}
                  setFeedback={setFeedback}
                  stage={selectedStage}
                  stageWorkspaceRef={stageWorkspaceRef}
                />
                <AgentDialogueTimeline dialogue={project.dialogue} />
                <ConflictPanel
                  busy={busy}
                  conflicts={project.conflicts}
                  onAcceptRisk={(conflict) => resolveConflict(conflict, 'accept_risk')}
                  onResolve={(conflict) => resolveConflict(conflict, 'resolve')}
                />
                <BaselinePanel busy={busy} comparison={project.baseline_comparison} onRun={runBaseline} />
                <div ref={codePanelRef}>
                  <CodePanel
                    busy={busy}
                    exportHref={`${API_BASE_URL}/projects/${project.id}/export`}
                    files={project.generated_files}
                    onGenerate={generateCode}
                    onReview={reviewCode}
                    selectedFileId={selectedFileId}
                    setSelectedFileId={setSelectedFileId}
                  />
                </div>
                <section aria-label="Final report" ref={finalReportRef}>
                  {reportResult && (
                    <ReportLayout
                      apiBaseUrl={API_BASE_URL}
                      expandedStageName={expandedStageName || getDefaultExpandedStage(project.stages)?.name || undefined}
                      requestContext={{ platform, preferredFrontendStack, targetUsers }}
                      result={reportResult}
                    />
                  )}
                </section>
              </>
            ) : (
              <>
                <ActivityTimeline events={events} />
                <article className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-8 text-center shadow-sm">
                  <h2 className="text-xl font-bold text-slate-950">Agent Society Workspace</h2>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                    Create a staged project to unlock decomposition, approvals, dialogue, conflicts, baseline comparison,
                    and code generation.
                  </p>
                </article>
              </>
            )}
            {project && <ActivityTimeline events={events} />}
          </div>
        </section>
      </div>
    </main>
  );
}
