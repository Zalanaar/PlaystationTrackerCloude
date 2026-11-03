import type { Metadata } from 'next';
import { TriageView } from '@/ui/triage/TriageView';

export const metadata: Metadata = { title: 'Разбор · PS Tracker' };

export default function Page() {
  // Фаза 48 (п. 15): у экрана не было h1 (BUG-QA-05); заголовок для скринридеров, визуально экран не меняется
  return (
    <>
      <h1 className="ps-sr">Разбор</h1>
      <TriageView />
    </>
  );
}
