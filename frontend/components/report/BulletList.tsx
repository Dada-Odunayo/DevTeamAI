import { asString } from '../../lib/report-utils';

type BulletListProps = {
  items: unknown[];
  ordered?: boolean;
};

export function BulletList({ items, ordered = false }: BulletListProps) {
  const cleanItems = items.map(asString).filter(Boolean);

  if (cleanItems.length === 0) return null;

  const ListTag = ordered ? 'ol' : 'ul';

  return (
    <ListTag className={ordered ? 'list-decimal space-y-2 pl-5' : 'list-disc space-y-2 pl-5'}>
      {cleanItems.map((item, index) => (
        <li className="leading-6 text-slate-700" key={`${item}-${index}`}>
          {item}
        </li>
      ))}
    </ListTag>
  );
}
