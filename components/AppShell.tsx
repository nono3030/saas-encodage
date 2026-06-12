'use client';

import { signOut } from 'next-auth/react';
import Image from 'next/image';
import { ProcessForm } from './ProcessForm';

interface Props {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function AppShell({ user }: Props) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-sm">✨</div>
          <span className="font-semibold text-slate-800">SFMC Companion</span>
        </div>
        <div className="flex items-center gap-3">
          {user?.image && (
            <Image
              src={user.image}
              alt={user.name || ''}
              width={30}
              height={30}
              className="rounded-full"
            />
          )}
          <span className="text-sm text-slate-600 hidden sm:block">{user?.name || user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-sm text-slate-400 hover:text-slate-600 transition"
          >
            Déconnexion
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <ProcessForm />
        </div>
      </main>
    </div>
  );
}
