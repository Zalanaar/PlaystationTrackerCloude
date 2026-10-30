import type { Metadata } from 'next';
import { LoginForm } from '@/ui/access/LoginForm';

export const metadata: Metadata = { title: 'Вход · PS Tracker' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <LoginForm error={one(q.error)} next={one(q.next)} />;
}
