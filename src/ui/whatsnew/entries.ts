// Записи «Что нового» (docs/design/spec-phase-28-inbox.md, B.4). id растёт, новые записи добавляются сверху.
// Следующая фаза: одна правка здесь (новый id больше максимального). Тест entries.test.ts следит за ростом id и длинами.
export type WhatsNewEntry = {
  readonly id: number;
  /** Дата релиза, дд.мм.гггг */
  readonly date: string;
  /** До 32 символов */
  readonly title: string;
  /** До 120 символов */
  readonly text: string;
  readonly action?: { readonly label: string; readonly href: string };
  readonly audience: 'all' | 'owner';
  /** Попадает в первый запуск (когда ключа нет) */
  readonly highlight: boolean;
};

export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  { id: 12, date: '01.11.2026', title: 'С прошлого визита', text: 'Над «Играю» видно новое: игры, трофеи, часы за неделю и подсказки по статусам.', audience: 'all', highlight: true },
  { id: 11, date: '31.10.2026', title: 'История игры', text: 'В окне игры график часов по неделям и отметки трофеев: когда играл и когда получал платину.', audience: 'all', highlight: true },
  { id: 10, date: '30.10.2026', title: 'Бэклог на телефоне', text: 'Компактный список с оценкой «осталось», кнопкой «Играть» и меню «…». Фильтры в одной кнопке.', action: { label: 'Открыть', href: '/backlog' }, audience: 'all', highlight: false },
  { id: 9, date: '29.10.2026', title: '«У тебя нет»', text: 'Высоко оценённые игры PlayStation, которых нет в библиотеке. Можно добавить в План или скрыть.', action: { label: 'Открыть', href: '/recommend?tab=discover' }, audience: 'all', highlight: true },
  { id: 8, date: '28.10.2026', title: 'Подбор из каталога', text: 'Кандидаты выбираются по твоим жанрам и часам, без игр из библиотеки. Список обновляется раз в сутки.', audience: 'all', highlight: false },
  { id: 7, date: '27.10.2026', title: 'Подсказки статусов', text: 'Сайт предлагает сменить статус: «Играю?», «Пройдено?», «Отложить?». Меняется только после твоего выбора.', action: { label: 'Проверить', href: '/triage?mode=check' }, audience: 'all', highlight: true },
  { id: 6, date: '26.10.2026', title: 'Итоги за всё время', text: 'В Итогах выбор «Всё время», слайд «Когда ты играешь» (по времени трофеев) есть и в Статистике.', action: { label: 'Открыть', href: '/stats' }, audience: 'all', highlight: false },
  { id: 5, date: '25.10.2026', title: 'Статистика за всё время', text: 'Период «Всё время»: часы по годам, пройденные и брошенные, трофеи, жанры, топ игр.', action: { label: 'Открыть', href: '/stats' }, audience: 'all', highlight: false },
  { id: 4, date: '24.10.2026', title: 'NPSSO с сайта', text: 'Токен PSN можно вставить в панели синка, без Vercel и передеплоя.', audience: 'owner', highlight: false },
  { id: 3, date: '23.10.2026', title: 'Дубли игр', text: 'Версии PS4 и PS5 одной игры склеены в одну карточку, часы суммируются. «Это не дубль» отменяет.', audience: 'all', highlight: false },
  { id: 2, date: '22.10.2026', title: 'Отложено в Бэклоге', text: 'Игры со статусом «Отложено» вынесены в отдельный блок с действиями «Вернуть» и «Начать играть».', action: { label: 'Открыть', href: '/backlog' }, audience: 'all', highlight: false },
  { id: 1, date: '22.10.2026', title: 'Блок «Сейчас»', text: 'Все игры в статусе «Играю» собраны первым блоком Коллекции.', audience: 'all', highlight: false },
] as const;
