import { SectionTooltip } from '../Collapsible';

type RawJsonDetailsProps = {
  value: unknown;
};

export function RawJsonDetails({ value }: RawJsonDetailsProps) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <summary className="flex cursor-pointer items-center justify-between gap-3 font-semibold text-slate-800">
        <span>Developer debug: raw JSON</span>
        <SectionTooltip
          label="About Raw JSON"
          text="Shows the underlying project payload for debugging when the formatted report needs deeper inspection."
        />
      </summary>
      <pre className="mt-4 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </details>
  );
}
