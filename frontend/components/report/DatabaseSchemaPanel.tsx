import { getPath } from '../../lib/report-utils';
import { AgentOutputCard, CodeBlock } from './AgentOutputCard';

type DatabaseSchemaPanelProps = {
  backend: Record<string, unknown>;
};

export function DatabaseSchemaPanel({ backend }: DatabaseSchemaPanelProps) {
  const schema = getPath(backend, ['database_schema_sql', 'database_schema', 'schema_sql', 'schema']);

  if (typeof schema === 'string' && schema.trim()) {
    return (
      <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-base font-semibold text-slate-950">Database schema</h3>
        <CodeBlock code={schema} language="sql" />
      </article>
    );
  }

  return <AgentOutputCard title="Database schema" value={schema} />;
}
