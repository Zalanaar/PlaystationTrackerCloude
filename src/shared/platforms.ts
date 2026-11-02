// Фаза 44 (design-system §19c.4.1): варианты выбора платформы в строке результата. Чистые функции, без env/БД/сети.

/** Длина подписи платформы (колонка platform_label, контракт 44.2). */
export const PLATFORM_LABEL_MAX = 60;
/** Значение последней опции «Не указывать» (подпись не сохраняется). */
export const PLATFORM_NONE = '';

export type PlatformOption = { value: string; label: string };
export type PlatformChoice = { options: PlatformOption[]; defaultValue: string; /** платформ в ответе RAWG нет */ empty: boolean };

const PS_RE = /playstation|\bps\s?\d\b|\bps vita\b|\bpsp\b/i;
export const isPlaystationName = (name: string): boolean => PS_RE.test(name);

/** Подпись в колонку БД: trim, без `<` `>` и управляющих символов, не длиннее 60 символов. */
export function clampPlatformLabel(raw: string): string {
  const clean = raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > PLATFORM_LABEL_MAX ? clean.slice(0, PLATFORM_LABEL_MAX).trimEnd() : clean;
}

/**
 * Опции выбора: сначала НЕ PlayStation, затем PlayStation (порядок RAWG внутри групп), в конце «Не указывать».
 * По умолчанию: единственная платформа; иначе первая не-PlayStation, иначе первая PlayStation; платформ нет: «Не указана».
 */
export function platformOptions(platforms: readonly string[]): PlatformChoice {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of platforms) {
    const label = clampPlatformLabel(p);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    names.push(label);
  }
  if (names.length === 0) return { options: [{ value: PLATFORM_NONE, label: 'Не указана' }], defaultValue: PLATFORM_NONE, empty: true };
  const other = names.filter((n) => !isPlaystationName(n));
  const ps = names.filter(isPlaystationName);
  const ordered = [...other, ...ps];
  return {
    options: [...ordered.map((n) => ({ value: n, label: n })), { value: PLATFORM_NONE, label: 'Не указывать' }],
    defaultValue: names.length === 1 ? names[0] : ordered[0],
    empty: false,
  };
}
