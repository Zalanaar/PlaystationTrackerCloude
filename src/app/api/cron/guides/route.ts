import { after, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getCronSecret } from '@/server/env';
import { checkBearer } from '@/server/auth/password';
import { fail } from '@/server/http';
import { refreshGuideIndex } from '@/server/guides/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// F2-B: обновление индекса гайдов PowerPyx (контракт F2-B). Вызывается из watchdog отдельной функцией:
// не занимает слот синка PSN и не тратит время его звеньев. Ответ сразу, работа после ответа:
// один GET с тайм-аутом 10 с, при челлендже/сбое снимок не трогаем. Только прод: превью и тесты наружу не ходят.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ ok: true, data: { started: false, reason: 'not_production' } }, { headers: { 'Cache-Control': 'no-store' } });
  after(async () => {
    try {
      const o = await refreshGuideIndex(getDb());
      if (o !== 'skipped_fresh' && o !== 'skipped_recent_attempt') console.info(`cron: guide index ${o}`);
    } catch {
      console.error('cron: guide index failed');
    }
  });
  return NextResponse.json({ ok: true, data: { started: true } }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
