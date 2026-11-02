import { Icon } from '../icons';

/**
 * Пометка «Не куплено» (design-system §19.2). Прямоугольная плашка с тележкой, пунктирная рамка, без фигур статусов.
 * cover: на обложке карточки; inline: в строке, окне и листе; icon: плотный режим, только иконка с подписью.
 */
export function NotPurchasedBadge({ variant = 'inline' }: { variant?: 'cover' | 'inline' | 'icon' }) {
  if (variant === 'icon') {
    return (
      <span className="ps-nb ps-nb--cover ps-nb--icon" data-testid="not-purchased" role="img" aria-label="Не куплено" title="Не куплено">
        <Icon name="shopping-cart" size={12} />
      </span>
    );
  }
  return (
    <span className={variant === 'cover' ? 'ps-nb ps-nb--cover' : 'ps-nb'} data-testid="not-purchased">
      <Icon name="shopping-cart" size={12} />
      <span>Не куплено</span>
    </span>
  );
}
