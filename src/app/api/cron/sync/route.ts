import { getCronSecret } from '@/server/env';
import { fail, ok } from '@/server/http';
import { checkBearer } from '@/server/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Заглушка Фазы 1: только защита. Логика синка появится в плане синка.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) {
    return fail(401, 'unauthorized', 'Не авторизован.');
  }
  return ok({});
}
