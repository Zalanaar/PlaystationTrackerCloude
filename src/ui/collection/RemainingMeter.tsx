'use client';

import type { GameDuration } from '@/server/collection/types';
import { Icon } from '../icons';
import '../backlog.css';
import { remainingView } from './remaining';

/**
 * «осталось ≈ N ч» + тонкая полоса (Фаза 32, спека п.1). Остаток и доля приходят с сервера (`duration.remainingHours`, `duration.progress`).
 * `card`: карточка сетки; `row`: строка вида «Список». `hideBar`: без полосы (игры-сервисы).
 */
export function RemainingMeter({
  duration, playedSeconds, variant, hideBar = false,
}: { duration: GameDuration | undefined; playedSeconds?: number | null; variant: 'card' | 'row'; hideBar?: boolean }) {
  const v = remainingView(duration, playedSeconds);
  if (v.kind === 'none' || (v.kind === 'unknown' && variant === 'row')) return null;
  const hasText = v.text !== null;
  return (
    <div className="ps-rem" data-variant={variant} data-kind={v.kind} data-minimum={v.isMinimum || undefined} data-testid="bl-duration" data-source={v.source ?? undefined} title={v.hint ?? undefined}>
      <p className="ps-rem__line num">
        {hasText && <Icon name="clock" size={12} />}
        {hasText && (
          <span className="ps-rem__t">
            {v.hasWord && <span className="ps-rem__w">осталось </span>}
            <b>{v.text}</b>
          </span>
        )}
        {v.kind === 'unknown' && <span aria-label="Длительность неизвестна">—</span>}
        {v.sourceText && (
          <span className="ps-rem__src" data-source={v.source ?? undefined} data-minimum={v.isMinimum || undefined}>
            {v.source === 'manual' && !v.isMinimum && <Icon name="pencil" size={10} />}{v.sourceText}
          </span>
        )}
        {v.notOnHltb && (
          <span className="ps-rem__nf" data-testid="bl-no-hltb"><Icon name="alert" size={12} />нет на HLTB</span>
        )}
      </p>
      {v.kind === 'remaining' && !hideBar && v.percent !== null && (
        <div className="ps-rem__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.percent} aria-label={v.label}>
          {v.fill !== null && v.fill > 0 && <i style={{ width: `${v.percent}%` }} />}
        </div>
      )}
    </div>
  );
}
