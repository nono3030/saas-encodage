export const dynamic = 'force-dynamic';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAuthorizedDomain } from '@/lib/tenants';
import { SignInPage } from '@/components/SignInPage';
import { AppShell } from '@/components/AppShell';
import { UnauthorizedPage } from '@/components/UnauthorizedPage';

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session) return <SignInPage />;

  if (!isAuthorizedDomain(session.user?.email || '')) {
    return <UnauthorizedPage email={session.user?.email} />;
  }

  return <AppShell user={session.user} />;
}
