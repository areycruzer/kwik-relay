'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaseStatus, EmergencyCase, RelayRecord, Unit } from '@/lib/types.ts';

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-400 text-black',
  LOW: 'bg-zinc-500 text-white',
};
const STATUS_LABEL: Record<CaseStatus, string> = {
  TRIAGED: 'Awaiting human dispatch', DISPATCHED: 'Dispatched — relay pending',
  RELAYED: 'Relay call placed', CONFIRMED: 'Unit confirmed', DECLINED: 'Unit declined', CLOSED: 'Closed',
};

type Mode = 'PREVIEW' | 'REAL';

export default function Console() {
  const [cases, setCases] = useState<EmergencyCase[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [relays, setRelays] = useState<RelayRecord[]>([]);
  const [calleConfigured, setCalleConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState('');
  const [note, setNote] = useState('');
  const [locale, setLocale] = useState('hi');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<RelayRecord | null>(null);

  const refresh = useCallback(async () => {
    const [c, r] = await Promise.all([
      fetch('/api/cases').then((x) => x.json()),
      fetch('/api/relay').then((x) => x.json()),
    ]);
    setCases(c.cases ?? []);
    setRelays(r.relays ?? []);
    setCalleConfigured(Boolean(r.calleConfigured));
  }, []);

  useEffect(() => { refresh(); fetch('/api/units').then((x) => x.json()).then((x) => setUnits(x.units ?? [])).catch(() => {}); }, [refresh]);

  const selected = useMemo(() => cases.find((c) => c.id === selectedId) ?? null, [cases, selectedId]);
  const lastRelay = useMemo(() => relays.find((r) => r.caseId === selected?.id) ?? null, [relays, selected]);

  async function addCase(form: FormData) {
    await fetch('/api/cases', { method: 'POST', body: JSON.stringify({ callerPhrase: form.get('phrase'), locationText: form.get('location') }) });
    form.delete('phrase'); form.delete('location');
    refresh();
  }

  async function relay(mode: Mode) {
    if (!selected || !unitId) { setToast('Pick a case and a unit first.'); return; }
    if (mode === 'REAL' && !note.trim()) { setToast('Real calls need a written dispatcher note.'); return; }
    setBusy(true); setToast(null); setPreview(null);
    const res = await fetch('/api/relay', {
      method: 'POST',
      body: JSON.stringify({ caseId: selected.id, unitId, dispatcherNote: note, mode, locale }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setToast(data.error ?? 'Relay failed.'); return; }
    if (mode === 'PREVIEW') { setPreview(data.relay); setToast('PREVIEW — payload built, no call placed.'); }
    else setToast(`Call finished — unit accepted: ${data.relay.result?.unitAccepted ?? 'unknown'}, ETA: ${data.relay.result?.etaMinutes ?? 'unknown'}`);
    refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <span className="font-bold tracking-wide">KWIK RELAY</span>
        <span className="text-xs text-zinc-400">the outbound half of emergency dispatch · CALL-E phone relay</span>
        <span className={`ml-auto text-xs px-2 py-1 rounded ${calleConfigured ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {calleConfigured ? 'CALL-E connected — real calls enabled' : 'PREVIEW mode only (no CALLE_API_KEY on server)'}
        </span>
        <span className="text-xs text-zinc-500">Synthetic demo data · not an official 112 service</span>
      </header>

      <div className="grid grid-cols-[380px_1fr] gap-4 p-4">
        {/* Queue */}
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
            <button className="w-full bg-zinc-800 hover:bg-zinc-700 text-sm py-1.5 rounded">Grade & queue</button>
          </form>
        </section>

        {/* Detail */}
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
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-400">Unit language:</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)} className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800">
                    <option value="hi">हिंदी (hi)</option>
                    <option value="en-IN">English (en-IN)</option>
                  </select>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => relay('PREVIEW')} disabled={busy || !unitId}
                      className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔍 Preview call (safe)</button>
                    <button onClick={() => relay('REAL')} disabled={busy || !unitId}
                      className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-40">📞 Place CALL-E relay</button>
                  </div>
                </div>
                {busy && <p className="text-xs text-yellow-400 animate-pulse">Placing real call via CALL-E — waiting for completion…</p>}
                {toast && <p className="text-xs text-green-400">{toast}</p>}
              </div>

              {preview && (
                <div className="p-4 bg-zinc-900 rounded border border-yellow-700">
                  <h3 className="text-sm font-semibold text-yellow-400">PREVIEW — exact payload REAL mode will send (no call placed)</h3>
                  <pre className="text-[11px] mt-2 overflow-auto max-h-72 text-zinc-300">{JSON.stringify(preview.payload, null, 2)}</pre>
                </div>
              )}

              {lastRelay?.result && (
                <div className="p-4 bg-zinc-900 rounded border border-green-800">
                  <h3 className="text-sm font-semibold text-green-400">Structured result — {lastRelay.id}</h3>
                  <div className="grid grid-cols-3 gap-3 mt-2 text-sm">
                    <div><p className="text-xs text-zinc-500">Unit accepted</p><p className="font-bold">{lastRelay.result.unitAccepted.toUpperCase()}</p></div>
                    <div><p className="text-xs text-zinc-500">ETA</p><p className="font-bold">{lastRelay.result.etaMinutes} min</p></div>
                    <div><p className="text-xs text-zinc-500">Confidence</p><p className="font-bold">{lastRelay.completionConfidence ?? '—'}</p></div>
                  </div>
                  {lastRelay.result.notes && <p className="text-xs text-zinc-400 mt-2">“{lastRelay.result.notes}”</p>}
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
