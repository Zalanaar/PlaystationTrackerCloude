// Разбор апдейта Telegram и ответы бота (контракт F29.6, тексты: spec-phase-29-digest.md, раздел 3). Plain text.
import type { AnyDb } from '@/db/types';
import { bindChat, unlinkChat } from './link';

export const BOT_TEXT = {
  alreadyOther: 'Этот чат уже привязан к другому аккаунту PS Tracker. Сначала отпишись там: /stop.',
  invalid: 'Код не подходит. Проверь, что скопировал его целиком, или создай новый в настройках сайта.',
  expired: 'Код устарел или уже использован. Создай новый в настройках сайта: кнопка «Привязать Telegram».',
  help: 'Это бот PS Tracker. Чтобы получать воскресную сводку, открой настройки сайта, нажми «Привязать Telegram» и пришли сюда команду из подсказки: /start КОД.',
  stopped: 'Отписал. Сводка больше не придёт, привязка удалена. Вернуться можно в настройках сайта.',
  notLinked: 'Этот чат ни к чему не привязан.',
  unknown: 'Понимаю только /start КОД и /stop.',
  tooMany: 'Слишком много попыток. Подожди 10 минут и создай новый код в настройках сайта.',
} as const;

export const linkedText = (label: string, origin: string | null) =>
  `Готово: чат привязан к ${label}. Сводка будет приходить по воскресеньям вечером (МСК). Отписаться: /stop.${origin ? ` Статус и настройки: ${origin}/` : ''}`;
export const sameText = (label: string) => `Этот чат уже привязан к ${label}. Отписаться: /stop.`;

export type TelegramUpdate = { message?: { text?: unknown; chat?: { id?: unknown; type?: unknown } } };

const CMD = /^\/(start|stop)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/i;

/**
 * Что ответить на апдейт. null = игнорировать (не приватный чат, не текст). Исключения БД пробрасываются:
 * вызывающий (роут) глотает их и отвечает 200.
 */
export async function replyFor(db: AnyDb, update: TelegramUpdate, o: { now?: Date; origin?: string | null } = {}): Promise<{ chatId: string; text: string } | null> {
  const m = update?.message;
  if (!m || typeof m.text !== 'string' || !m.chat) return null;
  if (m.chat.type !== 'private') return null;
  const id = m.chat.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  const chatId = String(id);
  const cmd = CMD.exec(m.text.trim());
  if (!cmd) return { chatId, text: BOT_TEXT.unknown };
  if (cmd[1].toLowerCase() === 'stop') return { chatId, text: (await unlinkChat(db, chatId)) ? BOT_TEXT.stopped : BOT_TEXT.notLinked };
  if (!cmd[2]) return { chatId, text: BOT_TEXT.help };
  const r = await bindChat(db, chatId, cmd[2], o.now);
  switch (r.kind) {
    case 'ok':
      return { chatId, text: linkedText(r.label, o.origin ?? null) };
    case 'already_same':
      return { chatId, text: sameText(r.label) };
    case 'chat_taken':
      return { chatId, text: BOT_TEXT.alreadyOther };
    case 'expired':
      return { chatId, text: BOT_TEXT.expired };
    case 'rate_limited':
      return { chatId, text: BOT_TEXT.tooMany };
    default:
      return { chatId, text: BOT_TEXT.invalid };
  }
}
