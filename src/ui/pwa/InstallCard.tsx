'use client';

// Карточка «Установить приложение» (П15.5: вынесена из InstallPrompt и грузится по первому показу).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../icons';
import { isIpad } from './install-model';

const noopSubscribe = () => () => {};

export default function Card({ platform, busy, onInstall, onDismiss }: { platform: 'ios' | 'android'; busy: boolean; onInstall: () => void; onDismiss: () => void }) {
  const [shown, setShown] = useState(false);
  const ipad = useSyncExternalStore(noopSubscribe, () => isIpad(navigator), () => false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const ios = platform === 'ios';
  return (
    <div
      className={`ps-install${ios ? ' ps-install--ios' : ''}`} role="region" aria-label="Установка приложения"
      data-shown={shown ? 'true' : undefined} data-ipad={ipad ? 'true' : undefined} data-testid="install-prompt"
    >
      <div className="ps-install__body">
      <div className="ps-install__head">
        {/* eslint-disable-next-line @next/next/no-img-element -- иконка приложения 40x40, статический файл */}
        <img className="ps-install__icon" src="/icons/icon-192.png" alt="" width={40} height={40} />
        <div className="ps-install__tx">
          <h2 className="ps-install__title">{ios ? 'Добавить на экран «Домой»' : 'Установить PS Tracker'}</h2>
          <p className="ps-install__text">
            {ios ? 'Так PS Tracker откроется как приложение, без адресной строки' : 'Откроется как приложение: без адресной строки, значок на экране «Домой»'}
          </p>
        </div>
        <button type="button" className="ps-install__x" aria-label="Закрыть" onClick={onDismiss}><Icon name="x" size={16} /></button>
      </div>
      {ios ? (
        <>
          <ol className="ps-install__steps">
            <li><span className="ps-install__n">1</span><Icon name="share" size={20} /><span>Нажми «Поделиться» в панели Safari</span></li>
            <li><span className="ps-install__n">2</span><Icon name="plus-square" size={20} /><span>Выбери «На экран «Домой»»</span></li>
            <li><span className="ps-install__n">3</span><Icon name="check" size={20} /><span>Нажми «Добавить»</span></li>
          </ol>
          <div className="ps-install__foot">
            <button type="button" className="ps-btn ps-btn--ghost ps-install__btn" onClick={onDismiss}>Понятно</button>
          </div>
        </>
      ) : (
        <div className="ps-install__foot">
          <button type="button" className="ps-btn ps-btn--primary ps-install__btn" onClick={onInstall} disabled={busy}>{busy ? 'Ждём подтверждения…' : 'Установить'}</button>
          <button type="button" className="ps-btn ps-btn--ghost ps-install__btn" onClick={onDismiss}>Не сейчас</button>
        </div>
      )}
      </div>
      {ios && <span className="ps-install__arrow" aria-hidden="true" />}
    </div>
  );
}
