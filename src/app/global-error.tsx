'use client';

// Ошибка корневого layout: CSS и шрифты не загружены, поэтому inline-стили в значениях Night.
// Единственное место с hex в UI (исключение из правила токенов, docs/design-system.md §8.4).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const btn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: 44, padding: '0 20px', borderRadius: 12, border: 0, font: '600 15px system-ui, sans-serif', cursor: 'pointer', textDecoration: 'none' } as const;
  return (
    <html lang="ru">
      <head><title>Что-то пошло не так · PS Tracker</title></head>
      <body style={{ margin: 0, background: '#0e0f16', color: '#eef0fa', fontFamily: 'system-ui, sans-serif' }}>
        <main role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ maxWidth: 420 }}>
            <h1 style={{ margin: '0 0 12px', fontSize: 22, lineHeight: '28px' }}>Что-то пошло не так</h1>
            <p style={{ margin: '0 0 24px', color: '#aeb3cc', fontSize: 15, lineHeight: '22px' }}>Страница не загрузилась. Данные в безопасности, попробуй ещё раз.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => reset()} style={{ ...btn, background: '#b99cff', color: '#14101f' }}>Обновить</button>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- корневой layout сломан: клиентский роутер недоступен, нужна полная навигация */}
              <a href="/" style={{ ...btn, background: 'transparent', color: '#eef0fa', border: '1px solid #aeb3cc' }}>В коллекцию</a>
            </div>
            {error.digest && <p style={{ margin: '16px 0 0', color: '#aeb3cc', fontSize: 12, userSelect: 'text' }}>Код: {error.digest}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
