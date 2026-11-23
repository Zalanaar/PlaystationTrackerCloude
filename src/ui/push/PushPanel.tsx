'use client';

// П14.2 «Уведомления на этом устройстве»: включаются только по кнопке (запрос разрешения — в обработчике нажатия, как требует Safari).
// Сейчас приходят: «Релиз завтра» (вечером накануне, по играм плана и бэклога с датой) и раз в месяц «Вернуться к …?» (src/server/push/shelved.ts). «Проверить» — тестовое уведомление.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../icons';
import { PUSH_TEXT, keyBytes, pushView, type PushEnvInfo } from './model';

type Server = { configured: boolean; publicKey: string | null; devices: number; shelvedReminder?: boolean };
const JSON_H = { 'Content-Type': 'application/json' };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw Object.assign(new Error(body?.error?.code ?? 'error'), { status: res.status });
  return body.data as T;
}

function detectEnv(): PushEnvInfo {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, ios, standalone, permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

export function PushPanel() {
  const [server, setServer] = useState<Server | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [env, setEnv] = useState<PushEnvInfo | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [shelved, setShelved] = useState(true);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const s = await api<Server>('/api/me/push');
      const e = detectEnv();
      let sub: PushSubscription | null = null;
      if (s.configured && e.supported) sub = (await (await registration())?.pushManager.getSubscription()) ?? null;
      // браузер подписан и разрешение есть — тихо сверяем с сервером (подписка могла устареть там)
      if (sub && e.permission === 'granted') await api('/api/me/push', { method: 'POST', headers: JSON_H, body: JSON.stringify(sub.toJSON()) }).catch(() => undefined);
      setServer(s); setEnv(e); setSubscribed(!!sub && e.permission === 'granted'); setShelved(s.shelvedReminder !== false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  async function enable() {
    if (!server?.publicKey) return;
    setBusy(true); setMsg('');
    try {
      const perm = await Notification.requestPermission(); // первым делом: Safari требует вызов прямо из нажатия
      setEnv((e) => (e ? { ...e, permission: perm } : e));
      if (perm !== 'granted') { setMsg(perm === 'denied' ? PUSH_TEXT.denied : 'Разрешение не дано.'); return; }
      const reg = await registration();
      if (!reg) { setMsg('Приложение ещё не готово к уведомлениям. Обнови страницу и попробуй снова.'); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(server.publicKey) });
      const r = await api<{ devices: number }>('/api/me/push', { method: 'POST', headers: JSON_H, body: JSON.stringify(sub.toJSON()) });
      setServer({ ...server, devices: r.devices }); setSubscribed(true);
      setMsg('Уведомления включены на этом устройстве.');
    } catch {
      setMsg('Не удалось включить уведомления. Попробуй ещё раз.');
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMsg('');
    try {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => false);
        const r = await api<{ devices: number }>('/api/me/push', { method: 'DELETE', headers: JSON_H, body: JSON.stringify({ endpoint }) });
        if (server) setServer({ ...server, devices: r.devices });
      }
      setSubscribed(false);
      setMsg('Уведомления на этом устройстве выключены.');
    } catch {
      setMsg('Не удалось выключить уведомления. Попробуй ещё раз.');
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg('');
    try {
      const r = await api<{ sent: number }>('/api/me/push/test', { method: 'POST' });
      setMsg(r.sent > 0 ? 'Отправлено. Уведомление придёт через несколько секунд.' : 'Не удалось доставить: выключи и включи уведомления заново.');
    } catch (e) {
      setMsg((e as { status?: number }).status === 429 ? 'Проверять можно не чаще раза в минуту.' : 'Не удалось отправить проверку.');
    } finally { setBusy(false); }
  }


  async function toggleShelved(on: boolean) {
    const prev = shelved;
    setShelved(on); setMsg('');
    try {
      const r = await api<{ shelvedReminder: boolean }>('/api/me/push', { method: 'PATCH', headers: JSON_H, body: JSON.stringify({ shelvedReminder: on }) });
      setShelved(r.shelvedReminder);
    } catch {
      setShelved(prev);
      setMsg('Не удалось сохранить настройку. Попробуй ещё раз.');
    }
  }

  const view = pushView({ server, loadError, env, subscribed });

  return (
    <section className="ps-panel ps-tg" aria-labelledby="push-title" aria-busy={view === 'loading' || undefined} data-testid="push-panel">
      <h3 id="push-title" className="ps-tg__title">Уведомления на этом устройстве</h3>
      <p className="ps-tg__lead">Напомню вечером накануне релиза игры из плана или бэклога, а раз в месяц — об одной игре из «Отложено». Включаются только здесь и только для этого устройства.</p>
      {view === 'loading' ? (
        <div className="ps-tg__acts"><button type="button" className="ps-btn ps-btn--primary" disabled>Включить уведомления</button></div>
      ) : view === 'error' ? (
        <>
          <p className="ps-tg__cap" role="status">Не удалось загрузить настройки уведомлений.</p>
          <div className="ps-tg__acts"><button type="button" className="ps-btn ps-btn--ghost" onClick={() => void load()}>Повторить</button></div>
        </>
      ) : view === 'off' ? (
        <div className="ps-tg__acts"><button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={() => void enable()} data-testid="push-enable">Включить уведомления</button></div>
      ) : view === 'on' ? (
        <>
          <div className="ps-tg__status" data-tone="success" data-testid="push-status">Включены{server && server.devices > 1 ? ` · устройств: ${server.devices}` : ''}</div>
          <div className="ps-tg__acts">
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void test()} data-testid="push-test">Проверить</button>
            <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={() => void disable()} data-testid="push-disable">Выключить</button>
          </div>
        </>
      ) : (
        <p className="ps-tg__cap" data-testid="push-note">{PUSH_TEXT[view]}</p>
      )}
      {view !== 'loading' && view !== 'error' && (
        <label className="ps-pcheck ps-tg__shelved" data-testid="push-shelved">
          <input type="checkbox" checked={shelved} disabled={busy} onChange={(e) => void toggleShelved(e.target.checked)} />
          <span className="ps-check" data-checked={shelved || undefined} aria-hidden="true">{shelved && <Icon name="check" size={12} />}</span>
          <span>Напоминать раз в месяц об игре из «Отложено»</span>
        </label>
      )}
      <p className="ps-tg__cap" role="status" aria-live="polite" data-testid="push-msg">{msg}</p>
    </section>
  );
}
