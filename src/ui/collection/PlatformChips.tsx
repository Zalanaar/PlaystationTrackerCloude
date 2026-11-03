'use client';

import { formatNumber } from '../format';
import { platformChoices, type PlatformCounts, type PlatformKey } from '@/shared/platform-filter';

/**
 * F4: чипы платформ (Бэклог: строка фильтров и sheet). Только платформы, где игр не меньше двух; вариантов меньше двух — ничего.
 * Нажатый чип снимается повторным нажатием.
 */
export function PlatformChips({ value, counts, onChange, className = 'ps-bl-group' }: {
  value: PlatformKey | null; counts: PlatformCounts | null; onChange: (v: PlatformKey | null) => void; className?: string;
}) {
  const opts = platformChoices(counts, value);
  if (opts.length === 0) return null;
  return (
    <div className={className} role="group" aria-label="Платформа" data-testid="platform-chips">
      {opts.map((o) => (
        <button
          key={o.id} type="button" className="ps-filterchip ps-chip" data-platform={o.id} aria-pressed={value === o.id}
          aria-label={counts ? `${o.label}: ${formatNumber(o.n)}` : o.label} onClick={() => onChange(value === o.id ? null : o.id)}
        >
          <span className="ps-filterchip__t">{o.label}</span>{' '}
          {counts && <span className="ps-filterchip__n num">{formatNumber(o.n)}</span>}
        </button>
      ))}
    </div>
  );
}
