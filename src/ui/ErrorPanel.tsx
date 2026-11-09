'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

let lastResetAt = 0;

/**
 * Панель ошибки рендера (docs/design-system.md §8.4) для error.tsx. Текст исключения и stack не показываются, только `digest`.
 * «Обновить» = reset(); если ошибка повторилась меньше чем за 2 с после прошлого reset(), перезагружает страницу.
 */
export function ErrorPanel({ reset, digest }: { reset: () => void; digest?: string }) {
  const head = useRef<HTMLHeadingElement>(null);
  const [repeated] = useState(() => Date.now() - lastResetAt < 2000);
  useEffect(() => { head.current?.focus(); }, []);
  return (
    <div className="ps-errpage">
      <div className="ps-empty" role="alert">
        <span className="ps-empty__icon"><Icon name="circle-alert" size={40} /></span>
        <h2 className="ps-h2" ref={head} tabIndex={-1}>Что-то пошло не так</h2>
        <p className="ps-empty__text">Страница не загрузилась. Данные в безопасности, попробуй ещё раз.</p>
        <div className="ps-errpage__acts">
          <button
            type="button" className="ps-btn ps-btn--primary"
            onClick={() => { if (repeated) window.location.reload(); else { lastResetAt = Date.now(); reset(); } }}
          >Обновить</button>
          <Link href="/" className="ps-btn ps-btn--ghost">В коллекцию</Link>
        </div>
        {digest && <p className="ps-errpage__code">Код: {digest}</p>}
      </div>
    </div>
  );
}
