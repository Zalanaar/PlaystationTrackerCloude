import { Icon } from '../icons';

/** Спиннер профилей: вращающийся loader; при prefers-reduced-motion CSS показывает статичную иконку refresh (§17.2). */
export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span className="ps-pswitch-spin" aria-hidden="true">
      <Icon name="loader" size={size} className="ps-pswitch-spin__a" />
      <Icon name="refresh" size={size} className="ps-pswitch-spin__b" />
    </span>
  );
}
