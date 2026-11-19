// П16.2: данные вкладок заранее — в простое после первого запуска и по намерению (касание вкладки). Ответы ложатся
// в общий кэш GET (data/http, 30 с), и раздел при открытии берёт их без сети. Модуль грузится лениво (не JS главной).
import { PLATFORM_COOKIE, parsePlatform } from '@/shared/platform-filter';
import { fetchBacklogAge, fetchGames } from '../collection/api';
import { BACKLOG_PAGE, backlogToApi, parseBacklogFilters, serviceToApi, shelvedToApi } from '../collection/backlog';
import { fetchManual, fetchMatches } from '../collection/manualApi';
import { fetchRoadmap } from '../roadmap/api';

const quiet = () => {};

function platformFromCookie(): ReturnType<typeof parsePlatform> {
  const m = document.cookie.match(new RegExp(`(?:^|; )${PLATFORM_COOKIE}=([^;]*)`));
  return parsePlatform(m ? decodeURIComponent(m[1]) : null);
}

/** Те же запросы, что делает Бэклог при первом входе без параметров адреса (ключи кэша совпадают). */
export function prefetchTabData(tab: string): void {
  if (tab !== 'backlog') return;
  const f = parseBacklogFilters(new URLSearchParams(), platformFromCookie());
  fetchGames(backlogToApi(f, { limit: BACKLOG_PAGE, offset: 0 })).catch(quiet);
  fetchGames(shelvedToApi()).catch(quiet);
  fetchGames(serviceToApi()).catch(quiet);
  fetchManual().catch(quiet);
  fetchMatches().catch(quiet);
  fetchRoadmap().catch(quiet);
  fetchBacklogAge().catch(quiet);
}
