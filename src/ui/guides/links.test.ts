import { describe, expect, it } from 'vitest';
import { startGuideLinks } from './links';

const match = { title: 'Hades', url: 'https://www.powerpyx.com/hades-trophy-guide-roadmap/', wikiUrl: 'https://www.powerpyx.com/hades-wiki/' as string | null };

describe('ссылки «Не пропусти»', () => {
  it('своя ссылка важнее совпадения; без гайда — пусто', () => {
    expect(startGuideLinks(null)).toEqual([]);
    expect(startGuideLinks({ match: null, override: null, dismissed: false })).toEqual([]);
    expect(startGuideLinks({ match, override: null, dismissed: false })).toEqual([
      { id: 'guide', label: 'Гайд по трофеям', href: match.url },
      { id: 'wiki', label: 'Вики', href: match.wikiUrl! },
    ]);
    expect(startGuideLinks({ match: { ...match, wikiUrl: null }, override: null, dismissed: false })).toEqual([
      { id: 'guide', label: 'Гайд по трофеям', href: match.url },
    ]);
    expect(startGuideLinks({ match, override: 'https://example.com/my', dismissed: false })).toEqual([
      { id: 'own', label: 'Открыть гайд', href: 'https://example.com/my' },
    ]);
  });
});
