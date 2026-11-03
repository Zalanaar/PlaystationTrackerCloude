import { describe, expect, it } from 'vitest';
import { clientIp } from './http';

const req = (h: Record<string, string>) => new Request('https://x.test/', { headers: h });

describe('clientIp (повторный аудит P2-10)', () => {
  it('x-vercel-forwarded-for важнее x-forwarded-for, который клиент может прислать сам', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 1.1.1.1', 'x-vercel-forwarded-for': '1.1.1.1' }))).toBe('1.1.1.1');
  });
  it('затем x-real-ip, затем первый адрес x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientIp(req({ 'x-forwarded-for': ' 3.3.3.3 , 4.4.4.4' }))).toBe('3.3.3.3');
  });
  it('без заголовков — unknown, длина ограничена', () => {
    expect(clientIp(req({}))).toBe('unknown');
    expect(clientIp(req({ 'x-vercel-forwarded-for': 'a'.repeat(100) }))).toHaveLength(64);
  });
});
