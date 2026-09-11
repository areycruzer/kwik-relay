'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaseStatus, EmergencyCase, RelayRecord, Unit } from '@/lib/types.ts';

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-400 text-black',
  LOW: 'bg-zinc-500 text-white',
};
const STATUS_LABEL: Record<CaseStatus, string> = {
  TRIAGED: 'Awaiting human dispatch', DISPATCHED: 'Relay call in flight…',
  CONFIRMED: 'Unit confirmed ✓', DECLINED: 'Unit declined — reassign', CLOSED: 'Closed',
};
const LOCALES = ['hi', 'en-IN', 'ta', 'te', 'bn', 'mr', 'kn', 'pa'];
const POLL_MS = 4000;

export default function Console() {
  const [cases, setCases] = useState<EmergencyCase[]>([]);
  const [relays, setRelays] = useState<RelayRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [calleConfigured, setCalleConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  const [locale, setLocale] = useState('hi');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<RelayRecord | null>(null);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch('/api/cases').then((x) => x.json()),
      fetch('/api/relay').then((x) => x.json()),
    ]);
    setCases(c.cases ?? []);
    setRelays(r.relays ?? []);
    setCalleConfigured(Boolean(r.calleConfigured));
  }, []);

  useEffect(() => {
    refresh();
    fetch('/api/units').then((x) => x.json()).then((x) => setUnits(x.units ?? [])).catch(() => {});
    setPin(sessionStorage.getItem('kwr-pin') ?? '');
  }, [refresh]);

  // Poll the in-flight relay until terminal.
  useEffect(() => {
    if (!inFlightId) return;
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/relay/${inFlightId}`);
      const data = await res.json().catch(() => null);
      if (!alive) return;
      if (data?.relay) {
        setRelays((rs) => [...rs.filter((x) => x.id !== data.relay.id), data.relay]);
        refresh();
        if (data.relay.status === 'DONE' || data.relay.status === 'FAILED') {
          setInFlightId(null);
          setBusy(false);
          setToast(
            data.relay.status === 'DONE'
              ? `Call finished — accepted: ${data.relay.result?.unitAccepted}, ETA: ${data.relay.result?.etaMinutes} min`
              : `Call failed: ${data.relay.failure ?? 'unknown'} — no automatic redial; case returned to dispatcher.`,
          );
          return;
        }
      }
      pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
    return () => { alive = false; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [inFlightId, refresh]);

  const selected = useMemo(() => cases.find((c) => c.id === selectedId) ?? null, [cases, selectedId]);
  const lastRelay = useMemo(() => relays.find((r) => r.caseId === selected?.id) ?? null, [relays, selected]);

  async function addCase(form: FormData) {
    await fetch('/api/cases', { method: 'POST', body: JSON.stringify({ callerPhrase: form.get('phrase'), locationText: form.get('location') }) });
    refresh();
  }

  async function relay(mode: 'PREVIEW' | 'REAL') {
    if (!selected || !unitId) { setToast('Pick a case and a unit first.'); return; }
    if (mode === 'REAL') {
      if (!note.trim()) { setToast('Real calls need a written dispatcher note.'); return; }
      if (!pin) { setToast('Enter the operator PIN to enable real calls.'); return; }
      const ok = confirm(
        'Place ONE real phone call via CALL-E?\n\n' +
        '• Single attempt — no auto-redial, no voicemail left.\n' +
        '• Once submitted, the call cannot be recalled; closing this page will not stop it.\n' +
        '• The unit must be authorized to receive this relay (demo: your own phone).',
      );
      if (!ok) return;
    }
    setBusy(true); setToast(null); setPreview(null);
    const res = await fetch('/api/relay', {
      method: 'POST',
      headers: mode === 'REAL' ? { 'x-demo-pin': pin } : {},
      body: JSON.stringify({ caseId: selected.id, unitId, dispatcherNote: note, mode, locale }),
    });
    const data = await res.json();
    if (!res.ok) { setBusy(false); setToast(data.error ?? 'Relay failed.'); return; }
    if (mode === 'PREVIEW') {
      setBusy(false); setPreview(data.relay); setToast('PREVIEW — payload built, no call placed.');
    } else {
      sessionStorage.setItem('kwr-pin', pin);
      setInFlightId(data.relay.id);
      setToast('Call submitted — polling for the structured result…');
    }
    refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <span className="font-bold tracking-wide">KWIK RELAY</span>
        <span className="text-xs text-zinc-400">the outbound half of emergency dispatch · CALL-E phone relay</span>
        <span className={`ml-auto text-xs px-2 py-1 rounded ${calleConfigured ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {calleConfigured ? 'CALL-E connected' : 'PREVIEW mode only (no CALLE_API_KEY)'}
        </span>
        <span className="text-xs text-zinc-500">Synthetic demo data · not an official 112 service</span>
      </header>

      <div className="grid grid-cols-[380px_1fr] gap-4 p-4">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Case queue</h2>
          {cases.map((c) => (
            <button key={c.id} onClick={() => { setSelectedId(c.id); setUnitId(''); setPreview(null); }}
              className={`w-full text-left p-3 rounded border ${selectedId === c.id ? 'border-red-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/50'} hover:border-zinc-600`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEV_STYLE[c.severity]}`}>{c.priority} · {c.severity}</span>
                <span className="text-xs text-zinc-400">{c.id}</span>
                <span className="ml-auto text-[10px] text-zinc-500">{STATUS_LABEL[c.status]}</span>
              </div>
              <p className="text-sm mt-1.5 line-clamp-2">{c.callerPhrase}</p>
              <p className="text-xs text-zinc-500 mt-1">{c.locationText}</p>
            </button>
          ))}
          <form action={addCase} className="p-3 border border-dashed border-zinc-800 rounded space-y-2">
            <p className="text-xs text-zinc-500">Add a case (intake simulation)</p>
            <input name="phrase" placeholder="Caller phrase…" className="w-full bg-zinc-900 text-sm p-2 rounded" />
            <input name="location" placeholder="Location…" className="w-full bg-zinc-900 text-sm p-2 rounded" />
            <button className="w-full bg-zinc-800 hover:bg-zinc-700 text-sm py-1.5 rounded">Grade &amp; queue</button>
          </form>
        </section>

        <section className="space-y-4">
          {!selected && <p className="text-zinc-500 p-8 text-center border border-dashed border-zinc-800 rounded">Select a case to dispatch.</p>}
          {selected && (
            <>
              <div className="p-4 bg-zinc-900 rounded border border-zinc-800">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${SEV_STYLE[selected.severity]}`}>{selected.priority} · {selected.severity}</span>
                  <h1 className="font-semibold">{selected.incidentType}</h1>
                  <span className="ml-auto text-xs text-zinc-400">{STATUS_LABEL[selected.status]}</span>
                </div>
                <p className="text-sm mt-2 text-zinc-300">“{selected.callerPhrase}”</p>
                <p className="text-xs text-zinc-500 mt-1">📍 {selected.locationText}</p>
              </div>

              <div className="p-4 bg-zinc-900 rounded border border-zinc-800 space-y-3">
                <h3 className="text-sm font-semibold">Step 1 — Human dispatch decision (required before any call)</h3>
                <div className="grid grid-cols-3 gap-2">
                  {units.map((u) => (
                    <button key={u.id} onClick={() => setUnitId(u.id)}
                      className={`p-2 rounded border text-left ${unitId === u.id ? 'border-red-500 bg-zinc-800' : 'border-zinc-800 hover:border-zinc-600'}`}>
                      <p className="text-sm">{u.name}</p>
                      <p className="text-[10px] text-zinc-500">{u.service} · {u.baseArea}</p>
                    </button>
                  ))}
                </div>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  placeholder="Written dispatcher note — why this unit (required for real calls)…"
                  className="w-full bg-zinc-950 text-sm p-2 rounded border border-zinc-800" />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-zinc-400">Unit language:</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)} className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800">
                    {LOCALES.map((l) => <option key={l} value={l}>{l === 'hi' ? 'हिंदी (hi)' : l === 'en-IN' ? 'English (en-IN)' : l}</option>)}
                  </select>
                  <label className="text-xs text-zinc-400 ml-2">Operator PIN:</label>
                  <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="••••"
                    className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800 w-24" />
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => relay('PREVIEW')} disabled={busy || !unitId}
                      className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔍 Preview call (safe)</button>
                    <button onClick={() => relay('REAL')} disabled={busy || !unitId}
                      className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-40">📞 Place CALL-E relay</button>
                  </div>
                </div>
                {busy && inFlightId && (
                  <p className="text-xs text-yellow-400 animate-pulse">
                    Call in flight — single attempt, no redial. Polling every 4s for the structured result…
                  </p>
                )}
                {toast && <p className={`text-xs ${toast.startsWith('Call failed') ? 'text-red-400' : 'text-green-400'}`}>{toast}</p>}
              </div>

              {preview && (
                <div className="p-4 bg-zinc-900 rounded border border-yellow-700">
                  <h3 className="text-sm font-semibold text-yellow-400">PREVIEW — exact payload REAL mode will send (no call placed)</h3>
                  <pre className="text-[11px] mt-2 overflow-auto max-h-72 text-zinc-300">{JSON.stringify(preview.payload, null, 2)}</pre>
                </div>
              )}

              {lastRelay && (lastRelay.result || lastRelay.failure || lastRelay.status === 'SUBMITTED') && (
                <div className={`p-4 bg-zinc-900 rounded border ${lastRelay.status === 'DONE' ? 'border-green-800' : lastRelay.status === 'FAILED' ? 'border-red-800' : 'border-yellow-700'}`}>
                  <h3 className={`text-sm font-semibold ${lastRelay.status === 'FAILED' ? 'text-red-400' : 'text-green-400'}`}>
                    {lastRelay.status === 'SUBMITTED' ? 'Relay in flight —' : lastRelay.status === 'FAILED' ? 'Call failed —' : 'Structured result —'} {lastRelay.id}
                    {lastRelay.calleCallId && <span className="text-xs text-zinc-500 font-normal"> · provider call {lastRelay.calleCallId}</span>}
                  </h3>
                  {lastRelay.result && (
                    <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
                      <div><p className="text-xs text-zinc-500">Unit accepted</p><p className="font-bold">{lastRelay.result.unitAccepted.toUpperCase()}</p></div>
                      <div><p className="text-xs text-zinc-500">ETA</p><p className="font-bold">{lastRelay.result.etaMinutes} min</p></div>
                      <div><p className="text-xs text-zinc-500">Schema validation</p><p className="font-bold text-xs mt-1">{lastRelay.resultValidation ? 'passed' : '—'}</p></div>
                    </div>
                  )}
                  {lastRelay.result?.notes && <p className="text-xs text-zinc-400 mt-2">“{lastRelay.result.notes}”</p>}
                  {lastRelay.transcriptExcerpt && (
                    <details className="mt-2"><summary className="text-xs text-zinc-500 cursor-pointer">Transcript excerpt (provider evidence)</summary>
                      <p className="text-[11px] text-zinc-400 mt-1 whitespace-pre-wrap">{lastRelay.transcriptExcerpt}</p></details>
                  )}
                  {lastRelay.failure && <p className="text-xs text-red-400 mt-2">{lastRelay.failure}</p>}
                </div>
              )}

              <div className="p-4 bg-zinc-900 rounded border border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-400 mb-2">Case timeline — every action auto-documented</h3>
                <ol className="space-y-1.5">
                  {selected.timeline.map((t, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="text-zinc-600 shrink-0">{new Date(t.at).toLocaleTimeString()}</span>
                      <span className="font-mono text-[10px] text-zinc-500 shrink-0">{t.kind}</span>
                      <span className="text-zinc-300">{t.detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
