'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { plural } from '../format';
import { Icon } from '../icons';
import { NotFound } from '../NotFound';
import { SkRoot } from '../skeletons';
import { fetchHealthOverview, HealthApiError } from './api';
import {
  criteriaSummaryText, criteriaVerdict, criterionIcon, criterionLabel, errorReasonLabel, formatAge, formatDateTime, healthErrorText,
  profileTitle, providerStateText, runKindLabel, runStatusText, sourceText, syncLevel, tokenEventLabel, tokenLevel, tokenLevelText,
  tokenSourceLabel, usageLevel, usageRatio, usageText, type HealthOverview, type Level, type ProviderView,
} from './model';
import { psnStatusLabel, roleLabel, statusLabel } from '../access/model';

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'forbidden' } | { kind: 'ready'; data: HealthOverview };
type Provider = 'rawg' | 'hltb' | 'llm';
const PROVIDERS: { id: Provider; name: string }[] = [{ id: 'rawg', name: 'RAWG' }, { id: 'hltb', name: 'HLTB' }, { id: 'llm', name: 'LLM' }];
const LEVEL_ICON: Record<Level, 'check-circle' | 'alert' | 'circle-alert' | 'info'> = { ok: 'check-circle', warn: 'alert', danger: 'circle-alert', unknown: 'info' };
const LEVEL_WORD: Record<Level, string> = { ok: 'Норма', warn: 'Внимание', danger: 'Проблема', unknown: 'Нет данных' };

function Badge({ level, children }: { level: Level; children: React.ReactNode }) {
  return <span className="ps-health__badge" data-level={level}><Icon name={LEVEL_ICON[level]} size={14} /><span className="ps-sr">{LEVEL_WORD[level]}: </span>{children}</span>;
}

function Usage({ name, cell, view }: { name: string; cell: { used: number; limit: number | null }; view: Pick<ProviderView, 'state'> }) {
  const ratio = usageRatio(cell);
  const level = usageLevel(cell);
  return (
    <div className="ps-health__usage" data-level={level}>
      <span className="ps-health__usage-name">{name}</span>
      <span className="ps-health__usage-val">{usageText(cell, view)}</span>
      {ratio !== null && <span className="ps-health__bar" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>}
    </div>
  );
}

export function HealthView() {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const acRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    fetchHealthOverview(ac.signal).then(
      (data) => { if (!ac.signal.aborted) setState({ kind: 'ready', data }); },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof HealthApiError && (e.status === 403 || e.status === 404)) setState({ kind: 'forbidden' });
        else setState({ kind: 'error', text: e instanceof HealthApiError ? healthErrorText(e.status, e.code) : healthErrorText(0, 'network') });
      },
    );
  }, []);
  useEffect(() => { load(); return () => acRef.current?.abort(); }, [load]);
  const retry = () => { setState({ kind: 'loading' }); load(); };

  if (state.kind === 'forbidden') return <NotFound />;

  return (
    <div className="ps-health">
      <div className="ps-health__head">
        <h1 className="ps-h1">Здоровье</h1>
        <button type="button" className="ps-btn ps-btn--ghost" onClick={retry} disabled={state.kind === 'loading'}>
          <Icon name="refresh" size={16} />Обновить
        </button>
      </div>

      {state.kind === 'loading' && (
        <div data-testid="health-loading">
          <SkRoot className="ps-health__stack">
            <span className="ps-skeleton ps-health__sk" />
            <span className="ps-skeleton ps-health__sk" />
            <span className="ps-skeleton ps-health__sk" />
          </SkRoot>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="ps-health__card" role="alert" data-testid="health-error">
          <p className="ps-health__err">{state.text}</p>
          <button type="button" className="ps-btn ps-btn--primary" onClick={retry}>Повторить</button>
        </div>
      )}
      {state.kind === 'ready' && <Ready data={state.data} />}
    </div>
  );
}

function Ready({ data }: { data: HealthOverview }) {
  const now = new Date(data.generatedAt).getTime();
  const verdict = criteriaVerdict(data.criteria.summary);
  const tl = tokenLevel(data.psnToken?.ageSeconds);
  const ev = data.psnToken?.lastEvent ?? null;
  const flagged = data.users.filter((u) => u.sync.recentErrors.length > 0).length;

  return (
    <>
      <p className="ps-health__lead">Состояние на {formatDateTime(data.generatedAt)} (МСК). Расход считается за сутки {data.day}.</p>

      <section className="ps-health__card" aria-labelledby="h-criteria" data-testid="health-criteria">
        <h2 className="ps-h2" id="h-criteria">Критерии для MULTIUSER_ENABLED=1</h2>
        <p className="ps-health__row">
          <Badge level={verdict.level}>{verdict.text}</Badge>
          <span className="ps-health__muted">Сейчас мультипользователь {data.multiuser.enabled ? 'включён' : 'выключен'}. Активных профилей: {data.multiuser.activeProfiles} из {data.multiuser.maxUsers}.</span>
        </p>
        <p className="ps-health__muted" data-testid="criteria-summary">{criteriaSummaryText(data.criteria.summary)}</p>
        <ul className="ps-health__list">
          {data.criteria.items.map((c) => (
            <li key={c.id} className="ps-health__crit" data-status={c.status} data-testid={`criterion-${c.id}`}>
              <span className="ps-health__crit-ic" aria-hidden="true"><Icon name={criterionIcon(c.status)} size={18} /></span>
              <div className="ps-health__crit-body">
                <span className="ps-health__crit-title">{c.title}</span>
                <span className="ps-health__crit-state">{criterionLabel(c.status)}</span>
                {c.detail && <span className="ps-health__muted">{c.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="ps-health__card" aria-labelledby="h-token" data-testid="health-token">
        <h2 className="ps-h2" id="h-token">Токен PSN</h2>
        {!data.psnToken ? (
          <p className="ps-health__muted">Журнала токена пока нет. Возраст неизвестен.</p>
        ) : (
          <>
            <p className="ps-health__row"><Badge level={tl}>{formatAge(data.psnToken.ageSeconds)}</Badge><span>{tokenLevelText(tl)}</span></p>
            <dl className="ps-health__meta">
              <div><dt>Выдан</dt><dd>{formatDateTime(data.psnToken.issuedAt)}</dd></div>
              <div><dt>Источник</dt><dd>{tokenSourceLabel(data.psnToken.source)}</dd></div>
              {ev && <div><dt>Последнее событие</dt><dd>{tokenEventLabel(ev.event)}, {formatDateTime(ev.at)}</dd></div>}
            </dl>
            <p className="ps-health__muted">Refresh-токен живёт около 10 дней, предупреждение с 7-го дня. Срок самого NPSSO не измерен.</p>
          </>
        )}
      </section>

      <section className="ps-health__card" aria-labelledby="h-day" data-testid="health-totals">
        <h2 className="ps-h2" id="h-day">Итоги за сутки</h2>
        <div className="ps-health__usages">
          {PROVIDERS.map((p) => <Usage key={p.id} name={p.name} cell={data.totals[p.id]} view={data.limits[p.id]} />)}
        </div>
        <ul className="ps-health__list ps-health__limits">
          {PROVIDERS.map((p) => {
            const v = data.limits[p.id];
            const us = sourceText(v.userSource);
            const ts = sourceText(v.totalSource);
            return (
              <li key={p.id} className="ps-health__limit" data-state={v.state} data-testid={`limit-${p.id}`}>
                <strong>{p.name}</strong>
                <span data-testid={`limit-${p.id}-state`}>{providerStateText(p.id, v)}</span>
                <span className="ps-health__muted">
                  Потолок: {v.userLimit} на профиль, {v.totalLimit} всего.
                  {v.userSource === 'clamped' && <> На профиль: {us}.</>}
                  {v.totalSource === 'clamped' && <> Всего: {ts}.</>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="ps-health__muted">Профилей с ошибками синка за 14 дней: {flagged}.</p>
      </section>

      <section aria-labelledby="h-users" data-testid="health-users">
        <h2 className="ps-h2 ps-health__h2" id="h-users">Профили</h2>
        <ul className="ps-health__list">
          {data.users.map((u) => {
            const sl = syncLevel(u.sync.lastSuccessAt, now);
            return (
              <li key={u.id} className="ps-health__card ps-health__user" data-testid={`health-user-${u.id}`}>
                <div className="ps-health__user-head">
                  <span className="ps-health__user-name">{profileTitle(u)}</span>
                  <span className="ps-health__pill">{roleLabel(u.role)}</span>
                  <span className="ps-health__pill">{statusLabel(u.status)}</span>
                  {!u.isPrimary && <span className="ps-health__pill">Доп. профиль</span>}
                </div>
                <dl className="ps-health__meta">
                  {u.email && <div><dt>Почта</dt><dd>{u.email}</dd></div>}
                  <div><dt>PSN ID</dt><dd>{u.psnOnlineId ?? 'не указан'}</dd></div>
                  <div><dt>Доступ к PSN</dt><dd>{psnStatusLabel(u.psnAccessStatus)}{u.psnAccessCheckedAt ? `, проверен ${formatDateTime(u.psnAccessCheckedAt)}` : ''}</dd></div>
                  <div><dt>Последний вход</dt><dd>{u.isPrimary ? formatDateTime(u.lastLoginAt) : 'по входу основного'}</dd></div>
                  <div><dt>Успешный синк</dt><dd><Badge level={sl}>{u.sync.lastSuccessAt ? formatDateTime(u.sync.lastSuccessAt) : 'не было'}</Badge></dd></div>
                  <div><dt>Последняя попытка</dt><dd>{formatDateTime(u.sync.lastAttemptAt)}</dd></div>
                </dl>
                <div className="ps-health__usages">
                  {PROVIDERS.map((p) => <Usage key={p.id} name={p.name} cell={u.usage[p.id]} view={data.limits[p.id]} />)}
                </div>
                {u.sync.recentErrors.length === 0 ? (
                  <p className="ps-health__muted">Ошибок синка за 14 дней нет.</p>
                ) : (
                  <div>
                    <p className="ps-micro">Ошибки за 14 дней ({u.sync.recentErrors.length} {plural(u.sync.recentErrors.length, ['запуск', 'запуска', 'запусков'])})</p>
                    <ul className="ps-health__list ps-health__errs">
                      {u.sync.recentErrors.map((e) => (
                        <li key={e.id} data-testid="health-run-error">
                          {formatDateTime(e.startedAt)}: {runKindLabel(e.kind)}, {runStatusText(e.status)}, {errorReasonLabel(e.errorReason)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
