// t160u: панель «Добавить игру с другой платформы» живёт в CollectionView (шапка «+», меню «…»), блок внизу хроники
// может быть не отрисован (фильтры). Добавленные записи блок получает событием; без React-контекста и без кода блока в чанке страницы.
import type { OtherPlatformGame } from './api';

export const OTHER_ADDED_EVENT = 'ps:other-platform-added';

export function emitOtherAdded(items: readonly OtherPlatformGame[]): void {
  window.dispatchEvent(new CustomEvent<readonly OtherPlatformGame[]>(OTHER_ADDED_EVENT, { detail: items }));
}

export function onOtherAdded(handler: (items: readonly OtherPlatformGame[]) => void): () => void {
  const on = (e: Event) => handler((e as CustomEvent<readonly OtherPlatformGame[]>).detail);
  window.addEventListener(OTHER_ADDED_EVENT, on);
  return () => window.removeEventListener(OTHER_ADDED_EVENT, on);
}
