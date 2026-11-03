import type { GameItem } from '@/server/collection/types';
import { Icon } from '../../icons';
import { guideLinks, guideQuery } from '../guides';

/** F2-A: вкладка «Гайды» — ссылки-поиск на PowerPyx и PSNProfiles (английские гайды). Без запросов с сервера. */
export function GuidesTab({ game }: { game: Pick<GameItem, 'title'> }) {
  const links = guideLinks(game.title);
  return (
    <section className="ps-gd__sec ps-gd__guides" aria-labelledby="gd-guides">
      <h3 id="gd-guides">Гайды по трофеям</h3>
      <p className="ps-gd__note">Поиск по названию «{guideQuery(game.title)}». Гайды на английском, откроются на сайте.</p>
      <ul className="ps-gd__glist">
        {links.map((l) => (
          <li key={l.id}>
            <a className="ps-gd__glink" href={l.href} target="_blank" rel="noopener noreferrer" data-guide={l.id}>
              <span className="ps-gd__gname">{l.label}: найти гайд</span>
              <span className="ps-gd__gsite">{l.site}</span>
              <Icon name="external-link" size={16} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
