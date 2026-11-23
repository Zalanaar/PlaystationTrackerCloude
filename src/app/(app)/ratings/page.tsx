import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Оценки · PS Tracker' };

/** Старый адрес «Мои оценки» — в раздел «Оценки» Статистики. */
export default function Page() {
  redirect('/stats?sec=ratings');
}
