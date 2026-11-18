import { describe, expect, it } from 'vitest';
import { keyBytes, pushView, type PushEnvInfo } from './model';

const env = (o: Partial<PushEnvInfo> = {}): PushEnvInfo => ({ supported: true, ios: false, standalone: false, permission: 'default', ...o });
const srv = { configured: true };

describe('push: вид панели', () => {
  it('порядок проверок', () => {
    expect(pushView({ server: null, loadError: false, env: null, subscribed: null })).toBe('loading');
    expect(pushView({ server: null, loadError: true, env: null, subscribed: null })).toBe('error');
    expect(pushView({ server: { configured: false }, loadError: false, env: env(), subscribed: false })).toBe('not_configured');
    expect(pushView({ server: srv, loadError: false, env: env({ ios: true, supported: false }), subscribed: false })).toBe('ios_install');
    expect(pushView({ server: srv, loadError: false, env: env({ ios: true, standalone: true }), subscribed: false })).toBe('off');
    expect(pushView({ server: srv, loadError: false, env: env({ supported: false }), subscribed: false })).toBe('unsupported');
    expect(pushView({ server: srv, loadError: false, env: env({ permission: 'denied' }), subscribed: false })).toBe('denied');
    expect(pushView({ server: srv, loadError: false, env: env({ permission: 'granted' }), subscribed: true })).toBe('on');
  });
  it('ключ VAPID base64url → 65 байт, первый 0x04', () => {
    const b = keyBytes('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U');
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4);
  });
});
