// Фаза 0: проба PSN. Единственная точка входа в psn-api на этом этапе.
// Токены и NPSSO никогда не печатаются.
import {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  getProfileFromUserName,
  getUserPlayedGames,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getUserTrophiesForSpecificTitle,
  getTitleTrophies,
} from "psn-api";

type Log = (line: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Печатает ошибку без возможных секретов: только статус/сообщение, обрезано. */
function safeErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]").slice(0, 300);
}

function keysOf(o: unknown): string[] {
  return o && typeof o === "object" ? Object.keys(o as object).sort() : [];
}

async function timed<T>(label: string, log: Log, fn: () => Promise<T>): Promise<T | null> {
  const t = Date.now();
  try {
    const r = await fn();
    log(`  [ok] ${label}: ${Date.now() - t} мс`);
    return r;
  } catch (e) {
    log(`  [ERR] ${label}: ${safeErr(e)}`);
    return null;
  }
}

export async function runProbe(env: NodeJS.ProcessEnv, log: Log): Promise<number> {
  const npsso = env.PSN_NPSSO?.trim();
  const target = env.PSN_TARGET_ONLINE_ID?.trim();
  if (!npsso || !target) {
    log("PSN_NPSSO или PSN_TARGET_ONLINE_ID пусты. Проба НЕ выполнена. См. .env.example");
    return 2;
  }

  log("1. Авторизация");
  const code = await timed("NPSSO -> access code", log, () => exchangeNpssoForAccessCode(npsso));
  if (!code) return 1;
  const tokens = await timed("access code -> tokens", log, () => exchangeAccessCodeForAuthTokens(code));
  if (!tokens) return 1;
  const auth = { accessToken: tokens.accessToken };
  log(`  expiresIn(access)=${tokens.expiresIn}s, refreshExpiresIn=${tokens.refreshTokenExpiresIn}s`);

  log("2. Профиль цели");
  const prof = await timed("getProfileFromUserName", log, () => getProfileFromUserName(auth, target));
  const accountId = prof?.profile?.accountId;
  if (!accountId) {
    log("  accountId не получен (ник неверный или профиль недоступен)");
    return 1;
  }
  log(`  accountId получен (длина ${accountId.length}); ключи профиля: ${keysOf(prof?.profile).join(",")}`);

  log("3. Игры и часы: getUserPlayedGames (может быть недоступно для чужого аккаунта)");
  const all: Awaited<ReturnType<typeof getUserPlayedGames>>["titles"] = [];
  let offset = 0;
  let total = 0;
  let playedOk = false;
  for (;;) {
    const page = await timed(`played offset=${offset}`, log, () =>
      getUserPlayedGames(auth, accountId, { limit: 200, offset }),
    );
    if (!page) break;
    playedOk = true;
    total = page.totalItemCount;
    all.push(...page.titles);
    if (!page.titles.length || all.length >= total) break;
    offset = page.nextOffset > offset ? page.nextOffset : all.length;
    await sleep(300);
  }
  if (playedOk) {
    const withDur = all.filter((t) => t.playDuration);
    const withLast = all.filter((t) => t.lastPlayedDateTime);
    log(`  всего=${total}, получено=${all.length}, с playDuration=${withDur.length}, с lastPlayedDateTime=${withLast.length}`);
    const cats: Record<string, number> = {};
    for (const t of all) cats[t.category] = (cats[t.category] ?? 0) + 1;
    log(`  категории: ${JSON.stringify(cats)}`);
    const s = all[0];
    if (s) {
      log(`  ключи title: ${keysOf(s).join(",")}`);
      log(`  ключи concept: ${keysOf(s.concept).join(",")}`);
      log(`  ключи media: ${keysOf(s.media).join(",")}`);
      log(`  пример: ${s.name} | playDuration=${s.playDuration} | last=${s.lastPlayedDateTime} | first=${s.firstPlayedDateTime}`);
      const conceptAny = s.concept as unknown as Record<string, unknown>; // поля вне типов библиотеки
      for (const k of ["genres", "genre", "subGenres", "publisher", "releaseDate", "country", "language"]) {
        if (k in conceptAny) log(`  concept.${k} = ${JSON.stringify(conceptAny[k]).slice(0, 200)}`);
      }
    }
    const genreCount = all.filter((t) => {
      const c = t.concept as unknown as Record<string, unknown> | undefined;
      return c && Array.isArray(c.genres) && c.genres.length > 0;
    }).length;
    log(`  игр с concept.genres: ${genreCount}/${all.length}`);
  }

  if (playedOk) {
    // Распределение жанров (агрегаты, без секретов)
    const gc: Record<string, number> = {};
    let multi = 0;
    for (const t of all) {
      const g = (t.concept as unknown as { genres?: string[] } | undefined)?.genres;
      if (Array.isArray(g)) {
        if (g.length > 1) multi++;
        for (const x of g) gc[x] = (gc[x] ?? 0) + 1;
      }
    }
    const top = Object.entries(gc).sort((a, b) => b[1] - a[1]);
    log(`  жанров уникальных=${top.length}, игр с >1 жанром=${multi}`);
    log(`  распределение жанров: ${top.map(([k, v]) => `${k}:${v}`).join(", ")}`);
    const games = all.filter((t) => ["ps4_game", "ps5_native_game", "pspc_game"].includes(t.category));
    const gg = games.filter((t) => ((t.concept as unknown as { genres?: string[] })?.genres?.length ?? 0) > 0).length;
    log(`  только игры (${games.length}): с жанрами ${gg}`);
  }

  log("4. Трофейные тайтлы: getUserTitles");
  const tt = await timed("getUserTitles", log, () => getUserTitles(auth, accountId, { limit: 800 }));
  const titles = tt?.trophyTitles ?? [];
  if (tt) {
    log(`  всего=${tt.totalItemCount}, получено=${titles.length}`);
    if (titles[0]) log(`  ключи trophyTitle: ${keysOf(titles[0]).join(",")}`);
  }

  if (playedOk && tt) {
    log("4b. Сопоставление игра -> трофейный тайтл (getUserTrophiesForSpecificTitle по npTitleIds, пачки по 5)");
    const games = all.filter((t) => ["ps4_game", "ps5_native_game", "pspc_game"].includes(t.category));
    const known = new Set(titles.map((t) => t.npCommunicationId));
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const byName = new Map<string, number>();
    for (const t of titles) byName.set(norm(t.trophyTitleName), (byName.get(norm(t.trophyTitleName)) ?? 0) + 1);
    let viaId = 0, viaIdKnown = 0, noTrophySet = 0, reqErr = 0, byNameOnly = 0, multiSets = 0;
    const matched = new Set<string>();
    const hasSet = new Set<string>();
    const pending: typeof games = [];
    for (let i = 0; i < games.length; i += 5) {
      const chunk = games.slice(i, i + 5);
      const r = await timed(`titleIds chunk ${i / 5 + 1}`, () => undefined, () =>
        getUserTrophiesForSpecificTitle(auth, accountId, { npTitleIds: chunk.map((g) => g.titleId).join(",") }),
      );
      if (!r) { reqErr += chunk.length; await sleep(300); continue; }
      for (const g of chunk) {
        const e = r.titles.find((x) => x.npTitleId === g.titleId);
        const sets = e?.trophyTitles ?? [];
        if (sets.length) {
          viaId++;
          hasSet.add(g.titleId);
          if (sets.length > 1) multiSets++;
          if (sets.some((s) => known.has(s.npCommunicationId))) viaIdKnown++;
          for (const s of sets) matched.add(s.npCommunicationId);
        } else {
          noTrophySet++;
          if (byName.has(norm(g.name))) byNameOnly++;
          pending.push(g);
        }
      }
      await sleep(300);
    }
    log(`  игр=${games.length}: сопоставлено по titleId=${viaId} (из них найдено в getUserTitles=${viaIdKnown}), несколько сетов=${multiSets}`);
    log(`  без трофейного сета по titleId=${noTrophySet}, из них совпало бы по имени=${byNameOnly}, ошибок запроса=${reqErr}`);
    const cidOf = (g: (typeof games)[number]) => (g.concept as unknown as { id?: number } | undefined)?.id;
    const sibling = pending.filter((g) => games.some((o) => o !== g && hasSet.has(o.titleId) && cidOf(o) !== undefined && cidOf(o) === cidOf(g)));
    const rest = pending.filter((g) => !sibling.includes(g));
    log(`  из них есть сиблинг с тем же concept.id и сетом=${sibling.length}; остаток без сета=${rest.length}: ${rest.map((g) => g.name).join(" | ").slice(0, 700)}`);
    log(`  трофейных тайтлов в getUserTitles=${titles.length}, покрыто игровым сопоставлением=${[...matched].filter((m) => known.has(m)).length}, не покрыто (сиротские)=${titles.length - [...matched].filter((m) => known.has(m)).length}`);
  }

  log("5. Трофеи: earned_at по первым 10 тайтлам с прогрессом");
  const sample = titles.filter((t) => t.progress > 0).slice(0, 10);
  let gamesWithDates = 0;
  for (const t of sample) {
    const opts = { npServiceName: t.npServiceName };
    const earned = await timed(`earned ${t.trophyTitleName.slice(0, 30)}`, log, () =>
      getUserTrophiesEarnedForTitle(auth, accountId, t.npCommunicationId, "all", opts),
    );
    if (!earned) { await sleep(300); continue; }
    const got = earned.trophies.filter((x) => x.earned);
    const dated = got.filter((x) => x.earnedDateTime);
    if (dated.length) gamesWithDates++;
    const dates = dated.map((x) => x.earnedDateTime as string).sort();
    log(`    earned=${got.length}, с датой=${dated.length}, диапазон=${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"}`);
    await sleep(300);
  }
  log(`  игр с датами earned_at: ${gamesWithDates}/${sample.length} (приёмка Фазы 0: >= 10)`);

  if (sample[0]) {
    log("6. Метаданные трофеев (getTitleTrophies)");
    const def = await timed("getTitleTrophies", log, () =>
      getTitleTrophies(auth, sample[0].npCommunicationId, "all", { npServiceName: sample[0].npServiceName }),
    );
    if (def?.trophies[0]) log(`  ключи trophy: ${keysOf(def.trophies[0]).join(",")}`);
  }

  log("7. Грубая проверка rate limit: 30 быстрых запросов getUserTitles(limit=1)");
  let ok = 0, fail = 0, first429 = -1;
  for (let i = 0; i < 30; i++) {
    try {
      await getUserTitles(auth, accountId, { limit: 1 });
      ok++;
    } catch (e) {
      fail++;
      if (first429 < 0) { first429 = i; log(`  первая ошибка на запросе #${i + 1}: ${safeErr(e)}`); }
    }
  }
  log(`  ok=${ok}, fail=${fail}`);
  return 0;
}
