import { describe, expect, it } from 'vitest';
import { STATIC_ASSET_CSP, baseSecurityHeaders, buildCsp, securityHeaders } from './security-headers';
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
    expect(get(h, 'Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(get(h, 'Cross-Origin-Resource-Policy')).toBe('same-origin');
  });
  it('next.config: без X-Powered-By', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  it('CSP: prod без eval, с запретом фреймов и объектов', () => {
    const csp = buildCsp();
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('img-src');
    expect(buildCsp({ dev: true })).toContain("'unsafe-eval'");
  });
  it('CSP с nonce: script-src без unsafe-inline, nonce на месте; без nonce прежний вариант', () => {
    const csp = buildCsp({ nonce: 'abc123==' });
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123=='");
    expect(script).not.toContain('unsafe-inline');
    expect(buildCsp({ nonce: 'x', dev: true })).toContain("'unsafe-eval'");
    expect(buildCsp().split('; ').find((d) => d.startsWith('script-src'))).toContain("'unsafe-inline'");
  });
  it('baseSecurityHeaders без CSP (его ставит proxy)', () => {
    expect(baseSecurityHeaders().map((x) => x.key)).not.toContain('Content-Security-Policy');
    expect(STATIC_ASSET_CSP).toContain("default-src 'none'");
  });
  it('next.config: базовые заголовки на все пути, строгий CSP на статике вне proxy', async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0]!.source).toBe('/:path*');
    expect(rules[0]!.headers.map((x) => x.key)).not.toContain('Content-Security-Policy');
    expect(rules[0]!.headers.map((x) => x.key)).toContain('Strict-Transport-Security');
    for (const r of rules.slice(1)) expect(r.headers).toEqual([{ key: 'Content-Security-Policy', value: STATIC_ASSET_CSP }]);
  });
});
