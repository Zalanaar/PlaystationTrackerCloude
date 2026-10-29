// Чистый матчер «Новое от ИИ» (контракт 19.4): нормализация, порог 0.9, год, платформа, разбор ответа модели.
import { describe, expect, it } from 'vitest';
import { normalizeTitle, parseProposals, pickMatch, similarity, titleMatches, yearMatches } from './match';

describe('normalizeTitle', () => {
  it('регистр, знаки, ™®, апострофы, ё, диакритика, артикль', () => {
    expect(normalizeTitle('The Witcher® 3: Wild Hunt')).toBe('witcher 3 wild hunt');
    expect(normalizeTitle("Marvel’s Spider-Man")).toBe('marvels spider man');
    expect(normalizeTitle('Pokémon')).toBe('pokemon');
    expect(normalizeTitle('Ёж')).toBe('еж');
    expect(normalizeTitle('A Plague Tale')).toBe('plague tale');
  });
  it('римские и арабские цифры не приравниваются', () => {
    expect(normalizeTitle('Hades II')).not.toBe(normalizeTitle('Hades 2'));
  });
});

describe('titleMatches', () => {
  it('равные после нормализации', () => {
    expect(titleMatches('The Witcher 3: Wild Hunt', 'Witcher 3 - Wild Hunt™')).toBe(true);
  });
  it('сходство >= 0.9', () => {
    expect(similarity('Horizon Forbidden West', 'Horizon Forbiden West')).toBeGreaterThanOrEqual(0.9);
    expect(titleMatches('Horizon Forbidden West', 'Horizon Forbiden West')).toBe(true);
  });
  it('ниже порога и разные игры', () => {
    expect(titleMatches('Hades', 'Hades II')).toBe(false);
    expect(titleMatches('Dark Souls', 'Bloodborne')).toBe(false);
    expect(titleMatches('', '')).toBe(false);
  });
  it('разные номера частей не склеиваются, хоть строки и похожи', () => {
    expect(similarity('Resident Evil 2', 'Resident Evil 3')).toBeGreaterThanOrEqual(0.9);
    expect(titleMatches('Resident Evil 2', 'Resident Evil 3')).toBe(false);
    expect(titleMatches('Final Fantasy VII', 'Final Fantasy VIII')).toBe(false);
  });
});

describe('yearMatches', () => {
  it('допуск 1 год, неизвестное пропускается', () => {
    expect(yearMatches(2015, '2015-05-18')).toBe(true);
    expect(yearMatches(2014, '2015-05-18')).toBe(true);
    expect(yearMatches(2013, '2015-05-18')).toBe(false);
    expect(yearMatches(2017, '2015-05-18')).toBe(false);
    expect(yearMatches(null, '2015-05-18')).toBe(true);
    expect(yearMatches(2015, null)).toBe(true);
  });
});

describe('pickMatch', () => {
  const r = (title: string, releaseDate: string | null, playstation = true) => ({ title, releaseDate, playstation });
  it('первый подходящий; выдуманное название = null', () => {
    const found = [r('Totally Other Game', '2020-01-01'), r('Hades', '2020-09-17')];
    expect(pickMatch({ title: 'Hades', year: 2020 }, found)).toBe(found[1]);
    expect(pickMatch({ title: 'Невероятная Игра Номер Один', year: 2021 }, found)).toBeNull();
  });
  it('не PlayStation отбрасывается', () => {
    expect(pickMatch({ title: 'Hades', year: null }, [r('Hades', '2020-09-17', false)])).toBeNull();
  });
  it('неверный год отбрасывается, следующий подходящий берётся', () => {
    const found = [r('Hades', '2005-01-01'), r('Hades', '2020-09-17')];
    expect(pickMatch({ title: 'Hades', year: 2020 }, found)).toBe(found[1]);
    expect(pickMatch({ title: 'Hades', year: 2020 }, [found[0]])).toBeNull();
  });
});

describe('parseProposals', () => {
  const g = (o: Record<string, unknown>) => ({ title: 'Hades', year: 2020, reason: 'Подойдёт.', ...o });
  const raw = (games: unknown[]) => JSON.stringify({ games });
  it('валидный ответ и обрезка по 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => g({ title: `Game number ${i}` }));
    expect(parseProposals(raw(many))).toHaveLength(12);
    expect(parseProposals(raw([g({})]))).toEqual([{ title: 'Hades', year: 2020, reason: 'Подойдёт.' }]);
  });
  it('reason: 120 символов проходит, 121 нет (контракт 20.6)', () => {
    expect(parseProposals(raw([g({ reason: 'я'.repeat(120) })]))).toHaveLength(1);
    expect(parseProposals(raw([g({ reason: 'я'.repeat(121) })]))).toEqual([]);
  });
  it('markdown-обёртка допустима, мусор = null', () => {
    expect(parseProposals('```json\n' + raw([g({})]) + '\n```')).toHaveLength(1);
    expect(parseProposals('не json')).toBeNull();
    expect(parseProposals('{"items":[]}')).toBeNull();
  });
  it('отбрасывает: ссылки, длину, дубли, не-объекты; год вне диапазона = null', () => {
    const out = parseProposals(
      raw([
        g({ title: 'Ok One' }),
        g({ title: 'Visit evil.com' }),
        g({ title: 'Linked', reason: 'Смотри https://x.y' }),
        g({ title: 'Linked2', reason: 'bit.ly/abc' }),
        g({ title: 'T'.repeat(121) }),
        g({ title: 'Long reason', reason: 'я'.repeat(121) }),
        g({ title: '  ' }),
        g({ title: 'ok one' }),
        g({ title: 'Bad Year', year: 1850 }),
        g({ title: 'Float Year', year: 2020.5 }),
        'строка',
        null,
      ]),
    )!;
    expect(out.map((x) => x.title)).toEqual(['Ok One', 'Bad Year', 'Float Year']);
    expect(out[1].year).toBeNull();
    expect(out[2].year).toBeNull();
  });
});
