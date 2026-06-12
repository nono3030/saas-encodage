'use client';

import { useState, useEffect, useRef } from 'react';
import type { SfmcTemplate, ProgressEvent, ProcessResult } from '@/lib/types';

export function ProcessForm() {
  const [docUrl, setDocUrl] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<SfmcTemplate[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [copiedCta, setCopiedCta] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const CTA_SNIPPET = '[CTA: Texte du bouton | https://votre-lien.com | text:#ffffff | bg:#E30613]';

  function copyCta() {
    navigator.clipboard.writeText(CTA_SNIPPET);
    setCopiedCta(true);
    setTimeout(() => setCopiedCta(false), 2000);
  }

  useEffect(() => {
    fetch('/api/templates')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setTemplates(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('loading');
    setLogs([]);
    setProgress(0);
    setResult(null);

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docUrl, assetName: assetName || undefined, assetId: assetId || undefined, templateId: templateId || undefined }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event: ProgressEvent = JSON.parse(line.slice(6));
            if (event.type === 'log') {
              if (event.message) setLogs(prev => [...prev, event.message!]);
              if (event.progress !== undefined) setProgress(event.progress);
            } else if (event.type === 'result' && event.data) {
              setResult(event.data);
              setStatus('done');
            } else if (event.type === 'error') {
              setLogs(prev => [...prev, `ERREUR : ${event.message}`]);
              setStatus('error');
            }
          } catch {}
        }
      }

      if (status === 'loading') setStatus('done');

    } catch (err) {
      setLogs(prev => [...prev, `ERREUR : ${(err as Error).message}`]);
      setStatus('error');
    }
  }

  function copyHtml() {
    if (result?.previewHtml) {
      navigator.clipboard.writeText(result.previewHtml);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2000);
    }
  }

  const isProcessing = status === 'loading';

  return (
    <div className="space-y-5">
      {/* Form card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-5">Traiter un document</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Doc URL */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              URL du Google Doc <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              required
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              disabled={isProcessing}
              placeholder="https://docs.google.com/document/d/..."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 disabled:bg-slate-50"
            />
          </div>

          {/* Asset name + ID row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nom du bloc</label>
              <input
                type="text"
                value={assetName}
                onChange={e => setAssetName(e.target.value)}
                disabled={isProcessing}
                placeholder="Newsletter S23"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 disabled:bg-slate-50"
              />
              <p className="text-xs text-slate-400 mt-1">Préfixe YYYYMMDD ajouté auto.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ID Asset <span className="text-slate-400 font-normal">(mise à jour)</span>
              </label>
              <input
                type="text"
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                disabled={isProcessing}
                placeholder="Ex : 736215"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 disabled:bg-slate-50"
              />
              <p className="text-xs text-slate-400 mt-1">Laissez vide pour créer.</p>
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Template SFMC <span className="text-slate-400 font-normal">(optionnel)</span>
            </label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              disabled={isProcessing}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50 disabled:bg-slate-50 bg-white"
            >
              <option value="">— Aucun template —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* CTA snippet helper */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <div className="min-w-0 flex-1 mr-3">
              <p className="text-xs font-medium text-slate-600 mb-0.5">Snippet bouton CTA</p>
              <code className="text-xs text-slate-400 truncate block">{CTA_SNIPPET}</code>
            </div>
            <button
              type="button"
              onClick={copyCta}
              className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition font-medium"
            >
              {copiedCta ? '✅ Copié' : '📋 Copier'}
            </button>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isProcessing || !docUrl}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Spinner />
                Traitement en cours…
              </>
            ) : '✨ Traiter & Pousser vers SFMC'}
          </button>
        </form>
      </div>

      {/* Progress */}
      {(isProcessing || status === 'done' || status === 'error') && logs.length > 0 && (
        <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Journal</span>
            {isProcessing && (
              <span className="text-xs text-emerald-400">{progress}%</span>
            )}
          </div>
          {/* Progress bar */}
          {(isProcessing || status === 'done') && (
            <div className="h-1 bg-slate-700">
              <div
                className="h-1 bg-emerald-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          <div ref={logRef} className="p-4 h-48 overflow-y-auto space-y-0.5">
            {logs.map((line, i) => (
              <p key={i} className={`log-line ${line.startsWith('ERREUR') ? 'text-red-400' : 'text-slate-300'}`}>
                {line}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {status === 'done' && result?.success && (
        <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5">
          <div className="flex items-start gap-3">
            <div className="text-emerald-500 text-xl mt-0.5">✅</div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800">Bloc créé avec succès !</p>
              <p className="text-sm text-slate-500 mt-0.5">
                <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">{result.assetName}</span>
              </p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-sm text-slate-600">Asset ID :</span>
                <code className="font-mono text-sm bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded border border-emerald-200 select-all">
                  {result.assetId}
                </code>
                <span className="text-xs text-slate-400">← conservez cet ID pour les mises à jour</span>
              </div>
            </div>
          </div>
          {result.previewHtml && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={copyHtml}
                className="text-sm text-slate-600 hover:text-slate-800 transition flex items-center gap-1.5"
              >
                {copiedHtml ? '✅ Copié !' : '📋 Copier le HTML généré'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  );
}
