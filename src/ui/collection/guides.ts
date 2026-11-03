// F2-A: ссылки-поиск гайдов по трофеям (PowerPyx, PSNProfiles). Без сети и БД: ссылки открывает браузер пользователя.

/** Название для поиска: без ™ ® ©, платформенных хвостов и скобок «(PlayStation®5)», «PS4 & PS5». */
export function guideQuery(title: string): string {
  let s = title.replace(/[™®©]/g, '').normalize('NFKC').replace(/[’‘`]/g, "'");
  s = s.replace(/\([^()]*(?:PlayStation|\bPS ?[45]\b|\bPS ?VR)[^()]*\)/gi, ' ');
  s = s.replace(/\s*[-–—|:]?\s*\b(?:PS ?[45](?:\s*(?:&|and|\/|и)\s*PS ?[45])?|PlayStation ?[45]|PS VR2?)\b\s*(?:Edition|Version|версия)?\s*$/i, '');
  s = s.replace(/[:;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || title.trim();
}

export type GuideLink = { id: 'powerpyx' | 'psnprofiles'; label: string; site: string; href: string };

export function guideLinks(title: string): GuideLink[] {
  const q = guideQuery(title);
  return [
    { id: 'powerpyx', label: 'PowerPyx', site: 'powerpyx.com', href: `https://www.powerpyx.com/?${new URLSearchParams({ s: `${q} trophy guide` })}` },
    { id: 'psnprofiles', label: 'PSNProfiles', site: 'psnprofiles.com', href: `https://psnprofiles.com/search/guides?${new URLSearchParams({ q })}` },
  ];
}

/** Хост ссылки для подписи («psnprofiles.com»); не разобралась — сама строка. */
export function guideSite(href: string): string {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; }
}
