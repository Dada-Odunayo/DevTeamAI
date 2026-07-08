type ErrorStateProps = {
  message: string;
};

export function ErrorState({ message }: ErrorStateProps) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <p className="font-semibold">Workflow error</p>
      <div className="mt-2 max-h-40 overflow-auto rounded-md border border-rose-100 bg-white/50 px-3 py-2">
        <p className="whitespace-pre-wrap break-words leading-6">{message}</p>
      </div>
    </div>
  );
}
