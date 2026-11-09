import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению

/** Содержимое 404 (docs/design-system.md §8.4). `root` = вне шелла: колонка по центру на весь экран и логотип-ссылка сверху. */
export function NotFound({ root = false }: { root?: boolean }) {
  return (
    <div className={`ps-nf${root ? ' ps-nf--root' : ''}`}>
      {root && <Link href="/" className="ps-logo ps-nf__logo">PS TRACKER</Link>}
      <p className="ps-nf__code" aria-hidden="true">404</p>
      <h1>Страница не найдена</h1>
      <p>Такой страницы нет или ссылка устарела.</p>
      <Link href="/" className="ps-btn ps-btn--primary">В коллекцию</Link>
    </div>
  );
}
