// Облегчённые данные первого экрана `/` для HTML (item 4, след. шаг): только поля, которые рисуют карточки, герой, строки и «Ближе к платине».
// Полные ответы API не меняются. Клиент не кладёт облегчённые тела в кэш GET и для окна игры берёт полные данные из GET /api/games/{id}.
import type { CollectionInitial, CollectionSummaryResponse, GameItem, GamesBatchResponse, GameTrophies } from './types';

/**
 * Без: duration (окно игры и Бэклог), trophies.byType (не рисуется в src/ui), баннера у не «Играю» (баннер рисует только герой),
 * пустых linkedVersions и null duplicateOfGameId/hiddenAt (необязательные поля; значения по умолчанию те же).
 */
export function slimGame(g: GameItem): GameItem {
  const out: GameItem = {
    id: g.id, title: g.title, coverUrl: g.coverUrl, bannerUrl: g.status === 'playing' ? g.bannerUrl : null, platform: g.platform,
    playSeconds: g.playSeconds, hours: g.hours, playCount: g.playCount, lastPlayedAt: g.lastPlayedAt, status: g.status,
    completedAt: g.completedAt, droppedAt: g.droppedAt, trophies: g.trophies ? slimTrophies(g.trophies) : null, genres: g.genres,
  };
  if (g.tint != null) out.tint = g.tint;
  if (g.hiddenAt) out.hiddenAt = g.hiddenAt;
  if (g.linkedVersions && g.linkedVersions.length > 0) out.linkedVersions = g.linkedVersions;
  if (g.duplicateOfGameId != null) out.duplicateOfGameId = g.duplicateOfGameId;
  return out;
}

function slimTrophies(t: GameTrophies): GameTrophies {
  const { byType: _omit, ...rest } = t;
  // byType обязательное в типе ответа API; в облегчённых данных его нет, src/ui его не читает (проверяет slim.test.ts)
  return rest as GameTrophies;
}

/** Сводка для HTML: `continue` и `services` на `/` не рисуются (блок «Сервисы» берётся из пакета блоков). */
export function slimSummary(s: CollectionSummaryResponse): CollectionSummaryResponse {
  return {
    ...s, playing: s.playing.map(slimGame), services: [], continue: [],
    nearPlatinum: s.nearPlatinum.map((n) => ({ ...n, game: slimGame(n.game) })),
  };
}

export function slimBatch(b: GamesBatchResponse): GamesBatchResponse {
  return { results: b.results.map((r) => (r.ok ? { ok: true as const, data: { ...r.data, items: r.data.items.map(slimGame) } } : r)) };
}

export function slimInitial(i: CollectionInitial): CollectionInitial {
  return { ...i, slim: true, summary: slimSummary(i.summary), batch: slimBatch(i.batch) };
}
