// Фаза 17.1 (контракт 20.7): аватар PSN приходит по http на хостах PSN; повышаем до https, чужие не-https отбрасываем.
import { describe, expect, it } from 'vitest';
import { mapProfile, psnAvatarUrl } from './mapping';

const profile = (avatarUrls: unknown) => ({ profile: { onlineId: 'Artem_PS', avatarUrls } });

describe('psnAvatarUrl', () => {
  it('http на хостах PSN повышается до https', () => {
    expect(psnAvatarUrl('http://static-resource.np.community.playstation.net/avatar_xl/WWS_A/UP0001_x.png')).toBe(
      'https://static-resource.np.community.playstation.net/avatar_xl/WWS_A/UP0001_x.png',
    );
    expect(psnAvatarUrl('http://image.api.playstation.com/a.png')).toBe('https://image.api.playstation.com/a.png');
    expect(psnAvatarUrl('HTTP://Static-Resource.NP.Community.PlayStation.NET/a.png')).toBe('https://static-resource.np.community.playstation.net/a.png');
  });
  it('https остаётся как есть', () => {
    expect(psnAvatarUrl('https://a.example/x.png')).toBe('https://a.example/x.png');
  });
  it('чужие http, похожие хосты, чужие схемы и мусор отбрасываются', () => {
    for (const v of [
      'http://a.example/x.png',
      'http://evilplaystation.net/x.png',
      'http://playstation.net.evil.com/x.png',
      'http://playstation.net@evil.com/x.png',
      'javascript:alert(1)',
      'ftp://static-resource.np.community.playstation.net/a.png',
      '//static-resource.np.community.playstation.net/a.png',
      '',
      '   ',
      null,
      undefined,
      42,
    ]) expect(psnAvatarUrl(v), String(v)).toBeNull();
  });
});

describe('mapProfile: аватар', () => {
  it('реальная форма profile2: http-адреса всех размеров -> берётся самый крупный, https', () => {
    const base = 'http://static-resource.np.community.playstation.net/avatar';
    const p = mapProfile(profile([
      { size: 's', avatarUrl: `${base}_s/a.png` },
      { size: 'xl', avatarUrl: `${base}_xl/a.png` },
      { size: 'm', avatarUrl: `${base}_m/a.png` },
    ]));
    expect(p?.avatarUrl).toBe('https://static-resource.np.community.playstation.net/avatar_xl/a.png');
  });
  it('крупный размер с чужим http пропускается, берётся следующий допустимый', () => {
    const p = mapProfile(profile([
      { size: 'xl', avatarUrl: 'http://evil.example/xl.png' },
      { size: 'l', avatarUrl: 'http://static-resource.np.community.playstation.net/l.png' },
    ]));
    expect(p?.avatarUrl).toBe('https://static-resource.np.community.playstation.net/l.png');
  });
  it('нет avatarUrls / пусто / мусор: null, профиль остаётся', () => {
    for (const a of [undefined, [], 'x', [null, 5, { size: 'xl' }]]) expect(mapProfile(profile(a))?.avatarUrl, JSON.stringify(a)).toBeNull();
    expect(mapProfile(profile(undefined))?.onlineId).toBe('Artem_PS');
  });
});
