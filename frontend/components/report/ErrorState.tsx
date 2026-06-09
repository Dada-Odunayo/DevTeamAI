type ErrorStateProps = {
  message: string;
};

export function ErrorState({ message }: ErrorStateProps) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <p className="font-semibold">Workflow error</p>
      <p className="mt-1 leading-6">{message}</p>
    </div>
  );
}
