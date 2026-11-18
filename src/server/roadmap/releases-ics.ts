// П12.6: календарь релизов (.ics, RFC 5545). Релизы плана («Планы», статус planned) и не купленные игры бэклога «вручную»
// с датой выхода сегодня или позже (по Москве). События на весь день; UID стабильный (календарь может обновить события при повторном импорте, но не обязан).
import { and, asc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { mskDate } from '@/server/sync/time';

const { plannedGames, manualGames } = schema;

export type IcsRelease = { uid: string; title: string; date: string; note: string };

const CRLF = '\r\n';
const enc = new TextEncoder();

/** Экранирование TEXT (RFC 5545 §3.3.11). */
export function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Свёртка строк по 75 октетов UTF-8, не разрывая символы (§3.1). */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const max = out.length === 0 ? 75 : 74; // продолжение начинается с пробела
    if (len + n > max) { out.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join(`${CRLF} `);
}

const ymd = (d: string) => d.replace(/-/g, '');
function nextDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** `subscription`: живая подписка — календарь сам перечитывает ленту (подсказка интервала 6 ч). */
export function buildIcs(items: readonly IcsRelease[], now: Date, opts: { subscription?: boolean } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PlayStation Tracker//Releases//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('Релизы игр')}`, 'X-WR-TIMEZONE:Europe/Moscow',
    ...(opts.subscription ? ['REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'] : []),
  ];
  for (const i of items) {
    lines.push(
      'BEGIN:VEVENT', `UID:${i.uid}`, `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${ymd(i.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(i.date))}`,
      `SUMMARY:${icsText(`Релиз: ${i.title.trim()}`)}`, ...(i.note ? [`DESCRIPTION:${icsText(i.note)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * `sinceDays`: с какого дня брать (по умолчанию сегодня); подписка берёт и прошедший месяц, чтобы вышедшие релизы не исчезали сразу.
 * `notes: false` — без описаний (в подписке только названия и даты).
 */
export async function getReleases(db: AnyDb, userId: UserId, now: Date, opts: { sinceDays?: number; notes?: boolean } = {}): Promise<IcsRelease[]> {
  const today = mskDate(new Date(now.getTime() - (opts.sinceDays ?? 0) * 86_400_000));
  const notes = opts.notes !== false;
  const planned = await db
    .select({ id: plannedGames.id, title: plannedGames.title, date: plannedGames.releaseDate, want: plannedGames.wantAtRelease })
    .from(plannedGames)
    .where(and(eq(plannedGames.userId, userId), eq(plannedGames.status, 'planned'), isNotNull(plannedGames.releaseDate), gte(plannedGames.releaseDate, today)))
    .orderBy(asc(plannedGames.releaseDate), asc(plannedGames.id));
  const manual = await db
    .select({ id: manualGames.id, title: manualGames.title, date: manualGames.releaseDate })
    .from(manualGames)
    .where(and(eq(manualGames.userId, userId), eq(manualGames.kind, 'ps_backlog'), isNull(manualGames.linkedGameId), isNotNull(manualGames.releaseDate), gte(manualGames.releaseDate, today)))
    .orderBy(asc(manualGames.releaseDate), asc(manualGames.id));
  const seen = new Set<string>();
  const out: IcsRelease[] = [];
  for (const p of planned) {
    seen.add(p.title.trim().toLowerCase());
    out.push({ uid: `planned-${p.id}@ps-tracker`, title: p.title, date: p.date!, note: notes ? (p.want ? 'В плане: хочу пройти на релизе' : 'В плане') : '' });
  }
  for (const m of manual) {
    if (seen.has(m.title.trim().toLowerCase())) continue;
    out.push({ uid: `manual-${m.id}@ps-tracker`, title: m.title, date: m.date!, note: notes ? 'В бэклоге (вручную)' : '' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'));
}
