'use client';

// Kwik — emergency-call intake, practiced on real calls.
// State lives HERE (persisted to localStorage); the API is stateless.
// The AI always identifies itself as a demo — never the real 112.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntakeResult, PracticeCall } from '@/lib/types.ts';

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-400 text-black',
  LOW: 'bg-zinc-500 text-white',
  UNKNOWN: 'bg-zinc-700 text-zinc-300',
};
const LOCALES = ['hi', 'en-IN', 'ta', 'te', 'bn', 'mr', 'kn', 'pa'];
const POLL_MS = 4000;
const LS_KEY = 'kwik-practice-v1';

export default function Console() {
  const [calls, setCalls] = useState<PracticeCall[]>([]);
  const [calleConfigured, setCalleConfigured] = useState(false);
  const [testerMasked, setTesterMasked] = useState<string | null>(null);
  const [locale, setLocale] = useState('hi');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<PracticeCall | null>(null);
  const [inFlight, setInFlight] = useState<PracticeCall | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callsRef = useRef<PracticeCall[]>([]);
  useEffect(() => { callsRef.current = calls; }, [calls]);

  const persist = useCallback((next: PracticeCall[]) => {
    setCalls(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setCalls(JSON.parse(raw));
    } catch { /* fresh */ }
    setPin(sessionStorage.getItem('kwr-pin') ?? '');
    fetch('/api/practice').then((x) => x.json()).then((x) => {
      setCalleConfigured(Boolean(x.calleConfigured));
      setTesterMasked(x.testerMasked ?? null);
    }).catch(() => {});
  }, []);

  // poll in-flight call until terminal
  useEffect(() => {
    if (!inFlight?.calleCallId) return;
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/practice/${inFlight.id}?callId=${encodeURIComponent(inFlight.calleCallId!)}`);
      const data = await res.json().catch(() => null);
      if (!alive || !data) return;
      if (data.phase === 'DONE') {
        const result = data.result as IntakeResult;
        // local deterministic grading — the agent's read is input, not verdict
        const { gradeIntake } = await import('@/lib/triage.ts');
        const g = gradeIntake(result);
        const finished: PracticeCall = {
          ...inFlight, status: 'DONE', result, summary: data.summary ?? null,
          severity: g.severity, priority: g.priority, updatedAt: new Date().toISOString(),
        };
        persist(callsRef.current.map((c) => (c.id === finished.id ? finished : c)));
        setInFlight(null); setBusy(false); setSelectedId(finished.id);
        setToast(`Intake received — ${result.emergencyType} · urgency ${result.urgency} · graded ${g.severity}`);
        return;
      }
      if (data.phase === 'FAILED') {
        const failed: PracticeCall = { ...inFlight, status: 'FAILED', failure: data.failure ?? 'provider reported failure' };
        persist(callsRef.current.map((c) => (c.id === failed.id ? failed : c)));
        setInFlight(null); setBusy(false);
        setToast(`Call failed: ${failed.failure}. No automatic redial.`);
        return;
      }
      pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
    return () => { alive = false; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [inFlight, persist]);

  const selected = useMemo(() => calls.find((c) => c.id === selectedId) ?? null, [calls, selectedId]);

  async function start(mode: 'PREVIEW' | 'REAL') {
    if (mode === 'REAL') {
      if (!pin) { setToast('Enter the operator PIN to place real calls.'); return; }
      const ok = confirm(
        'Place ONE practice call via CALL-E?\n\n' +
        '• The AI will identify itself as a DEMO — it never claims to be the real 112.\n' +
        '• Single attempt — no auto-redial. Once submitted it cannot be recalled.\n' +
        '• Answer your phone and report a practice emergency in the chosen language.',
      );
      if (!ok) return;
    }
    setBusy(true); setToast(null); setPreview(null);
    const res = await fetch('/api/practice', {
      method: 'POST',
      headers: mode === 'REAL' ? { 'x-demo-pin': pin } : {},
      body: JSON.stringify({ mode, locale }),
    });
    const data = await res.json();
    if (!res.ok) { setBusy(false); setToast(data.error ?? 'Request failed.'); return; }
    if (mode === 'PREVIEW') {
      setBusy(false); setPreview(data.practice); setToast('PREVIEW — exact task built, no call placed.');
    } else {
      sessionStorage.setItem('kwr-pin', pin);
      const rec = data.practice as PracticeCall;
      persist([rec, ...callsRef.current]);
      setInFlight(rec); setSelectedId(rec.id);
      setToast(`Practice call placed to ${rec.testerE164Masked} (${rec.language}) — polling for the intake…`);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <span className="font-bold tracking-wide">KWIK</span>
        <span className="text-xs text-zinc-400">emergency-call intake, practiced on real calls · CALL-E</span>
        <span className={`ml-auto text-xs px-2 py-1 rounded ${calleConfigured ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {calleConfigured ? 'CALL-E connected' : 'PREVIEW only'}
        </span>
        <span className="text-xs text-zinc-500">AI demo — never the real 112</span>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-5">
        <div className="p-5 bg-zinc-900 rounded border border-zinc-800 space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Practice the citizen call</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Kwik calls {testerMasked ?? 'the configured tester phone'}. The AI opens by identifying itself as an
              AI demo — <span className="text-zinc-200">not the real 112</span> — then runs the intake in your
              chosen language: what happened, where, how urgent. Every practice call returns structured intake data,
              graded by local rules, exactly as a control room would receive it.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-zinc-400">Language:</label>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800">
              {LOCALES.map((l) => <option key={l} value={l}>{l === 'hi' ? 'हिंदी (hi)' : l === 'en-IN' ? 'English (en-IN)' : l}</option>)}
            </select>
            <label className="text-xs text-zinc-400 ml-2">Operator PIN:</label>
            <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="••••"
              className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800 w-24" />
            <div className="ml-auto flex gap-2">
              <button onClick={() => start('PREVIEW')} disabled={busy}
                className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔍 Preview task (safe)</button>
              <button onClick={() => start('REAL')} disabled={busy}
                className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-40">📞 Start practice call</button>
            </div>
          </div>
          {busy && inFlight && <p className="text-xs text-yellow-400 animate-pulse">Call in flight — single attempt. Polling every 4s…</p>}
          {toast && <p className={`text-xs ${toast.startsWith('Call failed') || toast.startsWith('Call submission') ? 'text-red-400' : 'text-green-400'}`}>{toast}</p>}
        </div>

        {preview && (
          <div className="p-4 bg-zinc-900 rounded border border-yellow-700">
            <h3 className="text-sm font-semibold text-yellow-400">PREVIEW — the exact task REAL mode sends (no call placed)</h3>
            <pre className="text-[11px] mt-2 overflow-auto max-h-72 text-zinc-300">{JSON.stringify(preview.payload, null, 2)}</pre>
          </div>
        )}

        {selected && (selected.result || selected.failure || selected.status === 'SUBMITTED') && (
          <div className={`p-5 bg-zinc-900 rounded border ${selected.status === 'DONE' ? 'border-green-800' : selected.status === 'FAILED' ? 'border-red-800' : 'border-yellow-700'}`}>
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">
                {selected.status === 'SUBMITTED' ? 'Call in flight —' : selected.status === 'FAILED' ? 'Call failed —' : 'Structured intake —'} {selected.id}
              </h3>
              {selected.priority && selected.severity && (
                <span className={`text-[10px] font-bold px-2 py-1 rounded ${SEV_STYLE[selected.severity]}`}>
                  {selected.priority} · {selected.severity} (local rules)
                </span>
              )}
              <span className="ml-auto text-xs text-zinc-500">{selected.language}</span>
            </div>
            {selected.result && (
              <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                <div><p className="text-xs text-zinc-500">Emergency</p><p className="font-bold">{selected.result.emergencyType}</p></div>
                <div><p className="text-xs text-zinc-500">Location</p><p className="font-bold">{selected.result.location}</p></div>
                <div><p className="text-xs text-zinc-500">Urgency (agent read)</p><p className="font-bold">{selected.result.urgency}</p></div>
                <div><p className="text-xs text-zinc-500">Caller clarity</p><p className="font-bold">{selected.result.clarity}</p></div>
              </div>
            )}
            {selected.summary && (
              <details className="mt-3"><summary className="text-xs text-zinc-500 cursor-pointer">Call summary (provider evidence)</summary>
                <p className="text-[11px] text-zinc-400 mt-1">{selected.summary}</p></details>
            )}
            {selected.failure && <p className="text-xs text-red-400 mt-2">{selected.failure}</p>}
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Practice history <span className="text-zinc-600 normal-case font-normal">(local demo state)</span></h2>
          {calls.length === 0 && <p className="text-zinc-600 text-sm border border-dashed border-zinc-800 rounded p-6 text-center">No practice calls yet — place one above.</p>}
          {calls.map((c) => (
            <button key={c.id} onClick={() => setSelectedId(c.id)}
              className={`w-full text-left p-3 rounded border ${selectedId === c.id ? 'border-red-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/50'} hover:border-zinc-600`}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">{new Date(c.createdAt).toLocaleString()}</span>
                <span className="text-xs text-zinc-500">{c.language}</span>
                {c.severity && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEV_STYLE[c.severity]}`}>{c.priority} · {c.severity}</span>}
                <span className="ml-auto text-[10px] text-zinc-500">
                  {c.status === 'DONE' ? c.result?.emergencyType : c.status === 'FAILED' ? 'failed' : 'in flight…'}
                </span>
              </div>
              {c.result && <p className="text-xs text-zinc-500 mt-1">{c.result.location}</p>}
            </button>
          ))}
        </div>

        <p className="text-[11px] text-zinc-600 border-t border-zinc-900 pt-3">
          Safety: the AI identifies itself as a demo on every call and directs real emergencies to the real emergency
          number. It never dispatches, never promises help, and never claims to be a government service. Local rules
          grade every intake; the agent&apos;s assessment is an input, never the verdict.
        </p>
      </div>
    </div>
  );
}
