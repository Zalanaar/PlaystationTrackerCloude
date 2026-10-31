'use client';

// Онбординг (Фаза 20.4, design-system §9): ник PSN -> проверка доступа -> первая загрузка игр.
// Шаг определяется данными GET /api/me/psn, перезагрузка возвращает на тот же шаг.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '../icons';
import {
  STEP_NAMES, checkActions, checkFromStatus, deriveStep, gamesSeen, mapPutError, phaseLabel, progressPercent, shouldAutoStart,
  syncErrorText, syncView, validateNick, type Action, type CheckResult, type PsnState, type Step, type SyncSlice,
} from './model';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const POLL_MS = 2500;

function goLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign('/login?next=%2Fonboarding');
}

async function fetchPsn(): Promise<PsnState | null> {
  try {
    const res = await fetch('/api/me/psn', { cache: 'no-store' });
    if (res.status === 401) { goLogin(); return null; }
    const json = await res.json().catch(() => null);
    return res.ok && json?.ok ? (json.data as PsnState) : null;
  } catch {
    return null;
  }
}

function Header() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }
  return (
    <header className="ps-header">
      <div className="ps-header__in ps-container" style={{ justifyContent: 'space-between' }}>
        <span className="ps-logo">PS TRACKER</span>
        <button type="button" className="ps-btn ps-btn--ghost" onClick={() => void logout()} disabled={busy}>Выйти</button>
      </div>
    </header>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <div className="ps-ob__stepper">
      <div className="ps-ob__segs" aria-hidden="true">
        {[1, 2, 3].map((n) => <span key={n} className="ps-ob__seg" data-on={n <= step ? '' : undefined} />)}
      </div>
      <p className="ps-ob__steptext" aria-live="polite" data-testid="ob-stepper">
        Шаг {step} из 3<span className="ps-ob__steptext-name"> · {STEP_NAMES[step]}</span>
      </p>
    </div>
  );
}

type Tone = 'danger' | 'warning' | 'success';
const CHECK_VIEW: Partial<Record<CheckResult['kind'], { tone: Tone; icon: IconName }>> = {
  ok: { tone: 'success', icon: 'check-circle' },
  psn_not_found: { tone: 'danger', icon: 'user-x' },
  psn_private: { tone: 'warning', icon: 'lock' },
  psn_friend_required: { tone: 'warning', icon: 'user-plus' },
  psn_account_locked: { tone: 'danger', icon: 'shield-alert' },
  psn_id_taken: { tone: 'danger', icon: 'users' },
  rate_limited: { tone: 'warning', icon: 'timer' },
  psn_unavailable: { tone: 'warning', icon: 'cloud-off' },
  network: { tone: 'danger', icon: 'circle-alert' },
  config_error: { tone: 'danger', icon: 'circle-alert' },
};

function CheckBody({ r, nick, left }: { r: CheckResult; nick: string; left: number }): { title: ReactNode; text?: ReactNode; steps?: string[]; sr?: string } {
  switch (r.kind) {
    case 'ok': return { title: `Доступ есть. Нашли профиль @${nick}` };
    case 'psn_not_found': return { title: 'Профиль не найден', text: 'Проверьте, нет ли опечатки в нике PSN.' };
    case 'psn_private':
      return {
        title: 'Профиль закрыт',
        text: 'Откройте игры и трофеи в настройках приватности PlayStation, затем нажмите «Проверить снова».',
        steps: ['Откройте PlayStation: Настройки -> Друзья и аккаунты -> Приватность', 'Игры и трофеи: «Все»', 'Вернитесь сюда'],
      };
    case 'psn_friend_required':
      return { title: 'Профиль виден только друзьям', text: 'Добавьте в друзья технический аккаунт сайта или откройте профиль, затем нажмите «Проверить снова».' };
    case 'psn_account_locked':
      return { title: 'Этот ник относится к другому аккаунту', text: 'В вашей коллекции уже есть игры. Укажите прежний ник или обратитесь к владельцу сайта.' };
    case 'psn_id_taken': return { title: 'Этот ник уже занят', text: 'Другой пользователь сайта использует этот ник. Проверьте написание или обратитесь к владельцу.' };
    case 'rate_limited':
      return {
        title: 'Слишком часто',
        text: left > 0 ? <>Повторить можно через <span aria-hidden="true">{left}</span> с.</> : 'Можно повторить проверку.',
        sr: 'Слишком часто. Повторите проверку чуть позже.',
      };
    case 'psn_unavailable': return { title: 'PlayStation сейчас не отвечает', text: 'Это не ошибка в нике. Попробуйте через минуту.' };
    case 'config_error': return { title: 'Подключение не настроено', text: 'На сервере не настроено подключение к PlayStation. Сообщите владельцу сайта.' };
    default: return { title: 'Не удалось связаться с сайтом', text: 'Попробуйте ещё раз.' };
  }
}

export function OnboardingView({ recheck = false }: { recheck?: boolean }) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<PsnState | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [nick, setNick] = useState('');
  const [nickError, setNickError] = useState<string | null>(null);
  const [onlineId, setOnlineId] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [left, setLeft] = useState(0);
  const [srCooldown, setSrCooldown] = useState('');
  const h2 = useRef<HTMLHeadingElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const checkSeq = useRef(0);

  const runCheck = useCallback(async (id: string | null) => {
    const seq = ++checkSeq.current;
    setCheck({ kind: 'checking' });
    let res: CheckResult;
    try {
      const r = await fetch('/api/me/psn', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(id ? { onlineId: id } : {}) });
      if (r.status === 401) { goLogin(); return; }
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        const d = j.data as Partial<PsnState>;
        setData((prev) => ({ ...(prev as PsnState), ...d, accessStatus: 'ok', canStartSync: true }));
        if (typeof d.onlineId === 'string') setOnlineId(d.onlineId);
        res = { kind: 'ok' };
      } else {
        res = mapPutError(r.status, j?.error?.code, j?.error?.details, r.headers.get('Retry-After'));
      }
    } catch {
      res = { kind: 'network' };
    }
    if (seq !== checkSeq.current) return;
    if (res.kind === 'invalid') {
      setNickError('Ник не подошёл. Проверьте написание.');
      setStep(1);
      setCheck(null);
      return;
    }
    setCheck(res);
    setLeft(res.kind === 'rate_limited' ? res.retryAfterSec ?? 30 : 0);
    setSrCooldown(res.kind === 'rate_limited' ? `Слишком часто. Повторить проверку можно через ${res.retryAfterSec ?? 30} с.` : '');
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    const d = await fetchPsn();
    if (!d) { setLoadState('error'); return; }
    if (d.onlineId && d.onboardedAt && !recheck) { router.replace('/'); return; }
    setData(d);
    setNick(d.onlineId ?? '');
    setOnlineId(d.onlineId ?? '');
    const s = recheck && d.onlineId ? 2 : deriveStep(d);
    setStep(s);
    setLoadState('ready');
    if (s === 2) {
      const known = recheck ? null : checkFromStatus(d.accessStatus);
      if (known) setCheck(known);
      else void runCheck(null);
    }
  }, [recheck, router, runCheck]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Обратный отсчёт rate_limited: видимый текст раз в секунду, в aria-live только старт и конец.
  const limited = check?.kind === 'rate_limited';
  useEffect(() => {
    if (!limited) return;
    const t = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) { clearInterval(t); setSrCooldown('Можно повторить проверку'); return 0; }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [limited]);

  // Фокус: на заголовок шага при смене (не при первой загрузке), на поле на десктопе, на блок результата.
  useEffect(() => {
    if (loadState !== 'ready') return;
    if (!mounted.current) {
      mounted.current = true;
      if (step === 1 && window.matchMedia('(min-width: 768px)').matches) input.current?.focus();
      return;
    }
    if (step === 1 && window.matchMedia('(min-width: 768px)').matches) input.current?.focus();
    else h2.current?.focus();
  }, [step, loadState]);

  const kind = check?.kind;
  useEffect(() => {
    if (kind && kind !== 'checking') result.current?.focus();
  }, [kind]);

  function submitNick(e: FormEvent) {
    e.preventDefault();
    const v = nick.trim();
    const err = validateNick(v);
    setNickError(err);
    if (err) { input.current?.focus(); return; }
    setNick(v);
    setOnlineId(v);
    setStep(2);
    void runCheck(v);
  }

  function act(a: Action) {
    if (a === 'edit') { setNick(onlineId); setNickError(null); setCheck(null); setStep(1); }
    else if (a === 'recheck') void runCheck(onlineId || null);
    else setStep(3);
  }

  const cur = loadState === 'ready' ? step : 1;
  return (
    <>
      <Header />
      <main className="ps-ob ps-container">
        <div className="ps-ob__wrap">
          <div className="ps-ob__head">
            <h1 className="ps-ob__h1">Подключим PlayStation</h1>
            <p className="ps-ob__lead">Укажите ник, проверим доступ к профилю и загрузим вашу коллекцию игр.</p>
          </div>
          <Stepper step={cur} />
          {loadState === 'loading' && (
            <section className="ps-panel ps-ob__panel" aria-busy="true" data-testid="ob-loading">
              <div className="ps-ob__sk"><span className="ps-skeleton" style={{ height: 'var(--sp-4)' }} /><span className="ps-skeleton" style={{ height: 'var(--control-h)' }} /></div>
            </section>
          )}
          {loadState === 'error' && (
            <section className="ps-panel ps-ob__panel" data-testid="ob-load-error">
              <div className="ps-ob__result" data-tone="danger" role="alert">
                <Icon name="circle-alert" size={24} />
                <div className="ps-ob__rbody">
                  <p className="ps-ob__rtitle">Не удалось связаться с сайтом</p>
                  <p className="ps-ob__rtext">Попробуйте ещё раз.</p>
                </div>
              </div>
              <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" onClick={() => void load()}>Повторить</button></div>
            </section>
          )}
          {loadState === 'ready' && step === 1 && (
            <section className="ps-panel ps-ob__panel" key="s1" aria-labelledby="ob-h2">
              <h2 id="ob-h2" className="ps-ob__h2" tabIndex={-1} ref={h2}>Ваш ник в PlayStation Network</h2>
              <form className="ps-ob__field" onSubmit={submitNick} noValidate style={{ gap: 'var(--sp-4)' }}>
                <div className="ps-ob__field">
                  <label htmlFor="ob-nick" className="ps-ob__label">Ник PSN</label>
                  <input
                    id="ob-nick" ref={input} className="ps-input ps-ob__input" name="psn" value={nick} maxLength={16} inputMode="text" enterKeyHint="go"
                    autoComplete="off" autoCapitalize="none" spellCheck={false}
                    aria-invalid={nickError ? true : undefined} aria-describedby={nickError ? 'ob-hint ob-nick-err' : 'ob-hint'}
                    onChange={(e) => setNick(e.target.value)}
                    onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center' })}
                    onBlur={() => setNickError(nick.trim() === '' && !nickError ? null : validateNick(nick))}
                  />
                  <p id="ob-hint" className="ps-ob__hint">От 3 до 16 символов: латинские буквы, цифры, дефис и подчёркивание. Начинается с буквы.</p>
                  {nickError && <p id="ob-nick-err" className="ps-ob__err" data-testid="ob-nick-error"><Icon name="circle-alert" size={16} />{nickError}</p>}
                </div>
                <div className="ps-ob__info">
                  <Icon name="info" size={20} />
                  <p>Профиль PSN должен быть открытым: в настройках приватности PlayStation разрешите всем видеть игры и трофеи. Пароль от PlayStation не нужен.</p>
                </div>
                <div className="ps-ob__acts"><button type="submit" className="ps-btn ps-btn--primary">Продолжить</button></div>
              </form>
            </section>
          )}
          {loadState === 'ready' && step === 2 && check && (
            <section className="ps-panel ps-ob__panel" key="s2" aria-labelledby="ob-h2">
              <h2 id="ob-h2" className="ps-ob__h2" tabIndex={-1} ref={h2}>Проверяем доступ к профилю</h2>
              <div className="ps-ob__chip">
                <span className="ps-ob__nick" data-testid="ob-nick">@{onlineId}</span>
                {check.kind !== 'checking' && <button type="button" className="ps-link" onClick={() => act('edit')}>Изменить</button>}
              </div>
              <CheckResultBlock r={check} nick={onlineId} left={left} refEl={result} />
              {srCooldown && <p className="ps-ob__sr" role="status">{srCooldown}</p>}
              <CheckActions r={check} left={left} onAct={act} />
            </section>
          )}
          {loadState === 'ready' && step === 3 && data && (
            <SyncStep
              key="s3" initial={data} recheck={recheck} h2={h2}
              onBack={(s) => { setStep(s); if (s === 2) { const k = checkFromStatus(data.accessStatus); if (k && k.kind !== 'ok') setCheck(k); else void runCheck(onlineId || null); } }}
            />
          )}
        </div>
      </main>
    </>
  );
}

function CheckResultBlock({ r, nick, left, refEl }: { r: CheckResult; nick: string; left: number; refEl: React.RefObject<HTMLDivElement | null> }) {
  if (r.kind === 'checking') {
    return (
      <div className="ps-ob__result" role="status" aria-busy="true" data-testid="ob-checking">
        <Icon name="loader" size={24} className="ps-ob__spin" />
        <div className="ps-ob__rbody">
          <p className="ps-ob__rtitle">Проверяем доступ…</p>
          <p className="ps-ob__rtext">Это занимает несколько секунд</p>
        </div>
      </div>
    );
  }
  const v = CHECK_VIEW[r.kind] ?? CHECK_VIEW.network!;
  const b = CheckBody({ r, nick, left });
  const isErr = r.kind !== 'ok';
  return (
    <div
      className="ps-ob__result" data-tone={v.tone} data-testid={`ob-result-${r.kind}`} ref={refEl} tabIndex={-1}
      role={isErr ? 'alert' : 'status'}
    >
      <Icon name={v.icon} size={24} />
      <div className="ps-ob__rbody">
        <p className="ps-ob__rtitle">{b.title}</p>
        {b.text && <p className="ps-ob__rtext">{b.text}</p>}
        {b.steps && <ol className="ps-ob__list">{b.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
      </div>
    </div>
  );
}

function CheckActions({ r, left, onAct }: { r: CheckResult; left: number; onAct: (a: Action) => void }) {
  const { primary, ghost } = checkActions(r.kind);
  const busy = r.kind === 'checking';
  const label = (a: Action) => {
    if (a === 'recheck') return r.kind === 'rate_limited' && left > 0 ? `Проверить снова (${left})` : 'Проверить снова';
    return a === 'edit' ? 'Изменить ник' : 'Дальше: загрузить игры';
  };
  const dis = (a: Action) => busy || (a === 'recheck' && r.kind === 'rate_limited' && left > 0);
  if (!primary && !ghost) return busy ? <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" disabled>Проверить снова</button></div> : null;
  return (
    <div className="ps-ob__acts">
      {primary && <button type="button" className="ps-btn ps-btn--primary" disabled={dis(primary)} onClick={() => onAct(primary)}>{label(primary)}</button>}
      {ghost && <button type="button" className="ps-btn ps-btn--ghost" disabled={dis(ghost)} onClick={() => onAct(ghost)}>{label(ghost)}</button>}
    </div>
  );
}

type StatusData = SyncSlice;

function SyncStep({ initial, recheck, h2, onBack }: { initial: PsnState; recheck: boolean; h2: React.RefObject<HTMLHeadingElement | null>; onBack: (s: Step) => void }) {
  const router = useRouter();
  const [began, setBegan] = useState(!recheck);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadFail, setLoadFail] = useState(false);
  const [queued, setQueued] = useState(false);
  const [startError, setStartError] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean>(!recheck && !!initial.onboardedAt);
  const [phaseNote, setPhaseNote] = useState('');
  const api = useRef<{ retry: () => void }>({ retry: () => {} });
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!began) return;
    let alive = true;
    let polling = true;
    let first = !recheck;
    let q = false;
    let confirmTries = 0;
    let lastPhase = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (alive && polling) timer = setTimeout(() => void tick(), ms);
    };

    async function post(): Promise<void> {
      setStartError(false);
      try {
        const r = await fetch('/api/sync', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
        if (r.status === 401) { goLogin(); return; }
        if (r.status === 202) { q = false; setQueued(false); return; }
        const j = await r.json().catch(() => null);
        const code = j?.error?.code;
        if (r.status === 409 && code === 'sync_in_progress') { q = true; setQueued(true); return; }
        if (code === 'psn_not_set') { polling = false; onBackRef.current(1); return; }
        if (code === 'psn_not_verified') { polling = false; onBackRef.current(2); return; }
        setStartError(true);
        polling = false;
      } catch {
        setStartError(true);
        polling = false;
      }
    }

    async function tick(): Promise<void> {
      if (!alive || !polling) return;
      if (document.hidden) return; // возобновится по visibilitychange
      let s: StatusData | null = null;
      try {
        const r = await fetch('/api/sync/status', { cache: 'no-store' });
        if (r.status === 401) { goLogin(); return; }
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) s = j.data as StatusData;
      } catch { /* сеть: попробуем на следующем тике */ }
      if (!alive) return;
      if (!s) { setLoadFail(true); schedule(POLL_MS); return; }
      setLoadFail(false);
      setStatus(s);
      if (first) {
        first = false;
        if (shouldAutoStart(s)) { await post(); if (alive && polling) schedule(600); return; }
      } else if (q && !s.running) {
        await post();
        if (alive && polling) schedule(POLL_MS);
        return;
      }
      const v = syncView(s);
      const ph = s.run?.progress?.phase ?? '';
      if (ph && ph !== lastPhase) { lastPhase = ph; setPhaseNote(phaseLabel(ph)); }
      if (v.kind === 'success') {
        if (gamesSeen(s) === 0) { polling = false; return; }
        const d = await fetchPsn();
        if (!alive) return;
        if (d?.onboardedAt || ++confirmTries > 6) { polling = false; setOnboarded(true); return; }
        schedule(POLL_MS);
        return;
      }
      if (v.kind === 'running') { schedule(POLL_MS); return; }
      polling = false; // idle / failed: ждём действия пользователя
    }

    api.current.retry = () => {
      polling = true;
      first = false;
      confirmTries = 0;
      setStatus((p) => (p ? { ...p, running: true, run: p.run ? { ...p.run, status: 'running' } : p.run } : p));
      void (async () => { await post(); if (alive && polling) schedule(600); })();
    };

    const onVis = () => { if (!document.hidden && polling) { clearTimeout(timer); void tick(); } };
    document.addEventListener('visibilitychange', onVis);
    void tick();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [began, recheck]);

  const v = syncView(status);
  const seen = gamesSeen(status);
  const progress = status?.run?.progress ?? null;
  const pct = progressPercent(progress);
  const retry = () => api.current.retry();

  let body: ReactNode;
  if (!began) {
    body = (
      <>
        <p className="ps-ob__rtext">Доступ подтверждён. Загрузим игры, часы и трофеи с вашего профиля.</p>
        <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" onClick={() => setBegan(true)}>Начать загрузку</button></div>
      </>
    );
  } else if (startError && v.kind !== 'running') {
    body = <FailBlock title="Не удалось запустить загрузку." text="Попробуйте ещё раз." onRetry={retry} onBack={() => onBackRef.current(2)} />;
  } else if (!status) {
    body = loadFail ? (
      <div className="ps-ob__result" data-tone="warning" role="status"><Icon name="cloud-off" size={24} /><div className="ps-ob__rbody"><p className="ps-ob__rtitle">Не удалось обновить состояние загрузки</p><p className="ps-ob__rtext">Пробуем ещё раз…</p></div></div>
    ) : (
      <div className="ps-ob__sk" aria-busy="true" data-testid="ob-sync-loading">
        <span className="ps-skeleton" style={{ height: 'var(--sp-4)' }} /><span className="ps-skeleton" style={{ height: 6 }} /><span className="ps-skeleton" style={{ height: 'var(--sp-3)' }} />
      </div>
    );
  } else if (v.kind === 'failed') {
    body = <FailBlock title="Не удалось загрузить игры. Уже загруженное сохранено." text={syncErrorText(v.reason)} onRetry={retry} onBack={() => onBackRef.current(2)} />;
  } else if (v.kind === 'success' && seen === 0) {
    body = (
      <>
        <div className="ps-ob__result" data-tone="warning" role="status" data-testid="ob-empty">
          <Icon name="gamepad" size={24} />
          <div className="ps-ob__rbody"><p className="ps-ob__rtitle">Игр не нашли</p><p className="ps-ob__rtext">Возможно, в профиле скрыт список игр. Проверьте приватность и повторите.</p></div>
        </div>
        <div className="ps-ob__acts">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => onBackRef.current(2)}>Проверить доступ</button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={retry}>Повторить</button>
        </div>
      </>
    );
  } else if (v.kind === 'success' && onboarded) {
    body = (
      <div className="ps-ob__done" data-testid="ob-done" role="status">
        <Icon name="check-circle" size={32} />
        <h2 className="ps-ob__h2">Готово</h2>
        <p className="ps-ob__rtext">{seen !== null ? `Загружено игр: ${seen}. ` : ''}Осталось разобрать, что вы уже прошли, а что бросили.</p>
        <div className="ps-ob__acts">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => router.push('/triage')}>Открыть Разбор</button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => router.push('/')}>К коллекции</button>
        </div>
      </div>
    );
  } else {
    const label = v.kind === 'success' ? 'Заканчиваем загрузку' : phaseLabel(progress?.phase ?? status.run?.progress?.phase ?? status.run?.status);
    const total = progress?.total ?? null;
    const done = progress?.done ?? null;
    body = (
      <>
        {queued && !status.running && <p className="ps-ob__rtext" role="status" data-testid="ob-queued">Сейчас идёт загрузка у другого пользователя, ваша начнётся следом.</p>}
        <div>
          <div className="ps-ob__prog" data-testid="ob-progress-text">
            <span>{progress ? `Шаг ${progress.step} из ${progress.steps}: ${label}` : label}</span>
            {total !== null && total > 0 && done !== null && <span>{done} из {total}</span>}
          </div>
        </div>
        <div
          className="ps-ob__bar" role="progressbar" aria-label="Загрузка игр" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? 'Идёт загрузка' : undefined} aria-live="off"
          data-indeterminate={pct === null ? '' : undefined}
        >
          <div className="ps-ob__bar-fill" style={pct === null ? undefined : { width: `${pct}%` }} />
        </div>
        {v.kind === 'running' && v.partial && <p className="ps-ob__hint">Продолжаем загрузку…</p>}
        <p className="ps-ob__hint">Первая загрузка занимает несколько минут. Вкладку можно закрыть: загрузка продолжится.</p>
        <p className="ps-ob__sr" role="status">{phaseNote}</p>
      </>
    );
  }

  return (
    <section className="ps-panel ps-ob__panel" aria-labelledby={v.kind === 'success' && onboarded && seen !== 0 ? undefined : 'ob-h2'} aria-busy={began && !status}>
      {!(v.kind === 'success' && onboarded && seen !== 0 && began) && <h2 id="ob-h2" className="ps-ob__h2" tabIndex={-1} ref={h2}>Загружаем вашу коллекцию</h2>}
      {body}
    </section>
  );
}

function FailBlock({ title, text, onRetry, onBack }: { title: string; text: string; onRetry: () => void; onBack: () => void }) {
  return (
    <>
      <div className="ps-ob__result" data-tone="danger" role="alert" data-testid="ob-sync-failed">
        <Icon name="circle-alert" size={24} />
        <div className="ps-ob__rbody"><p className="ps-ob__rtitle">{title}</p><p className="ps-ob__rtext">{text}</p></div>
      </div>
      <div className="ps-ob__acts">
        <button type="button" className="ps-btn ps-btn--primary" onClick={onRetry}>Повторить</button>
        <button type="button" className="ps-btn ps-btn--ghost" onClick={onBack}>Проверить доступ</button>
      </div>
    </>
  );
}
