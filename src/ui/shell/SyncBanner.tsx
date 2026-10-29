'use client';

import { useState } from 'react';
import { formatMoscow, isSyncOverdue, needsNewNpsso, overdueAgeText } from '../sync/status';
import { Icon } from '../icons';
import { useSync } from '../sync/SyncProvider';
import { reasonText } from '../sync/status';

/** Баннеры под шапкой (4.9): протухший NPSSO нельзя скрыть, ошибка синка скрывается до перезагрузки. */
export function SyncBanner() {
  const { status, start, starting, openPanel } = useSync();
  const [hidden, setHidden] = useState(false);
  const [overdueHidden, setOverdueHidden] = useState(false);
  if (!status || status.running) return null;
  const last = formatMoscow(status.lastSuccessAt);
  const npsso = needsNewNpsso(status);
  const overdue = isSyncOverdue(status) && status.overdue && !overdueHidden;
  const overdueBanner = overdue && status.overdue ? (
    <div className="ps-container" data-testid="overdue-banner">
      <div className="ps-banner" data-tone="warning" role="status">
        <Icon name="clock" size={20} />
        <p className="ps-banner__text">
          Синк не запускался уже {overdueAgeText(status.overdue)} (порог {status.overdue.thresholdHours} ч).{last ? ` Данные от ${last}.` : ''} Проверьте расписание на сервере.
        </p>
        <div className="ps-banner__actions">
          <button type="button" className="ps-btn" onClick={() => void start()} disabled={starting}>Синк сейчас</button>
          <button type="button" className="ps-iconbtn" onClick={() => setOverdueHidden(true)} aria-label="Скрыть сообщение">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (npsso) {
    return (
      <>
      <div className="ps-container">
        <div className="ps-banner" data-tone="danger" role="alert">
          <Icon name="key" size={20} />
          <p className="ps-banner__text">
            Синк остановлен: токен доступа к PSN устарел.{last ? ` Данные не обновляются с ${last}.` : ''}
          </p>
          <div className="ps-banner__actions">
            <button type="button" className="ps-btn" onClick={openPanel}>Как обновить</button>
            <button type="button" className="ps-btn" onClick={() => void start()} disabled={starting}>Проверить снова</button>
          </div>
        </div>
      </div>
      {overdueBanner}
      </>
    );
  }

  const run = status.run;
  if (hidden || !run || (run.status !== 'failed' && run.status !== 'partial')) return overdueBanner;
  const why = run.status === 'failed' ? reasonText(run.errorReason) : 'Синк завершился частично.';
  return (
    <>
    <div className="ps-container">
      <div className="ps-banner" data-tone="warning" role="status">
        <Icon name="alert" size={20} />
        <p className="ps-banner__text">
          Не удалось обновить данные из PSN.{last ? ` Показаны данные от ${last}.` : ''} {why}
        </p>
        <div className="ps-banner__actions">
          <button type="button" className="ps-btn" onClick={() => void start()} disabled={starting}>Повторить</button>
          <button type="button" className="ps-iconbtn" onClick={() => setHidden(true)} aria-label="Скрыть сообщение">
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
    </div>
    {overdueBanner}
    </>
  );
}
