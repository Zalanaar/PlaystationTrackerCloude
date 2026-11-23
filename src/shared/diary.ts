// Дневник прохождения: датированные короткие заметки к игре.
import { NOTE_MAX, noteLength } from '@/shared/review';

export const DIARY_NOTE_MAX = NOTE_MAX;
export const DIARY_MAX_ENTRIES = 50;

export type DiaryEntry = { id: number; body: string; createdAt: string };

export function parseDiaryBody(body: unknown): { ok: true; text: string } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Ожидается объект.' };
  const raw = (body as { body?: unknown }).body;
  if (typeof raw !== 'string') return { ok: false, message: 'Нужно поле body.' };
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, message: 'Напиши заметку.' };
  if (noteLength(text) > DIARY_NOTE_MAX) return { ok: false, message: `Заметка длиннее ${DIARY_NOTE_MAX} символов.` };
  return { ok: true, text };
}
