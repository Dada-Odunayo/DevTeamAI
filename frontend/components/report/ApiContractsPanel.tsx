import { getPath } from '../../lib/report-utils';
import { AgentOutputCard, CodeBlock } from './AgentOutputCard';

type ApiContractsPanelProps = {
  backend: Record<string, unknown>;
};

export function ApiContractsPanel({ backend }: ApiContractsPanelProps) {
  const endpoints = getPath(backend, ['api_endpoints', 'endpoints', 'api_contracts']);
  const openApi = getPath(backend, ['openapi_yaml', 'openapi', 'openapi_schema']);

  return (
    <div className="space-y-4">
      <AgentOutputCard
        title="API endpoints"
        value={endpoints}
        description="HTTP methods, paths, purposes, request shapes, and response shapes."
      />
      {typeof openApi === 'string' && openApi.trim() && (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-base font-semibold text-slate-950">OpenAPI contract</h3>
          <CodeBlock code={openApi} language="yaml" />
        </article>
      )}
    </div>
  );
}
