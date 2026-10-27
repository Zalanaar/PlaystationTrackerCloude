// Ошибки PSN и их классификация. psn-api не отдаёт HTTP-статус, только Error.message,
// поэтому классификация идёт по тексту (docs/api-contract.md, 8.5). Все эвристики живут здесь.
import type { schema } from '@/db';

export type SyncErrorReason = (typeof schema.syncErrorReason.enumValues)[number];

export class PsnError extends Error {
  readonly reason: SyncErrorReason;
  constructor(reason: SyncErrorReason, message: string) {
    super(message);
    this.name = 'PsnError';
    this.reason = reason;
  }
  /** Есть смысл повторить запрос с паузой. */
  get retryable(): boolean {
    return this.reason === 'rate_limited' || this.reason === 'psn_unavailable';
  }
}

const MAX_MESSAGE = 500;

/** Сообщение об ошибке без секретов: известные секреты по точному совпадению, Bearer, JWT, длинные токеноподобные строки. */
export function safeErr(e: unknown, secrets: ReadonlyArray<string | null | undefined> = []): string {
  let msg = e instanceof Error ? e.message : String(e);
  for (const s of secrets) {
    if (s && s.length >= 8) msg = msg.split(s).join('[redacted]');
  }
  msg = msg
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[redacted]')
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return msg.slice(0, MAX_MESSAGE);
}

/** Текст для классификации. psn-api бросает JSON.stringify(ответа GraphQL): тогда берём только поля с сообщениями об ошибке, а не весь JSON (в нём 401/404 бывают внутри id). */
function classifiableText(text: string): string {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return text;
  }
  const parts: string[] = [];
  const pick = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const r = o as Record<string, unknown>;
    for (const k of ['message', 'error', 'error_description', 'code']) {
      if (typeof r[k] === 'string') parts.push(r[k] as string);
      else if (k === 'error' && r[k] && typeof r[k] === 'object') pick(r[k]);
    }
  };
  pick(parsed);
  const errors = (parsed as { errors?: unknown } | null)?.errors;
  if (Array.isArray(errors)) {
    for (const x of errors) {
      pick(x);
      pick((x as { extensions?: unknown } | null)?.extensions);
    }
  }
  return parts.join(' ');
}

/** Превращает произвольную ошибку вызова psn-api в PsnError. Неизвестное = psn_unavailable (с повторами). */
export function classifyPsnError(e: unknown, secrets: ReadonlyArray<string | null | undefined> = []): PsnError {
  if (e instanceof PsnError) return e;
  const text = e instanceof Error ? e.message : String(e);
  const low = classifiableText(text).toLowerCase();
  const message = safeErr(e, secrets);
  if (/\b429\b|too many requests|rate.?limit|throttl/.test(low)) return new PsnError('rate_limited', message);
  if (/\bnpsso\b/.test(low)) return new PsnError('npsso_invalid', message);
  if (/access denied|forbidden|\b403\b|permission|privacy|not allowed|user not found|resource not found|\b404\b/.test(low)) {
    return new PsnError('access_denied', message);
  }
  if (/unauthori[sz]ed|\b401\b|invalid[_ ]?grant|invalid[_ ]?client|invalid[_ ]token|invalid access token|(access )?token (has )?expired|expired (access )?token/.test(low)) {
    return new PsnError('auth_expired', message);
  }
  return new PsnError('psn_unavailable', message);
}
