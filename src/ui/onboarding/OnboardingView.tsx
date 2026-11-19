'use client';

// Онбординг (Фаза 20.4, design-system §9): ник PSN -> проверка доступа -> первая загрузка игр.
// Шаг определяется данными GET /api/me/psn, перезагрузка возвращает на тот же шаг.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../icons';
import { fetchPsn, goLogin, JSON_HEADERS } from './http';
import { CheckActions, CheckResultBlock } from './OnboardingCheck';
import { SyncStep } from './OnboardingSync';
import {
  STEP_NAMES, checkFromStatus, deriveStep, mapPutError, validateNick, type Action, type CheckResult, type PsnState, type Step,
} from './model';

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
