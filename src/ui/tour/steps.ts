// Конфиг шагов тура: синк → Разбор → Играю → Пройдено → оценка → итоги. Текст на «ты», без «вот это» и «здесь».
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
    id: 'sync', route: '/', target: 'sync', targetMobile: 'menu-more', place: 'bottom', title: 'Загрузка из PSN',
    text: 'Покажем главное за минуту. Игры, часы и трофеи обновляются сами раз в сутки. Точка показывает состояние: зелёная — свежо, жёлтая — давно не обновлялось, красная — ошибка. Нажми, чтобы обновить сейчас; пока идёт загрузка, её можно остановить или перезапустить.',
    textMobile: 'Покажем главное за минуту. Игры, часы и трофеи обновляются сами раз в сутки. Состояние и кнопка «Синк с PSN» в меню «⋯»; идущую загрузку можно остановить или перезапустить.',
    note: null, noteMobile: null,
  }),
  s({
    id: 'triage', route: '/triage', target: 'triage-actions', targetMobile: 'triage-buttons', place: 'bottom', title: 'Разбор',
    text: 'Новые игры из загрузки идут по одной. Клавиши 1–6 ставят статус, пробел пропускает.',
    textMobile: 'Свайп вправо: пройдено, влево: брошено, вверх: бэклог, вниз: пропустить. Кнопки статусов под карточкой.',
    note: 'Всё разобрано. Новые игры появятся после следующей загрузки.', noteMobile: null,
  }),
  s({
    id: 'playing', route: '/', target: 'card-status', targetMobile: 'game-card', place: 'left', title: 'Играю',
    text: 'Нажми на фигуру в углу карточки и поставь △ играю. Так отмечаешь, во что играешь сейчас.',
    textMobile: 'Удерживай карточку: откроется выбор статуса. Поставь △ играю, чтобы отметить, во что играешь сейчас.',
    note: 'Игр пока нет. Они появятся в Коллекции после первой загрузки из PSN.', noteMobile: null,
  }),
  s({
    id: 'completed', route: '/', target: 'card-status', targetMobile: 'game-card', place: 'left', title: 'Пройдено',
    text: 'Когда пройдёшь игру, поставь ○ пройдено. Дату завершения можно поправить в окне игры.',
    textMobile: 'Когда пройдёшь игру, поставь ○ пройдено: удерживай карточку и выбери статус. Дату завершения можно поправить в окне игры.',
    note: 'Когда в Коллекции появятся игры, «Пройдено» ставится так же: через фигуру в углу карточки.', noteMobile: null,
  }),
  s({
    id: 'rating', route: '/', target: null, targetMobile: null, place: 'center', title: 'Оценка',
    text: 'После «Пройдено» откроется лист: поставь оценку, пока свежо. Оценку можно поставить и в окне игры — она попадает в «Итоги года».',
    textMobile: 'После «Пройдено» откроется лист: поставь оценку, пока свежо. Оценку можно поставить и в окне игры — она попадает в «Итоги года».',
    note: null, noteMobile: null,
  }),
  s({
    id: 'wrapped', route: '/stats', target: 'stats-wrapped', targetMobile: 'stats-wrapped', place: 'bottom', title: 'Итоги',
    text: '«Итоги года» — часы, игры и трофеи историей из слайдов. Год можно выбрать. На главной в начале месяца — карточка, как прошёл прошлый месяц, и цели на новый.',
    textMobile: '«Итоги года» — часы, игры и трофеи историей из слайдов. Год можно выбрать. На главной в начале месяца — карточка, как прошёл прошлый месяц, и цели на новый.',
    note: 'Итоги станут доступны, когда за год накопятся данные.', noteMobile: null,
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
