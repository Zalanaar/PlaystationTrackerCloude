import { SkRoot } from '../skeletons';

/** Скелет страницы «Профили PSN» (§17.7): pill 60x24, две панели 72, кнопка 100% x 40. */
export function ProfilesSkeleton() {
  return (
    <div className="ps-pprof" aria-busy="true">
      <header className="ps-plist-head">
        <div className="ps-plist-head__row"><h1 className="ps-h1">Профили PSN</h1></div>
      </header>
      <SkRoot>
        <span className="ps-skeleton ps-pprof__sk-pill" />
        <span className="ps-skeleton ps-pprof__sk-panel" />
        <span className="ps-skeleton ps-pprof__sk-panel" />
        <span className="ps-skeleton ps-pprof__sk-btn" />
      </SkRoot>
    </div>
  );
}
