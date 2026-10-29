import { getDb } from '@/db';
import { MAX_BODY_CHARS, parseBackup } from '@/server/backup/format';
import { applyRestore, previewRestore } from '@/server/backup/restore';
import { fail, ok, originAllowed } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bad = (reason: string, extra: Record<string, unknown> = {}) => fail(400, 'invalid_request', 'Файл копии не подходит.', { reason, ...extra });

// Восстановление разметки из файла: preview (что изменится) и apply. Сессию проверяет src/proxy.ts. Контракт 20.3.
export async function POST(req: Request) {
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const len = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > MAX_BODY_CHARS * 2) return bad('too_large');
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS) return bad('too_large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad('invalid_json');
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const mode = b?.mode;
  if (!b || (mode !== 'preview' && mode !== 'apply')) return bad('invalid_format', { path: 'mode' });
  const parsed = parseBackup(b.backup);
  if (!parsed.ok) {
    const f = parsed.failure;
    return bad(f.reason, {
      ...(f.path ? { path: f.path } : {}),
      ...(f.reason === 'unsupported_version' ? { supported: [1], got: f.got } : {}),
    });
  }
  try {
    const db = getDb();
    const data = mode === 'preview' ? await previewRestore(db, parsed.value) : await applyRestore(db, parsed.value);
    return ok({ mode, schemaVersion: parsed.value.schemaVersion, fileCreatedAt: parsed.value.createdAt, ...data });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
