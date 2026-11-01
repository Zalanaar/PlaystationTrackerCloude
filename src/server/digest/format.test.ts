// Текст сводки на фикстурах спеки docs/design/spec-phase-29-digest.md (раздел 6) и граничных случаях.
import { describe, expect, it } from 'vitest';
import { ADVICE_REASON_MAX, clipReason, dayRangeLabel, DIGEST_HARD_LIMIT, formatDigest, formatDuration, gamesWord, hintsWord, platinumsWord, trophiesWord, weekLabel, type DigestData } from './format';

const O = 'https://ps.example.app';
const H = 3600;

const rich: DigestData = {
  weekFrom: '2026-10-19',
  weekTo: '2026-10-25',
  hours: { weekSeconds: 12.5 * H, prevWeekSeconds: 9.5 * H, noHistory: false },
  trophies: { total: 14, platinums: 1, platinumGames: [{ gameId: 412, title: 'Hades II' }] },
  plan: {
    state: 'behind',
    diffSeconds: 2.5 * H,
    next: [
      { gameId: 87, title: 'Control', days: 'пн–ср' },
      { gameId: 203, title: 'Sifu', days: 'чт–вс' },
    ],
  },
  advice: { gameId: 330, title: 'Tunic', reason: 'Короткая и загадочная, подходит после длинных игр: у тебя больше трёх RPG подряд.' },
  statuses: 5,
};
const empty: DigestData = { weekFrom: '2026-10-19', weekTo: '2026-10-25', hours: null, trophies: null, plan: null, advice: null, statuses: null };

describe('formatDigest: фикстуры спеки', () => {
  it('6.1 богатая неделя (строки совпадают, < 1500 символов)', () => {
    const text = formatDigest(rich, { origin: O });
    expect(text.split('\n')).toEqual([
      'PS Tracker: итоги недели, 19–25 окт',
      '',
      'Часы',
      'Сыграно 12 ч 30 м за неделю, на 3 ч больше прошлой.',
      '',
      'Трофеи',
      '+14 трофеев, платин: 1.',
      'Платина: Hades II',
      'https://ps.example.app/?game=412',
      '',
      'План',
      'Отстаёшь от графика на 2 ч 30 м.',
      'На следующую неделю:',
      '- Control, пн–ср',
      'https://ps.example.app/?game=87',
      '- Sifu, чт–вс',
      'https://ps.example.app/?game=203',
      '',
      'Совет',
      'Tunic',
      'Короткая и загадочная, подходит после длинных игр: у тебя больше трёх RPG подряд.',
      'https://ps.example.app/?game=330',
      '',
      'Статусы',
      'Подсказок по статусам: 5. Разобрать: https://ps.example.app/triage?mode=check',
      '',
      'Открыть: https://ps.example.app/',
    ]);
    expect(text.length).toBeLessThan(1500);
  });

  it('6.2 пустая неделя', () => {
    expect(formatDigest(empty, { origin: O })).toBe('PS Tracker: за неделю 19–25 окт игр и трофеев не было. Хорошей недели.\nОткрыть: https://ps.example.app/');
  });

  it('6.3 нет Плана и совета, нет истории за прошлую неделю', () => {
    const d: DigestData = { ...empty, weekFrom: '2026-10-26', weekTo: '2026-11-01', hours: { weekSeconds: 4 * H + 600, prevWeekSeconds: null, noHistory: false }, trophies: { total: 3, platinums: 0, platinumGames: [] }, statuses: 2 };
    expect(formatDigest(d, { origin: O }).split('\n')).toEqual([
      'PS Tracker: итоги недели, 26 окт–1 ноя',
      '',
      'Часы',
      'Сыграно 4 ч 10 м за неделю. Для сравнения нет данных за прошлую неделю.',
      '',
      'Трофеи',
      '+3 трофея.',
      '',
      'Статусы',
      'Подсказок по статусам: 2. Разобрать: https://ps.example.app/triage?mode=check',
      '',
      'Открыть: https://ps.example.app/',
    ]);
  });

  it('без origin нет ни одной ссылки, остальной текст прежний', () => {
    const text = formatDigest(rich, { origin: null });
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('Открыть:');
    expect(text).toContain('Платина: Hades II');
    expect(text).toContain('- Control, пн–ср');
    expect(text).toContain('Подсказок по статусам: 5.');
    expect(formatDigest(empty, { origin: null })).toBe('PS Tracker: за неделю 19–25 окт игр и трофеев не было. Хорошей недели.');
  });

  it('пусты часы и трофеи, но есть другие блоки: строка «За неделю игр и трофеев не было.»', () => {
    const text = formatDigest({ ...empty, statuses: 2 }, { origin: O });
    expect(text.split('\n').slice(0, 3)).toEqual(['PS Tracker: итоги недели, 19–25 окт', '', 'За неделю игр и трофеев не было.']);
    expect(text).not.toContain('Часы');
  });

  it('нет Плана и совета, но есть остальное: блоки пропущены целиком вместе с заголовками', () => {
    const text = formatDigest({ ...rich, plan: null, advice: null }, { origin: O });
    expect(text).not.toContain('План');
    expect(text).not.toContain('Совет');
    expect(text).toContain('Статусы');
  });
});

describe('formatDigest: часы', () => {
  const h = (weekSeconds: number | null, prevWeekSeconds: number | null, noHistory = false) => formatDigest({ ...empty, hours: { weekSeconds, prevWeekSeconds, noHistory }, statuses: 1 }, { origin: null });

  it('меньше прошлой', () => expect(h(2 * H, 5 * H)).toContain('Сыграно 2 ч за неделю, на 3 ч меньше прошлой.'));
  it('разница меньше 15 минут: как на прошлой', () => expect(h(2 * H, 2 * H + 14 * 60)).toContain('Сыграно 2 ч за неделю, как на прошлой.'));
  it('ровно 15 минут уже разница', () => expect(h(2 * H + 15 * 60, 2 * H)).toContain('на 15 м больше прошлой.'));
  it('часов нет, на прошлой были', () => expect(h(0, 3 * H + 1800)).toContain('За неделю часов нет, на прошлой было 3 ч 30 м.'));
  it('оба 0: блок пропущен', () => expect(h(0, 0)).not.toContain('Часы'));
  it('нет данных (null) не равно 0: блок пропущен', () => {
    expect(h(null, null, true)).not.toContain('Часы');
    expect(h(null, 5 * H)).not.toContain('Часы');
    expect(h(0, null)).not.toContain('Часы');
  });
  it('нет истории вообще при часах недели: фраза про первый синк', () => expect(h(3600, null, true)).toContain('история часов начинается с первого синка'));
});

describe('вспомогательное', () => {
  it('склонения 1/2/5/11/21', () => {
    expect([1, 2, 5, 11, 21].map(gamesWord)).toEqual(['игра', 'игры', 'игр', 'игр', 'игра']);
    expect([1, 2, 5, 11, 21].map(trophiesWord)).toEqual(['трофей', 'трофея', 'трофеев', 'трофеев', 'трофей']);
    expect([1, 2, 5, 11, 21].map(platinumsWord)).toEqual(['платина', 'платины', 'платин', 'платин', 'платина']);
    expect([1, 2, 5, 11, 21].map(hintsWord)).toEqual(['подсказка', 'подсказки', 'подсказок', 'подсказок', 'подсказка']);
  });
  it('длительность', () => {
    expect([0, 29, 40 * 60, 3600, 3600 + 30 * 60, 12 * 3600 + 1800].map(formatDuration)).toEqual(['0 ч', '0 ч', '40 м', '1 ч', '1 ч 30 м', '12 ч 30 м']);
  });
  it('подпись недели: один месяц и через границу месяца и года', () => {
    expect(weekLabel('2026-10-19', '2026-10-25')).toBe('19–25 окт');
    expect(weekLabel('2026-10-26', '2026-11-01')).toBe('26 окт–1 ноя');
    expect(weekLabel('2026-12-28', '2027-01-03')).toBe('28 дек–3 янв');
    expect(weekLabel('2026-05-25', '2026-05-31')).toBe('25–31 мая');
  });
  it('срок внутри недели', () => {
    expect(dayRangeLabel('2026-11-02', '2026-11-04')).toBe('пн–ср');
    expect(dayRangeLabel('2026-11-05', '2026-11-05')).toBe('чт');
    expect(dayRangeLabel('2026-11-05', '2026-11-08')).toBe('чт–вс');
  });
  it('причина обрезается до 160 символов с «…»', () => {
    const c = clipReason('а'.repeat(300));
    expect(c.length).toBe(ADVICE_REASON_MAX);
    expect(c.endsWith('…')).toBe(true);
    expect(clipReason('  коротко   и   ясно ')).toBe('коротко и ясно');
  });
  it('предел 3500: 20 платин и 10 игр Плана не превышают, платин в тексте не больше 3', () => {
    const d: DigestData = {
      ...rich,
      trophies: { total: 300, platinums: 20, platinumGames: Array.from({ length: 20 }, (_, i) => ({ gameId: i + 1, title: `Очень длинное название игры номер ${i}`.repeat(3) })) },
      plan: { state: 'ahead', diffSeconds: 7200, next: Array.from({ length: 10 }, (_, i) => ({ gameId: i + 1, title: 'Длинное название '.repeat(10), days: 'пн–вс' })) },
      advice: { gameId: 5, title: 'X'.repeat(200), reason: 'причина '.repeat(100) },
    };
    const text = formatDigest(d, { origin: O });
    expect(text.length).toBeLessThanOrEqual(DIGEST_HARD_LIMIT);
    expect(text.match(/^Платина:/gm)).toHaveLength(3);
    expect(text.match(/^- /gm)).toHaveLength(3);
  });
  it('жёсткий предел: целые блоки с конца отбрасываются', () => {
    const d: DigestData = { ...rich, trophies: { total: 1, platinums: 1, platinumGames: [{ gameId: 1, title: 'Я'.repeat(1500) }, { gameId: 2, title: 'Я'.repeat(1500) }, { gameId: 3, title: 'Я'.repeat(1500) }] } };
    const text = formatDigest(d, { origin: O });
    expect(text.length).toBeLessThanOrEqual(DIGEST_HARD_LIMIT);
    expect(text.startsWith('PS Tracker: итоги недели')).toBe(true);
  });
});
