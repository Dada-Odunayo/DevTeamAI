'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

type ExpandCollapseButtonProps = {
  expanded: boolean;
  controlsId?: string;
  onClick?: () => void;
  className?: string;
};

export type CollapsibleCardProps = {
  title: string;
  subtitle?: string;
  tooltip?: string;
  status?: string;
  defaultExpanded?: boolean;
  isActive?: boolean;
  children: ReactNode;
  rightAction?: ReactNode;
  onToggle?: (expanded: boolean) => void;
};

type CollapsibleBaseProps = CollapsibleCardProps & {
  eyebrow?: string;
  className?: string;
  contentClassName?: string;
  compact?: boolean;
};

function statusPillClass(status: string) {
  const normalized = status.toLowerCase().replaceAll(' ', '_');
  if (normalized === 'approved' || normalized === 'resolved' || normalized === 'complete') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (normalized === 'running') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (normalized === 'awaiting_approval') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (normalized === 'needs_revision' || normalized === 'open') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (normalized === 'failed' || normalized === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function isApprovedStatus(status?: string) {
  const normalized = status?.toLowerCase().replaceAll(' ', '_');
  return normalized === 'approved' || normalized === 'resolved' || normalized === 'complete';
}

export function SectionTooltip({ label = 'Section help', text }: { label?: string; text?: string }) {
  if (!text) return null;

  return (
    <span className="group relative inline-flex">
      <span
        aria-label={`${label}: ${text}`}
        className="inline-flex h-7 w-7 cursor-help items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-500 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        role="note"
        tabIndex={0}
        title={text}
      >
        ?
      </span>
      <span className="pointer-events-none absolute right-0 top-9 z-30 hidden w-64 rounded-lg border border-slate-200 bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-lg group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function ExpandCollapseButton({ expanded, controlsId, onClick, className = '' }: ExpandCollapseButtonProps) {
  return (
    <button
      aria-controls={controlsId}
      aria-expanded={expanded}
      className={`rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      type="button"
    >
      {expanded ? 'Collapse' : 'Expand'}
    </button>
  );
}

function CollapsibleBase({
  eyebrow,
  title,
  subtitle,
  tooltip,
  status,
  defaultExpanded = false,
  isActive = false,
  children,
  rightAction,
  onToggle,
  className = '',
  contentClassName = 'space-y-5 px-5 py-5',
  compact = false,
}: CollapsibleBaseProps) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    onToggle?.(next);
  }

  return (
    <section
      className={`rounded-lg border bg-white shadow-sm transition ${
        isActive
          ? isApprovedStatus(status)
            ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-200'
            : 'border-sky-500 bg-sky-50/40 ring-2 ring-sky-200'
          : 'border-slate-200'
      } ${className}`}
    >
      <header
        className={`flex flex-col gap-3 border-slate-200 px-5 sm:flex-row sm:items-start sm:justify-between ${
          expanded ? 'border-b py-4' : compact ? 'py-3' : 'py-4'
        }`}
      >
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="-mx-2 min-w-0 flex-1 rounded-md px-2 py-1 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          onClick={toggle}
          type="button"
        >
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{eyebrow}</p>}
          <h2 className={`${compact ? 'text-lg' : 'text-xl'} mt-1 font-bold text-slate-950`}>{title}</h2>
          {subtitle && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p>}
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SectionTooltip label={`About ${title}`} text={tooltip || subtitle} />
          {status && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusPillClass(status)}`}>
              {status.replaceAll('_', ' ')}
            </span>
          )}
          {rightAction}
          <ExpandCollapseButton controlsId={contentId} expanded={expanded} onClick={toggle} />
        </div>
      </header>
      {expanded && (
        <div className={contentClassName} id={contentId}>
          {children}
        </div>
      )}
    </section>
  );
}

export function CollapsibleCard(props: CollapsibleCardProps) {
  return <CollapsibleBase {...props} />;
}

export function CollapsibleSection(props: CollapsibleCardProps & { eyebrow?: string }) {
  return <CollapsibleBase {...props} eyebrow={props.eyebrow} compact />;
}

export function StageAccordion(props: CollapsibleCardProps) {
  return <CollapsibleBase {...props} eyebrow="Stage Workspace" />;
}

export function ReportAccordion(props: CollapsibleCardProps & { eyebrow?: string }) {
  return <CollapsibleBase {...props} eyebrow={props.eyebrow} />;
}
