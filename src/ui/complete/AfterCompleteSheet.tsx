'use client';
// Идея 3: лист после «Пройдено». Оценка и заметка (тот же редактор, что в окне игры) и «что дальше»
// из целей месяца и Плана: «Начать» ставит следующей игре «Играю» одним касанием.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DiaryEntry } from '@/shared/diary';
import type { GameReview } from '@/server/collection/types';
import { errorText, fetchGameDetails, putStatus } from '../collection/api';
import { Cover } from '../collection/Cover';
import { ReviewEditor } from '../collection/dialog/ReviewEditor';
import { DiaryEditor } from '../diary/DiaryEditor';
import { formatHoursApprox } from '../format';
import { Sheet } from '../primitives/Sheet';
import { useToast } from '../primitives/Toast';
import { fetchMonthGoals } from '../goals/api';
import { fetchRoadmap } from '../roadmap/api';
import { requestDataRefresh } from '../shell/refresh';
import { announcePlaying } from '../guides/startPlaying';
import { nextFromPlan, type CompletedGame, type NextUp } from './afterComplete';

type Review = { kind: 'loading' } | { kind: 'ok'; review: GameReview | null; diary: DiaryEntry[] } | { kind: 'error' };

export function AfterCompleteSheet({ game, onClose }: { game: CompletedGame; onClose: () => void }) {
  const toast = useToast();
  const [review, setReview] = useState<Review>({ kind: 'loading' });
  /** undefined — грузится, null — в Плане пусто, 'error' — План не загрузился (блок не показываем) */
  const [next, setNext] = useState<NextUp | null | undefined | 'error'>(undefined);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    // текущая заметка нужна до правки: иначе сохранение оценки затёрло бы её пустой
    fetchGameDetails(game.id, ac.signal).then((d) => setReview({ kind: 'ok', review: d.review ?? null, diary: d.diary ?? [] }), () => { if (!ac.signal.aborted) setReview({ kind: 'error' }); });
    Promise.all([
      fetchRoadmap(ac.signal),
      fetchMonthGoals(ac.signal).catch(() => null),
    ]).then(([r, g]) => {
      if (!ac.signal.aborted) setNext(nextFromPlan(r, game.id, g?.picked ?? []));
    }, () => { if (!ac.signal.aborted) setNext('error'); });
    return () => ac.abort();
  }, [game.id]);

  const close = () => { if (changed) requestDataRefresh('change'); onClose(); };

  async function start(n: NextUp) {
    setBusy(true);
    try {
      await putStatus(n.gameId, 'playing');
      announcePlaying({ id: n.gameId, title: n.title });
      toast({ text: `«${n.title}»: Играю` });
      requestDataRefresh('change');
      onClose();
    } catch (e) {
      setBusy(false);
      toast({ kind: 'error', text: `Не удалось начать игру. ${errorText(e)}` });
    }
  }

  return (
    <Sheet open onClose={close} title={`Пройдено: ${game.title}`} className="ps-done" busy={busy}>
      <div className="ps-done__body" data-testid="after-complete">
        <p className="ps-done__lead">Оцени, пока свежо: оценки попадают в «Итоги года» и помогают «Подскажи».</p>
        {review.kind === 'loading' && <div className="ps-done__ph" aria-busy="true" aria-label="Загружаю оценку" />}
        {review.kind === 'error' && <p className="ps-done__lead" role="status">Оценку можно поставить в окне игры: сейчас не удалось её загрузить.</p>}
        {review.kind === 'ok' && (
          <div className="ps-done__review">
            <ReviewEditor key={game.id} game={game} review={review.review} onChanged={() => setChanged(true)} withNote={false} />
            <DiaryEditor key={`diary-${game.id}`} gameId={game.id} entries={review.diary} onChanged={() => setChanged(true)} />
          </div>
        )}

        {next !== 'error' && <section className="ps-done__next" aria-labelledby="ps-done-next" data-testid="after-complete-next">
          <h3 id="ps-done-next">Что дальше</h3>
          {next === undefined && <div className="ps-done__ph ps-done__ph--row" aria-busy="true" aria-label="Загружаю, во что играть дальше" />}
          {next === null && <p className="ps-done__lead">В целях месяца и Плане нет следующей игры. <Link href="/backlog" onClick={close}>Выбрать в бэклоге</Link></p>}
          {next && (
            <div className="ps-done__row">
              <Cover url={next.coverUrl} title={next.title} className="ps-done__cover" w={40} />
              <span className="ps-done__txt">
                <b>{next.title}</b>
                <small>{next.source === 'month_goal'
                  ? (next.hours !== null && next.hours > 0 ? `Цель месяца · осталось ${formatHoursApprox(next.hours)}` : 'Цель месяца')
                  : (next.hours !== null && next.hours > 0 ? `Следующая в Плане · осталось ${formatHoursApprox(next.hours)}` : 'Следующая в Плане')}</small>
              </span>
              <button type="button" className="ps-btn ps-btn--primary" disabled={busy} onClick={() => void start(next)} data-testid="after-complete-start">Начать</button>
            </div>
          )}
        </section>}

        <div className="ps-done__foot">
          <Link href="/roadmap" className="ps-btn ps-btn--ghost" onClick={close}>Открыть План</Link>
          <button type="button" className="ps-btn" onClick={close} data-testid="after-complete-done">Готово</button>
        </div>
      </div>
    </Sheet>
  );
}
