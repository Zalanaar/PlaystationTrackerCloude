import { describe, expect, it } from 'vitest';
import { buildCsp, securityHeaders } from './security-headers';
import nextConfig from '../../next.config';

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value;

describe('security headers', () => {
  it('набор заголовков', () => {
    const h = securityHeaders();
    expect(get(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(h, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(get(h, 'X-Frame-Options')).toBe('DENY');
    expect(get(h, 'Permissions-Policy')).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    expect(get(h, 'Strict-Transport-Security')).toMatch(/max-age=\d+/);
  });
  it('CSP: prod без eval, с запретом фреймов и объектов', () => {
    const csp = buildCsp();
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('img-src');
    expect(buildCsp({ dev: true })).toContain("'unsafe-eval'");
  });
  it('next.config отдаёт заголовки для всех путей, в том числе /api', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe('/:path*');
    expect(rules[0]!.headers.map((x) => x.key)).toContain('Content-Security-Policy');
  });
});
