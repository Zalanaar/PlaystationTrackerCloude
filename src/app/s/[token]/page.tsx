import type { Metadata } from 'next';
import { ShowcaseView } from '@/ui/showcase/ShowcaseView';
import '@/ui/styles/showcase.css';

// П14.3: публичная витрина по ссылке с ключом, без входа. Данные грузит клиент из /api/showcase/<ключ> (страницы в БД не ходят, контракт 22.12).
// noindex и no-referrer — в метаданных и заголовками из proxy.ts.
export const metadata: Metadata = { title: 'Витрина · PS Tracker', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };

export default async function ShowcasePage({ params }: { params: Promise<{ token: string }> }) {
  return <ShowcaseView token={(await params).token} />;
}
