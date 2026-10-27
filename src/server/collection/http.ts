// Общие проверки мутаций раздела 9: Origin, Content-Type, JSON.
import type { NextResponse } from 'next/server';
import { fail, originAllowed } from '@/server/http';

export async function readJsonBody(req: Request): Promise<{ body: unknown } | { error: NextResponse }> {
  if (!originAllowed(req)) return { error: fail(400, 'invalid_request', 'Некорректный запрос.') };
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return { error: fail(400, 'invalid_request', 'Некорректный запрос.') };
  }
  try {
    return { body: await req.json() };
  } catch {
    return { error: fail(400, 'invalid_request', 'Тело запроса не JSON.') };
  }
}
