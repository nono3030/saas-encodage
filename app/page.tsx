'use client';

import { useSession } from 'next-auth/react';
import { SignInPage } from '@/components/SignInPage';
import { AppShell } from '@/components/AppShell';
import { UnauthorizedPage } from '@/components/UnauthorizedPage';

export default function Home() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return <SignInPage />;
  if (!session.isAuthorized) return <UnauthorizedPage email={session.user?.email} />;
  return <AppShell user={session.user} />;
}
