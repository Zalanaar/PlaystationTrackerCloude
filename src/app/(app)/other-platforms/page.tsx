import { redirect } from 'next/navigation';

// Пакет 5: отдельного экрана больше нет; игры с других платформ — блок в самом низу Коллекции (старые ссылки и закладки ведут туда).
export default function Page() {
  redirect('/');
}
