'use client';

// П15.6: результат проверки доступа к профилю PSN (шаг «Ник» онбординга).
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { checkActions, type Action, type CheckResult } from './model';

type Tone = 'danger' | 'warning' | 'success';
const CHECK_VIEW: Partial<Record<CheckResult['kind'], { tone: Tone; icon: IconName }>> = {
  ok: { tone: 'success', icon: 'check-circle' },
  psn_not_found: { tone: 'danger', icon: 'user-x' },
  psn_private: { tone: 'warning', icon: 'lock' },
  psn_friend_required: { tone: 'warning', icon: 'user-plus' },
  psn_account_locked: { tone: 'danger', icon: 'shield-alert' },
  psn_id_taken: { tone: 'danger', icon: 'users' },
  rate_limited: { tone: 'warning', icon: 'timer' },
  psn_unavailable: { tone: 'warning', icon: 'cloud-off' },
  network: { tone: 'danger', icon: 'circle-alert' },
  config_error: { tone: 'danger', icon: 'circle-alert' },
};

function CheckBody({ r, nick, left }: { r: CheckResult; nick: string; left: number }): { title: ReactNode; text?: ReactNode; steps?: string[]; sr?: string } {
  switch (r.kind) {
    case 'ok': return { title: `Доступ есть. Нашли профиль @${nick}` };
    case 'psn_not_found': return { title: 'Профиль не найден', text: 'Проверьте, нет ли опечатки в нике PSN.' };
    case 'psn_private':
      return {
        title: 'Профиль закрыт',
        text: 'Откройте игры и трофеи в настройках приватности PlayStation, затем нажмите «Проверить снова».',
        steps: ['Откройте PlayStation: Настройки → Друзья и аккаунты → Приватность', 'Игры и трофеи: «Все»', 'Вернитесь сюда'],
      };
    case 'psn_friend_required':
      return { title: 'Профиль виден только друзьям', text: 'Добавьте в друзья технический аккаунт сайта или откройте профиль, затем нажмите «Проверить снова».' };
    case 'psn_account_locked':
      return { title: 'Этот ник относится к другому аккаунту', text: 'В вашей коллекции уже есть игры. Укажите прежний ник или обратитесь к владельцу сайта.' };
    case 'psn_id_taken': return { title: 'Этот ник уже занят', text: 'Другой пользователь сайта использует этот ник. Проверьте написание или обратитесь к владельцу.' };
    case 'rate_limited':
      return {
        title: 'Слишком часто',
        text: left > 0 ? <>Повторить можно через <span aria-hidden="true">{left}</span> с.</> : 'Можно повторить проверку.',
        sr: 'Слишком часто. Повторите проверку чуть позже.',
      };
    case 'psn_unavailable': return { title: 'PlayStation сейчас не отвечает', text: 'Это не ошибка в нике. Попробуйте через минуту.' };
    case 'config_error': return { title: 'Подключение не настроено', text: 'На сервере не настроено подключение к PlayStation. Сообщите владельцу сайта.' };
    default: return { title: 'Не удалось связаться с сайтом', text: 'Попробуйте ещё раз.' };
  }
}

export function CheckResultBlock({ r, nick, left, refEl }: { r: CheckResult; nick: string; left: number; refEl: React.RefObject<HTMLDivElement | null> }) {
  if (r.kind === 'checking') {
    return (
      <div className="ps-ob__result" role="status" aria-busy="true" data-testid="ob-checking">
        <Icon name="loader" size={24} className="ps-ob__spin" />
        <div className="ps-ob__rbody">
          <p className="ps-ob__rtitle">Проверяем доступ…</p>
          <p className="ps-ob__rtext">Это занимает несколько секунд</p>
        </div>
      </div>
    );
  }
  const v = CHECK_VIEW[r.kind] ?? CHECK_VIEW.network!;
  const b = CheckBody({ r, nick, left });
  const isErr = r.kind !== 'ok';
  return (
    <div
      className="ps-ob__result" data-tone={v.tone} data-testid={`ob-result-${r.kind}`} ref={refEl} tabIndex={-1}
      role={isErr ? 'alert' : 'status'}
    >
      <Icon name={v.icon} size={24} />
      <div className="ps-ob__rbody">
        <p className="ps-ob__rtitle">{b.title}</p>
        {b.text && <p className="ps-ob__rtext">{b.text}</p>}
        {b.steps && <ol className="ps-ob__list">{b.steps.map((s) => <li key={s}>{s}</li>)}</ol>}
      </div>
    </div>
  );
}

export function CheckActions({ r, left, onAct }: { r: CheckResult; left: number; onAct: (a: Action) => void }) {
  const { primary, ghost } = checkActions(r.kind);
  const busy = r.kind === 'checking';
  const label = (a: Action) => {
    if (a === 'recheck') return r.kind === 'rate_limited' && left > 0 ? `Проверить снова (${left})` : 'Проверить снова';
    return a === 'edit' ? 'Изменить ник' : 'Дальше: загрузить игры';
  };
  const dis = (a: Action) => busy || (a === 'recheck' && r.kind === 'rate_limited' && left > 0);
  if (!primary && !ghost) return busy ? <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" disabled>Проверить снова</button></div> : null;
  return (
    <div className="ps-ob__acts">
      {primary && <button type="button" className="ps-btn ps-btn--primary" disabled={dis(primary)} onClick={() => onAct(primary)}>{label(primary)}</button>}
      {ghost && <button type="button" className="ps-btn ps-btn--ghost" disabled={dis(ghost)} onClick={() => onAct(ghost)}>{label(ghost)}</button>}
    </div>
  );
}
