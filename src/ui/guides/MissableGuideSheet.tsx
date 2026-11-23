'use client';

// Лист «Не пропусти» после перевода в «Играю»: только ссылки на сопоставленный или свой гайд, без текста гайда.
import { useEffect, useState } from 'react';
import type { GameGuide } from '@/server/collection/types';
import { fetchGameGuide } from '../collection/api';
import { Sheet } from '../primitives/Sheet';
import '../styles/missable.css';
import { startGuideLinks, type StartGuideLink } from './links';
import type { PlayingGame } from './startPlaying';

type View = { kind: 'loading' } | { kind: 'links'; links: StartGuideLink[] } | { kind: 'none' };

export function MissableGuideSheet({ game, onClose }: { game: PlayingGame; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'loading' });

  useEffect(() => {
    const ac = new AbortController();
    fetchGameGuide(game.id, ac.signal).then(
      (g: GameGuide) => {
        if (ac.signal.aborted) return;
        const links = startGuideLinks(g);
        setView(links.length ? { kind: 'links', links } : { kind: 'none' });
        if (!links.length) onClose();
      },
      () => { if (!ac.signal.aborted) { setView({ kind: 'none' }); onClose(); } },
    );
    return () => ac.abort();
  }, [game.id, onClose]);

  if (view.kind !== 'links') return null;

  return (
    <Sheet open onClose={onClose} title="Не пропусти" className="ps-missable">
      <div className="ps-missable__body" data-testid="missable-guide">
        <p className="ps-missable__lead">
          Когда начинаешь «{game.title}», загляни в гайд — там обычно отмечают трофеи, которые легко упустить в начале.
        </p>
        <div className="ps-missable__acts">
          {view.links.map((l) => (
            <a key={l.id} className="ps-btn ps-btn--primary" href={l.href} target="_blank" rel="noopener noreferrer" data-testid={`missable-link-${l.id}`}>
              {l.label}
            </a>
          ))}
          <button type="button" className="ps-btn ps-btn--ghost" onClick={onClose} data-testid="missable-later">Позже</button>
        </div>
      </div>
    </Sheet>
  );
}
