type EmptyStateProps = {
  title?: string;
  message: string;
};

export function EmptyState({ title = 'No data yet', message }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="mt-1 leading-6">{message}</p>
    </div>
  );
}
