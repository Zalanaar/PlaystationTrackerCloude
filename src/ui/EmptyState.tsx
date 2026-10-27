import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function EmptyState({
  icon, title, text, children, role,
}: { icon: IconName | ReactNode; title: string; text?: string; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className="ps-empty" role={role}>
      <span className="ps-empty__icon">{typeof icon === 'string' ? <Icon name={icon as IconName} size={40} /> : icon}</span>
      <h2 className="ps-h2">{title}</h2>
      {text && <p className="ps-empty__text">{text}</p>}
      {children}
    </div>
  );
}
