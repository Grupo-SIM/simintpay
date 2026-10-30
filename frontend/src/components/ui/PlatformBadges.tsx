import { getPlatformBadgeClass } from '@/lib/utils';
import { platformLabel } from './platform-label';

export function PlatformBadges({ platforms }: { platforms: string[] }) {
  if (!platforms.length) return <span className="text-zinc-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {platforms.map((tag) => (
        <span
          key={tag}
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase whitespace-nowrap ${getPlatformBadgeClass(tag)}`}
        >
          {platformLabel(tag)}
        </span>
      ))}
    </span>
  );
}
