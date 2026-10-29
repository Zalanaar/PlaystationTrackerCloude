import { describe, expect, it } from 'vitest';
import { barPercent, candidatesText, genresLine, hoursText, llmNote, parseTime, recommendHref, scoreText, signedContribution, updatedText } from './model';

describe('recommend model', () => {
  it('parseTime: неизвестное = any', () => {
    expect(parseTime('short')).toBe('short');
    expect(parseTime('x')).toBe('any');
    expect(parseTime(null)).toBe('any');
  });
  it('recommendHref: any не пишется', () => {
    expect(recommendHref('any')).toBe('/recommend');
    expect(recommendHref('long')).toBe('/recommend?time=long');
  });
  it('candidatesText: склонение', () => {
    expect(candidatesText(1)).toBe('Из 1 игры бэклога по твоей истории');
    expect(candidatesText(2)).toBe('Из 2 игр бэклога по твоей истории');
    expect(candidatesText(11)).toBe('Из 11 игр бэклога по твоей истории');
    expect(candidatesText(21)).toBe('Из 21 игры бэклога по твоей истории');
    expect(candidatesText(37)).toBe('Из 37 игр бэклога по твоей истории');
  });
  it('hoursText', () => {
    expect(hoursText(22.5)).toBe('≈ 22 ч 30 м');
    expect(hoursText(8)).toBe('≈ 8 ч');
    expect(hoursText(null)).toBeNull();
    expect(hoursText(0)).toBeNull();
  });
  it('genresLine: до 3 и «+N»', () => {
    expect(genresLine([])).toBeNull();
    expect(genresLine(['ACTION', 'ADVENTURE'])).toBe('Экшен · Приключения');
    expect(genresLine(['ACTION', 'ADVENTURE', 'HORROR', 'RACING', 'PUZZLE'])).toBe('Экшен · Приключения · Хоррор · +2');
    expect(genresLine(['WEIRD'])).toBe('Другое');
  });
  it('signedContribution: знак U+2212 и запятая', () => {
    expect(signedContribution(2.44)).toBe('+2,4');
    expect(signedContribution(-1)).toBe('−1,0');
    expect(signedContribution(0)).toBe('0');
    expect(signedContribution(-0.04)).toBe('0');
  });
  it('scoreText', () => {
    expect(scoreText(4.7)).toBe('4,7');
    expect(scoreText(-0.5)).toBe('−0,5');
  });
  it('barPercent', () => {
    expect(barPercent(0, 2)).toBe(0);
    expect(barPercent(2, 2)).toBe(100);
    expect(barPercent(-1, 2)).toBe(50);
    expect(barPercent(0.01, 2)).toBe(4);
    expect(barPercent(1, 0)).toBe(0);
  });
  it('llmNote', () => {
    expect(llmNote('ok')).toBeNull();
    expect(llmNote('disabled')).toBeNull();
    expect(llmNote('limit')).toContain('лимит');
    expect(llmNote('error')).toContain('временно');
  });
  it('updatedText', () => expect(updatedText(3)).toBe('Подсказки обновлены: 3 игры'));
});
