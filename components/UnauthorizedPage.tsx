'use client';

import { signOut } from 'next-auth/react';

interface Props {
  email?: string | null;
}

export function UnauthorizedPage({ email }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-100 mb-4">
          <span className="text-2xl">🔒</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Accès non autorisé</h1>
        <p className="text-slate-500 text-sm mb-1">
          Le compte <span className="font-medium text-slate-700">{email}</span> n&apos;est pas configuré pour accéder à cet outil.
        </p>
        <p className="text-slate-400 text-sm mb-6">
          Contactez votre administrateur pour obtenir l&apos;accès.
        </p>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-sm text-slate-500 hover:text-slate-700 underline transition"
        >
          Se connecter avec un autre compte
        </button>
      </div>
    </div>
  );
}
