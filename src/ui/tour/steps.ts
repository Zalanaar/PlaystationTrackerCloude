// Конфиг шагов тура: ровно таблица docs/design-system.md §10.6. Текст на русском, без «вот это» и «здесь».
export type TourRoute = '/' | '/triage' | '/backlog' | '/stats' | '*';
export type TourPlace = 'bottom' | 'top' | 'right' | 'left' | 'center';

export type TourStep = {
  /** Совпадает с data-tour якоря, где target не null */
  readonly id: string;
  readonly route: TourRoute;
  /** data-tour якоря на десктопе и планшете; null = шаг без подсветки */
  readonly target: string | null;
  /** data-tour якоря на мобильном (<768); null = без подсветки */
  readonly targetMobile: string | null;
  readonly place: TourPlace;
  readonly title: string;
  readonly text: string;
  readonly textMobile: string;
  /** Показывается только когда элемента нет, а он ожидался */
  readonly note: string | null;
  readonly noteMobile: string | null;
};

const s = (x: TourStep): TourStep => x;

export const TOUR_STEPS: readonly TourStep[] = [
  s({
    id: 'nav', route: '/', target: 'nav', targetMobile: 'nav', place: 'bottom', title: 'Добро пожаловать',
    text: 'Покажем главное за минуту. Коллекция, Бэклог (с Планом и «Подскажи»), Статистика (с Итогами года) и Разбор.',
    textMobile: 'Те же разделы в нижнем меню.', note: null, noteMobile: null,
  }),
  s({
    id: 'card', route: '/', target: 'game-card', targetMobile: 'game-card', place: 'right', title: 'Карточка игры',
    text: 'Обложка, фигура статуса и часы. У пройденных и брошенных игр есть дата, у игр с платиной значок. При наведении видны трофеи и последний запуск.',
    textMobile: 'Обложка, фигура статуса и часы. У пройденных и брошенных игр есть дата, у игр с платиной значок.',
    note: 'Игр пока нет. Они появятся в Коллекции после первой загрузки из PSN.', noteMobile: null,
  }),
  s({
    id: 'status', route: '/', target: 'card-status', targetMobile: 'game-card', place: 'left', title: 'Смена статуса',
    text: 'Нажмите на фигуру в углу карточки: △ играю, ○ пройдено, □ бэклог, ✕ брошено, ‖ отложено, ◇ сервис.',
    textMobile: 'Удерживайте карточку: откроется выбор статуса. △ играю, ○ пройдено, □ бэклог, ✕ брошено, ‖ отложено, ◇ сервис.',
    note: 'Когда в Коллекции появятся игры, статус меняется так же: через фигуру в углу карточки.', noteMobile: null,
  }),
  s({
    id: 'search', route: '/', target: 'search', targetMobile: 'search', place: 'bottom', title: 'Поиск',
    text: 'Ищет по названию. Клавиша «/» ставит курсор в поле.', textMobile: 'Ищет по названию игры.', note: null, noteMobile: null,
  }),
  s({
    id: 'filters', route: '/', target: 'filters', targetMobile: 'filters-btn', place: 'bottom', title: 'Фильтры',
    text: 'Чипы статусов с числом игр и чип «Платина». Ещё сортировка и вид: крупно, плотно, список.',
    textMobile: 'Кнопка «Фильтры»: сортировка и вид (крупно, плотно, список). Чипы статусов под блоком «Играю».',
    note: 'Фильтры появятся после первой загрузки игр.', noteMobile: null,
  }),
  s({
    id: 'window', route: '/', target: null, targetMobile: null, place: 'center', title: 'Окно игры',
    text: 'Нажмите на карточку: откроется окно с часами, запусками, датами и всеми трофеями с редкостью. Статус и дату завершения можно поправить в нём же.',
    textMobile: 'Нажмите на карточку: откроется окно с часами, запусками, датами и всеми трофеями с редкостью. Статус и дату завершения можно поправить в нём же.',
    note: null, noteMobile: null,
  }),
  s({
    id: 'triage', route: '/triage', target: 'triage-actions', targetMobile: 'triage-stack', place: 'bottom', title: 'Разбор',
    text: 'Новые игры из загрузки идут по одной. Клавиши 1–6 ставят статус, пробел пропускает.',
    textMobile: 'Свайп вправо: пройдено, влево: брошено, вверх: бэклог, вниз: пропустить. Кнопки статусов под карточкой.',
    note: 'Всё разобрано. Новые игры появятся после следующей загрузки.', noteMobile: null,
  }),
  s({
    // Сверено с BacklogView: у строки «≈ N ч» и метка источника («HLTB» или «вручную»), быстрые действия под карточкой.
    id: 'backlog', route: '/backlog', target: 'backlog-list', targetMobile: 'backlog-list', place: 'top', title: 'Бэклог',
    text: 'Игры со статусом «Бэклог». У каждой оценка времени на прохождение: с HowLongToBeat (метка HLTB) или заданная вручную. Под карточкой быстрые действия: начать играть, в сервис, убрать из бэклога.',
    textMobile: 'Игры со статусом «Бэклог». У каждой оценка времени на прохождение: с HowLongToBeat (метка HLTB) или заданная вручную. Под карточкой быстрые действия.',
    note: 'Бэклог пуст. Поставьте играм статус «Бэклог» в Коллекции или в Разборе.', noteMobile: null,
  }),
  s({
    id: 'backlog-tabs', route: '/backlog', target: 'backlog-subnav', targetMobile: 'backlog-subnav', place: 'bottom', title: 'План и «Подскажи»',
    text: 'План раскладывает бэклог по месяцам года и показывает, что не успеть. «Подскажи» советует, во что играть дальше: из бэклога по вашей истории или новинки.',
    textMobile: 'План раскладывает бэклог по месяцам года и показывает, что не успеть. «Подскажи» советует, во что играть дальше: из бэклога по вашей истории или новинки.',
    note: null, noteMobile: null,
  }),
  s({
    id: 'stats', route: '/stats', target: 'stats-period', targetMobile: 'stats-period', place: 'bottom', title: 'Статистика',
    text: 'Часы, пройденные и брошенные игры, жанры, трофеи. Период: месяц или год. Часы считаются с первой загрузки: раньше PSN их не хранил.',
    textMobile: 'Часы, пройденные и брошенные игры, жанры, трофеи. Период: месяц или год. Часы считаются с первой загрузки: раньше PSN их не хранил.',
    note: 'Данные появятся после первой загрузки игр.', noteMobile: null,
  }),
  s({
    id: 'wrapped', route: '/stats', target: 'stats-wrapped', targetMobile: 'stats-wrapped', place: 'bottom', title: 'Итоги года',
    text: 'Часы, игры и трофеи года историей из слайдов. Год можно выбрать.',
    textMobile: 'Часы, игры и трофеи года историей из слайдов. Год можно выбрать.',
    note: 'Итоги станут доступны, когда за год накопятся данные.', noteMobile: null,
  }),
  s({
    id: 'sync', route: '*', target: 'sync', targetMobile: 'menu-more', place: 'bottom', title: 'Загрузка из PSN',
    text: 'Игры, часы и трофеи обновляются сами раз в сутки. Точка показывает состояние: зелёная — свежо, жёлтая — давно не обновлялось, красная — ошибка. Нажмите, чтобы обновить сейчас.',
    textMobile: 'Игры, часы и трофеи обновляются сами раз в сутки. Состояние и кнопка «Синк с PSN» в меню «⋯».',
    note: null, noteMobile: null,
  }),
  s({
    id: 'theme', route: '*', target: 'theme', targetMobile: 'menu-more', place: 'bottom', title: 'Темы',
    text: 'Семь оформлений: Night, Graphite и PS1–PS5. Выбор запоминается.',
    textMobile: 'Тема выбирается в меню «⋯»: Night, Graphite и PS1–PS5.', note: null, noteMobile: null,
  }),
  s({
    id: 'done', route: '*', target: null, targetMobile: null, place: 'center', title: 'Готово',
    text: 'Тур всегда можно повторить: меню профиля, «Как пользоваться».',
    textMobile: 'Повторить тур можно в меню «⋯»: «Как пользоваться».', note: null, noteMobile: null,
  }),
];

export const TOUR_TOTAL = TOUR_STEPS.length;

/** data-tour-page, который сообщает о готовности страницы маршрута (design-system §10.7) */
export const ROUTE_PAGE: Record<Exclude<TourRoute, '*'>, string> = { '/': 'collection', '/triage': 'triage', '/backlog': 'backlog', '/stats': 'stats' };
/** Родительный падеж не нужен: «Открываем раздел «Разбор»…» */
export const ROUTE_LABEL: Record<Exclude<TourRoute, '*'>, string> = { '/': 'Коллекция', '/triage': 'Разбор', '/backlog': 'Бэклог', '/stats': 'Статистика' };
