type RawJsonDetailsProps = {
  value: unknown;
};

export function RawJsonDetails({ value }: RawJsonDetailsProps) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-semibold text-slate-800">View raw JSON</summary>
      <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </details>
  );
}
