// П14.2: чистая логика панели «Уведомления» (тестируется без браузера).
export type PushEnvInfo = { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | 'unsupported' };
export type PushView = 'loading' | 'error' | 'not_configured' | 'unsupported' | 'ios_install' | 'denied' | 'off' | 'on';

export function pushView(i: { server: { configured: boolean } | null; loadError: boolean; env: PushEnvInfo | null; subscribed: boolean | null }): PushView {
  if (i.loadError) return 'error';
  if (!i.server || !i.env || i.subscribed === null) return 'loading';
  if (!i.server.configured) return 'not_configured';
  // iPhone: Web Push только в приложении с экрана «Домой» (iOS 16.4+)
  if (i.env.ios && !i.env.standalone) return 'ios_install';
  if (!i.env.supported) return 'unsupported';
  if (i.env.permission === 'denied') return 'denied';
  return i.subscribed ? 'on' : 'off';
}

/** base64url открытого ключа VAPID → байты для applicationServerKey. */
export function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const PUSH_TEXT: Record<Exclude<PushView, 'loading' | 'error' | 'on' | 'off'>, string> = {
  not_configured: 'Уведомления пока не включены на сервере.',
  unsupported: 'Этот браузер не поддерживает уведомления.',
  ios_install: 'На iPhone уведомления работают в приложении с экрана «Домой»: в Safari нажми «Поделиться» → «На экран «Домой»», открой приложение оттуда и включи здесь.',
  denied: 'Уведомления запрещены. Разреши их в настройках: на iPhone — Настройки → Уведомления → PS Tracker.',
};
