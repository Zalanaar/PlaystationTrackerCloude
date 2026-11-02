// Подсказка hero «Играю» для первого рендера коллекции (Фаза 48, CLS первого визита).
// Ставится вместе с cookie сессии при входе и смене профиля: без неё скелет hero рисовался и исчезал (сдвиг ~330 px).
import type { NextResponse } from 'next/server';
import { HERO_HINT_COOKIE, heroHintCookieOptions } from '@/shared/hero-hint';
import { asUserId } from './user-id';

/** Best effort: ошибка БД не ломает вход, просто остаётся прежнее поведение (клиент поставит cookie после сводки). */
export async function setHeroHintCookie(res: NextResponse, req: Request, userId: number): Promise<void> {
  try {
    // ленивый импорт: модуль запросов коллекции не грузится в холодный старт роутов входа
    const [{ getDb }, { countPlaying }] = await Promise.all([import('@/db'), import('@/server/collection/query')]);
    const n = await countPlaying(getDb(), asUserId(userId));
    const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(':')[0];
    res.cookies.set(HERO_HINT_COOKIE, n > 0 ? '1' : '0', heroHintCookieOptions(host !== 'localhost' && host !== '127.0.0.1'));
  } catch {
    /* подсказка необязательна */
  }
}
