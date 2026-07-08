'use client';

import type { ReactNode } from 'react';
import { ReportAccordion, SectionTooltip } from '../Collapsible';

type ReportSectionProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  tooltip?: string;
  children: ReactNode;
  agentName?: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  status?: string;
  version?: number;
};

export function ReportSection({
  eyebrow,
  title,
  description,
  tooltip,
  children,
  agentName,
  defaultExpanded = true,
  collapsible = false,
  status,
  version,
}: ReportSectionProps) {
  const content = (
    <div className="space-y-5 px-5 py-5">
      {children}
    </div>
  );

  if (collapsible) {
    return (
      <ReportAccordion
        defaultExpanded={defaultExpanded}
        eyebrow={eyebrow}
        rightAction={
          typeof version === 'number' ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
              v{version}
            </span>
          ) : null
        }
        status={status}
        subtitle={[description, agentName].filter(Boolean).join(' | ') || undefined}
        title={title}
        tooltip={tooltip || description || `Review the ${title.toLowerCase()} output and supporting details.`}
      >
        {children}
      </ReportAccordion>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{eyebrow}</p>}
          <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
        </div>
        <SectionTooltip label={`About ${title}`} text={tooltip || description || `Review the ${title.toLowerCase()} output and supporting details.`} />
      </header>
      {content}
    </section>
  );
}
