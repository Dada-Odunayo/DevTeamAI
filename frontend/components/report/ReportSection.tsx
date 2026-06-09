'use client';

import { useEffect, useState, type ReactNode } from 'react';

type ReportSectionProps = {
  eyebrow?: string;
  title: string;
  description?: string;
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
  children,
  agentName,
  defaultExpanded = true,
  collapsible = false,
  status,
  version,
}: ReportSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  useEffect(() => {
    setIsOpen(defaultExpanded);
  }, [defaultExpanded]);

  const content = (
    <div className="space-y-5 px-5 py-5">
      {children}
    </div>
  );

  if (collapsible) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <button
          className="block w-full border-b border-slate-200 px-5 py-4 text-left"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{eyebrow}</p>}
              <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
              {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
              {agentName && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{agentName}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {status && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {status.replaceAll('_', ' ')}
                </span>
              )}
              {typeof version === 'number' && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  v{version}
                </span>
              )}
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                {isOpen ? 'Collapse' : 'Expand'}
              </span>
            </div>
          </div>
        </button>
        {isOpen && content}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-5 py-4">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{eyebrow}</p>}
        <h2 className="mt-1 text-xl font-bold text-slate-950">{title}</h2>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>}
      </header>
      {content}
    </section>
  );
}
