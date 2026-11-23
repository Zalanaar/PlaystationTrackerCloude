import Link from '@/ui/IntentLink';
import { formatNumber } from '../format';
import { Icon } from '../icons';
import type { StatusTab } from './filters';
import type { PlatformKey } from '@/shared/platform-filter';

/** На чистой главной блоки Бэклог/Сервисы/Отложено заменяются одной строкой-ссылкой. */
export function isHomeBacklogRow(f: {
  status: StatusTab;
  q: string;
  platinum: boolean;
  platform: PlatformKey | null;
  hidden?: boolean;
  tag?: number | null;
}): boolean {
  return f.status === 'all' && !f.q.trim() && !f.platinum && f.platform === null && !f.hidden && !f.tag;
}

export function backlogLinkLabel(counts: { backlog: number; shelved: number; service: number }): string | null {
  const parts: string[] = [];
  if (counts.backlog > 0) parts.push(`Бэклог ${formatNumber(counts.backlog)}`);
  if (counts.shelved > 0) parts.push(`Отложено ${formatNumber(counts.shelved)}`);
  if (counts.service > 0) parts.push(`Сервисы ${formatNumber(counts.service)}`);
  return parts.length ? parts.join(' · ') : null;
}

export function BacklogLinkRow({ counts }: { counts: { backlog: number; shelved: number; service: number } }) {
  const label = backlogLinkLabel(counts);
  if (!label) return null;
  return (
    <p className="ps-backlog-row">
      <Link href="/backlog" className="ps-backlog-row__link" data-testid="home-backlog-row">
        <span>{label}</span>
        <Icon name="arrow-right" size={16} />
      </Link>
    </p>
  );
}
