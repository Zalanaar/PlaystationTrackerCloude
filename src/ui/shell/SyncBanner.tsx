'use client';

import { useState } from 'react';
import { formatMoscow, needsNewNpsso } from '../sync/status';
import { Icon } from '../icons';
import { useSync } from '../sync/SyncProvider';
import { reasonText } from '../sync/status';

/** Баннеры под шапкой (4.9): протухший NPSSO нельзя скрыть, ошибка синка скрывается до перезагрузки. */
export function SyncBanner() {
  const { status, start, starting, openPanel } = useSync();
  const [hidden, setHidden] = useState(false);
  if (!status || status.running) return null;
  const last = formatMoscow(status.lastSuccessAt);

  if (needsNewNpsso(status)) {
    return (
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
    );
  }

  const run = status.run;
  if (hidden || !run || (run.status !== 'failed' && run.status !== 'partial')) return null;
  const why = run.status === 'failed' ? reasonText(run.errorReason) : 'Синк завершился частично.';
  return (
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
  );
}
