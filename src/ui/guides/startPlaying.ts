// Когда игра переходит в «Играю», приложение показывает «Не пропусти» со ссылками на сопоставленный гайд.
export const PLAYING_EVENT = 'ps:playing';

export type PlayingGame = { id: number; title: string };

export function announcePlaying(game: PlayingGame): boolean {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<PlayingGame>(PLAYING_EVENT, { detail: { id: game.id, title: game.title } }));
  return true;
}
