/** 5 скелетов строки (19c.6): высота 88, список при приходе не прыгает. */
export function OtherPlatformsSkeleton() {
  return (
    <ul className="ps-oplist" aria-busy="true" aria-label="Загрузка списка" data-testid="op-skeleton">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="ps-op ps-op--sk" aria-hidden="true">
          <span className="ps-skeleton ps-op-sk__cover" />
          <span className="ps-op-sk__lines">
            <span className="ps-skeleton ps-op-sk__l1" /><span className="ps-skeleton ps-op-sk__tag" /><span className="ps-skeleton ps-op-sk__l3" />
          </span>
        </li>
      ))}
    </ul>
  );
}
