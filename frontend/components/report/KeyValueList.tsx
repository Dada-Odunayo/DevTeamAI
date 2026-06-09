import type { ReactNode } from 'react';

import { asString, formatLabel, isEmptyValue, isPlainObject, objectEntries } from '../../lib/report-utils';
import { BulletList } from './BulletList';

type KeyValueListProps = {
  entries: Array<[string, unknown]>;
};

function isPrimitive(value: unknown) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function renderValue(value: unknown): ReactNode {
  if (isEmptyValue(value)) {
    return <span className="text-slate-400">Not specified</span>;
  }

  if (isPrimitive(value)) {
    return <span className="leading-6 text-slate-700">{asString(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) {
      return <BulletList items={value} />;
    }

    return (
      <div className="space-y-3">
        {value.map((item, index) => (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" key={index}>
            {isPlainObject(item) ? (
              <KeyValueList entries={objectEntries(item)} />
            ) : (
              <span className="text-sm text-slate-700">{asString(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return <KeyValueList entries={objectEntries(value)} />;
  }

  return <span className="text-slate-700">{asString(value)}</span>;
}

export function KeyValueList({ entries }: KeyValueListProps) {
  const cleanEntries = entries.filter(([, value]) => !isEmptyValue(value));

  if (cleanEntries.length === 0) return null;

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {cleanEntries.map(([key, value]) => (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={key}>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatLabel(key)}</dt>
          <dd className="mt-2 text-sm">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
