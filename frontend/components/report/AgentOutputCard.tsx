import { asString, formatLabel, isEmptyValue, isPlainObject, objectEntries } from '../../lib/report-utils';
import { BulletList } from './BulletList';
import { KeyValueList } from './KeyValueList';

type AgentOutputCardProps = {
  title: string;
  value: unknown;
  description?: string;
  codeLanguage?: string;
};

function isPrimitive(value: unknown) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function objectArrayKeys(items: unknown[]) {
  const keys = new Set<string>();
  for (const item of items) {
    if (!isPlainObject(item)) return [];
    Object.keys(item).forEach((key) => keys.add(key));
  }
  return Array.from(keys);
}

function shouldRenderTable(items: unknown[]) {
  const keys = objectArrayKeys(items);
  return keys.length > 0 && keys.length <= 6 && items.length <= 20;
}

function DataTable({ rows }: { rows: unknown[] }) {
  const keys = objectArrayKeys(rows);
  if (keys.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {keys.map((key) => (
              <th className="px-3 py-2 font-semibold text-slate-700" key={key} scope="col">
                {formatLabel(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, index) => {
            const objectRow = isPlainObject(row) ? row : {};
            return (
              <tr key={index}>
                {keys.map((key) => (
                  <td className="max-w-xs px-3 py-3 align-top text-slate-700" key={key}>
                    <RenderUnknownValue compact value={objectRow[key]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      <code>{language ? `${language}\n${code}` : code}</code>
    </pre>
  );
}

export function RenderUnknownValue({ value, compact = false }: { value: unknown; compact?: boolean }) {
  if (isEmptyValue(value)) return <span className="text-slate-400">Not specified</span>;

  if (typeof value === 'string') {
    return <p className={compact ? 'text-sm leading-6 text-slate-700' : 'leading-7 text-slate-700'}>{value}</p>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-medium text-slate-800">{asString(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return <BulletList items={value} />;
    if (shouldRenderTable(value)) return <DataTable rows={value} />;

    return (
      <div className="grid gap-3 md:grid-cols-2">
        {value.map((item, index) => (
          <article className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={index}>
            <RenderUnknownValue value={item} />
          </article>
        ))}
      </div>
    );
  }

  if (isPlainObject(value)) {
    return <KeyValueList entries={objectEntries(value)} />;
  }

  return <p className="text-sm leading-6 text-slate-700">{asString(value)}</p>;
}

export function AgentOutputCard({ title, value, description, codeLanguage }: AgentOutputCardProps) {
  if (isEmptyValue(value)) {
    return null;
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </header>
      {codeLanguage ? <CodeBlock code={asString(value)} language={codeLanguage} /> : <RenderUnknownValue value={value} />}
    </article>
  );
}

export { CodeBlock, DataTable };
