import { describe, expect, it } from 'vitest';
import { addItemsFor, headerActionsFor, localSearchOn } from './headerActions';

describe('headerActionsFor', () => {
  it('поиск на Коллекции и Бэклоге; «+» (меню) на Коллекции, Бэклоге и Плане', () => {
    expect(headerActionsFor('/')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/backlog')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/backlog/')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/roadmap')).toEqual({ search: true, add: true });
    expect(headerActionsFor('/stats')).toEqual({ search: true, add: false });
  });

  it('Идея 2: поиск из любого раздела; свой поиск — только у Коллекции и Бэклога', () => {
    for (const p of ['/trophies', '/recommend', '/wrapped', '/triage', '/stats/']) expect(headerActionsFor(p).search).toBe(true);
    for (const p of ['/settings', '/access', '/health', '/profiles']) expect(headerActionsFor(p).search).toBe(false);
    expect(localSearchOn('/')).toBe(true);
    expect(localSearchOn('/backlog/')).toBe(true);
    expect(localSearchOn('/stats')).toBe(false);
  });
});

describe('П9: пункты меню «+»', () => {
  it('первым — своё для страницы, оно шлёт событие; остальные ведут на страницу с параметром', () => {
    expect(addItemsFor('/').map((i) => [i.id, i.action, i.href])).toEqual([
      ['other', 'add-other', '/?add=other'], ['store', null, '/backlog?add=store'], ['release', null, '/roadmap?add=release'],
    ]);
    expect(addItemsFor('/backlog/').map((i) => [i.id, i.action])).toEqual([['store', 'add'], ['other', null], ['release', null]]);
    expect(addItemsFor('/roadmap').map((i) => [i.id, i.action])).toEqual([['release', 'add-release'], ['store', null], ['other', null]]);
    expect(addItemsFor('/stats').every((i) => i.action === null)).toBe(true);
    expect(addItemsFor('/').map((i) => i.label)).toEqual(['Другая платформа', 'Не куплено (PS)', 'Релиз в План']);
  });
});
