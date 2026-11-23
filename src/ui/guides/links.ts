// Ссылки «Не пропусти» при старте игры: только сопоставленный или свой гайд, без поисковых ссылок и без текста гайда.
import type { GameGuide } from '@/server/collection/types';

export type StartGuideLink = { id: 'guide' | 'wiki' | 'own'; label: string; href: string };

export function startGuideLinks(guide: GameGuide | null | undefined): StartGuideLink[] {
  if (!guide) return [];
  if (guide.override) return [{ id: 'own', label: 'Открыть гайд', href: guide.override }];
  const out: StartGuideLink[] = [];
  if (guide.match?.url) out.push({ id: 'guide', label: 'Гайд по трофеям', href: guide.match.url });
  if (guide.match?.wikiUrl) out.push({ id: 'wiki', label: 'Вики', href: guide.match.wikiUrl });
  return out;
}
