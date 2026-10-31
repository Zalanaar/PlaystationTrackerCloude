import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkedVersionsView } from './dialog/LinkedVersions';
import { linkedHoursText, linkedVersionsOf } from './linked';

const noop = () => {};
const v = [
  { gameId: 2, title: 'Starfield', platform: 'PS4', hours: 12.4 },
  { gameId: 3, title: 'Starfield', platform: 'PS5', hours: 0 },
];
const view = (o: Partial<Parameters<typeof LinkedVersionsView>[0]> = {}) =>
  renderToStaticMarkup(<LinkedVersionsView versions={v} confirming={false} busy={false} err={null} onAsk={noop} onCancel={noop} onConfirm={noop} {...o} />);

describe('linkedVersionsOf', () => {
  it('пусто без поля, null и не-массива', () => {
    expect(linkedVersionsOf(null)).toEqual([]);
    expect(linkedVersionsOf({ id: 1 })).toEqual([]);
    expect(linkedVersionsOf({ id: 1, linkedVersions: null } as never)).toEqual([]);
  });
  it('отдаёт версии как есть', () => {
    expect(linkedVersionsOf({ id: 1, linkedVersions: v } as never)).toEqual(v);
  });
  it('часы: меньше получаса = «нет часов»', () => {
    expect(linkedHoursText(0)).toBe('нет часов');
    expect(linkedHoursText(12.4)).toBe('12 ч');
  });
});

describe('LinkedVersionsView', () => {
  it('нет версий: ничего не рисует', () => {
    expect(view({ versions: [] })).toBe('');
  });
  it('список с платформой и часами, кнопка «Это не дубль»', () => {
    const html = view();
    expect(html).toContain('Связанные версии');
    expect(html).toContain('PS4');
    expect(html).toContain('PS5');
    expect(html).toContain('12 ч');
    expect(html).toContain('Это не дубль');
    expect(html).not.toContain('Да, разделить');
  });
  it('подтверждение: вопрос и кнопки', () => {
    const html = view({ confirming: true });
    expect(html).toContain('Да, разделить');
    expect(html).toContain('Отмена');
    expect(html).not.toContain('>Это не дубль<');
  });
  it('ошибка в role=alert, busy блокирует кнопки', () => {
    const html = view({ confirming: true, busy: true, err: 'Не удалось разделить.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('disabled');
  });
});
