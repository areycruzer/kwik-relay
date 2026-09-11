'use client';

// Kwik console — the original layout, restored. The one tool inside it:
// "Start demo call" places ONE real CALL-E outbound call that runs the
// self-identifying intake practice (never claims to be the real 112) and
// files the structured result as a case. State lives client-side
// (localStorage); the API is stateless.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IntakeResult } from '@/lib/types.ts';

const SEV_STYLE: Record<string, string> = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-400 text-black',
  LOW: 'bg-zinc-500 text-white',
  UNKNOWN: 'bg-zinc-700 text-zinc-300',
};
const LOCALES = ['hi', 'en-IN', 'ta', 'te', 'bn', 'mr', 'kn', 'pa'];
const POLL_MS = 4000;
const LS_KEY = 'kwik-console-v1';

interface DemoCase {
  id: string;
  createdAt: string;
  emergency: string;
  location: string;
  urgency: string;
  clarity: string;
  severity: string;
  priority: string;
  language: string;
  source: 'SEEDED' | 'CALL';
  status: 'RECEIVED' | 'IN_FLIGHT' | 'FAILED';
  summary?: string | null;
  failure?: string | null;
  calleCallId?: string | null;
  timeline: Array<{ at: string; kind: string; detail: string }>;
}

const SEEDS: Array<[string, string, string, string, string, string]> = [
  ['Breathing emergency — mother unconscious', 'Shalimar Bagh B-block, Delhi', 'critical', 'partial', 'CRITICAL', 'P1'],
  ['Road accident, one person bleeding', 'Rohini Sector 7, Delhi', 'critical', 'clear', 'CRITICAL', 'P1'],
  ['Theft — purse snatched, thief fled', 'Pitampura market, Delhi', 'medium', 'clear', 'HIGH', 'P2'],
  ['Noise complaint — loud DJ at night', 'Model Town, Delhi', 'low', 'clear', 'LOW', 'P4'],
];
function seedCases(): DemoCase[] {
  return SEEDS.map((s, i) => ({
    id: `KWR-${String(i + 1).padStart(4, '0')}`,
    createdAt: new Date(Date.now() - (SEEDS.length - i) * 3600_000).toISOString(),
    emergency: s[0], location: s[1], urgency: s[2], clarity: s[3],
    severity: s[4], priority: s[5], language: 'Hindi',
    source: 'SEEDED', status: 'RECEIVED', summary: null,
    timeline: [{ at: new Date(Date.now() - (SEEDS.length - i) * 3600_000).toISOString(), kind: 'INTAKE', detail: 'SIMULATED seed case — synthetic demo data, not a real call.' }],
  }));
}

export default function Console() {
  const [cases, setCases] = useState<DemoCase[]>([]);
  const [calleConfigured, setCalleConfigured] = useState(false);
  const [testerMasked, setTesterMasked] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locale, setLocale] = useState('hi');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewTask, setPreviewTask] = useState<unknown>(null);
  const [flight, setFlight] = useState<{ caseId: string; practiceId: string; callId: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const casesRef = useRef<DemoCase[]>([]);
  useEffect(() => { casesRef.current = cases; }, [cases]);

  const persist = useCallback((next: DemoCase[]) => {
    setCases(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? (JSON.parse(raw) as DemoCase[]) : null;
      setCases(parsed && parsed.length ? parsed : seedCases());
    } catch { setCases(seedCases()); }
    if (!localStorage.getItem(LS_KEY)) localStorage.setItem(LS_KEY, JSON.stringify(seedCases()));
    setPin(sessionStorage.getItem('kwr-pin') ?? '');
    fetch('/api/practice').then((x) => x.json()).then((x) => {
      setCalleConfigured(Boolean(x.calleConfigured));
      setTesterMasked(x.testerMasked ?? null);
    }).catch(() => {});
  }, []);

  const patchCase = useCallback((id: string, fn: (c: DemoCase) => DemoCase) => {
    persist(casesRef.current.map((c) => (c.id === id ? fn(structuredClone(c)) : c)));
  }, [persist]);

  // poll the in-flight demo call until terminal
  useEffect(() => {
    if (!flight) return;
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/practice/${flight.practiceId}?callId=${encodeURIComponent(flight.callId)}`);
      const data = await res.json().catch(() => null);
      if (!alive || !data) return;
      const now = new Date().toISOString();
      if (data.phase === 'DONE') {
        const r = data.result as IntakeResult;
        const { gradeIntake } = await import('@/lib/triage.ts');
        const g = gradeIntake(r);
        patchCase(flight.caseId, (c) => ({
          ...c, status: 'RECEIVED',
          emergency: r.emergencyType, location: r.location,
          urgency: r.urgency, clarity: r.clarity,
          severity: g.severity, priority: g.priority,
          summary: data.summary ?? c.summary,
          timeline: [...c.timeline, {
            kind: 'INTAKE_RESULT', at: now,
            detail: `Structured intake received — ${r.emergencyType}; location "${r.location}"; urgency ${r.urgency}; clarity ${r.clarity}; graded ${g.severity} (${g.priority}) by local escalate-only rules.`,
          }],
        }));
        setFlight(null); setBusy(false);
        setToast(`Intake received — ${r.emergencyType} · graded ${g.severity}`);
        return;
      }
      if (data.phase === 'FAILED') {
        patchCase(flight.caseId, (c) => ({
          ...c, status: 'FAILED', failure: data.failure ?? 'provider reported failure',
          timeline: [...c.timeline, { kind: 'CALL_FAILED', at: now, detail: `Call failed (${data.failure ?? 'unknown'}). No automatic redial.` }],
        }));
        setFlight(null); setBusy(false);
        setToast(`Call failed: ${data.failure ?? 'unknown'}`);
        return;
      }
      pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
    return () => { alive = false; if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [flight, patchCase]);

  const selected = useMemo(() => cases.find((c) => c.id === selectedId) ?? null, [cases, selectedId]);

  async function demoCall(mode: 'PREVIEW' | 'REAL') {
    if (mode === 'REAL') {
      if (!pin) { setToast('Enter the operator PIN to place the demo call.'); return; }
      const ok = confirm(
        'Place ONE real demo call via CALL-E?\n\n' +
        '• The AI identifies itself as a DEMO — it never claims to be the real 112.\n' +
        '• Single attempt — no auto-redial. Once submitted it cannot be recalled.\n' +
        '• Answer your phone and report a practice emergency in the chosen language.',
      );
      if (!ok) return;
    }
    setBusy(true); setToast(null); setPreviewTask(null);
    const res = await fetch('/api/practice', {
      method: 'POST',
      headers: mode === 'REAL' ? { 'x-demo-pin': pin } : {},
      body: JSON.stringify({ mode, locale }),
    });
    const data = await res.json();
    if (!res.ok) { setBusy(false); setToast(data.error ?? 'Request failed.'); return; }
    if (mode === 'PREVIEW') {
      setBusy(false); setPreviewTask(data.practice.payload);
      setToast('PREVIEW — exact task built, no call placed.');
      return;
    }
    sessionStorage.setItem('kwr-pin', pin);
    const p = data.practice;
    const caseId = `KWR-${p.id.replace('PRA-', '')}`;
    const lang = p.language ?? 'Hindi';
    const now = new Date().toISOString();
    const nc: DemoCase = {
      id: caseId, createdAt: now,
      emergency: 'Intake in progress…', location: testerMasked ?? 'tester phone',
      urgency: 'pending', clarity: 'pending', severity: 'UNKNOWN', priority: 'P4',
      language: lang, source: 'CALL', status: 'IN_FLIGHT',
      calleCallId: p.calleCallId,
      timeline: [
        { at: now, kind: 'CALL_PLACED', detail: `Real CALL-E demo call placed to ${p.testerE164Masked} (${lang}) — single attempt, no redial. Provider call ${p.calleCallId}. The agent identifies itself as an AI demo, never the real 112.` },
      ],
    };
    persist([nc, ...casesRef.current]);
    setSelectedId(caseId);
    setFlight({ caseId, practiceId: p.id, callId: p.calleCallId });
    setToast(`Demo call placed to ${p.testerE164Masked} (${lang}) — polling for the intake…`);
  }

  function resetDemo() {
    if (!confirm('Reset the console? Local cases and history are cleared and synthetic seeds restored.')) return;
    localStorage.removeItem(LS_KEY);
    location.reload();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
        <span className="font-bold tracking-wide">KWIK</span>
        <span className="text-xs text-zinc-400">112 emergency-call intake console · CALL-E demo calls</span>
        <span className={`ml-auto text-xs px-2 py-1 rounded ${calleConfigured ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}`}>
          {calleConfigured ? 'CALL-E connected' : 'PREVIEW mode only'}
        </span>
        <span className="text-xs text-zinc-500">Synthetic seed data · AI demo — never the real 112</span>
        <button onClick={resetDemo} className="text-xs text-zinc-600 hover:text-zinc-400 underline">reset</button>
      </header>

      <div className="grid grid-cols-[380px_1fr] gap-4 p-4">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Case queue</h2>
          {cases.map((c) => (
            <button key={c.id} onClick={() => { setSelectedId(c.id); setPreviewTask(null); }}
              className={`w-full text-left p-3 rounded border ${selectedId === c.id ? 'border-red-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/50'} hover:border-zinc-600`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SEV_STYLE[c.severity] ?? SEV_STYLE.UNKNOWN}`}>{c.priority} · {c.severity}</span>
                <span className="text-xs text-zinc-400">{c.id}</span>
                {c.source === 'SEEDED' && <span className="text-[10px] text-zinc-600">SIM</span>}
                <span className="ml-auto text-[10px] text-zinc-500">
                  {c.status === 'IN_FLIGHT' ? 'call in flight…' : c.status === 'FAILED' ? 'call failed' : c.emergency.slice(0, 22)}
                </span>
              </div>
              <p className="text-sm mt-1.5 line-clamp-2">{c.emergency}</p>
              <p className="text-xs text-zinc-500 mt-1">📍 {c.location}</p>
            </button>
          ))}
        </section>

        <section className="space-y-4">
          {!selected && <p className="text-zinc-500 p-8 text-center border border-dashed border-zinc-800 rounded">Select a case, or start a demo call below.</p>}
          {selected && (
            <>
              <div className="p-4 bg-zinc-900 rounded border border-zinc-800">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${SEV_STYLE[selected.severity] ?? SEV_STYLE.UNKNOWN}`}>{selected.priority} · {selected.severity}</span>
                  <h1 className="font-semibold">{selected.status === 'IN_FLIGHT' ? 'Intake in progress…' : selected.emergency}</h1>
                  <span className="ml-auto text-xs text-zinc-400">{selected.language}</span>
                </div>
                <p className="text-sm mt-2 text-zinc-300">📍 {selected.location}</p>
                {selected.status !== 'IN_FLIGHT' && (
                  <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                    <div><p className="text-xs text-zinc-500">Urgency</p><p className="font-bold">{selected.urgency}</p></div>
                    <div><p className="text-xs text-zinc-500">Caller clarity</p><p className="font-bold">{selected.clarity}</p></div>
                    <div><p className="text-xs text-zinc-500">Source</p><p className="font-bold">{selected.source === 'CALL' ? 'real demo call' : 'synthetic seed'}</p></div>
                  </div>
                )}
              </div>

              <div className="p-4 bg-zinc-900 rounded border border-zinc-800 space-y-3">
                <h3 className="text-sm font-semibold">Start demo call — a real outbound CALL-E call runs the intake</h3>
                <p className="text-xs text-zinc-500">
                  Kwik calls {testerMasked ?? 'the configured tester phone'}. The AI opens by identifying itself as a demo —
                  <span className="text-zinc-300"> never the real 112</span> — then asks what happened, where, and how urgent, one question
                  at a time. The structured intake lands here as a graded case.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-zinc-400">Language:</label>
                  <select value={locale} onChange={(e) => setLocale(e.target.value)} className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800">
                    {LOCALES.map((l) => <option key={l} value={l}>{l === 'hi' ? 'हिंदी (hi)' : l === 'en-IN' ? 'English (en-IN)' : l}</option>)}
                  </select>
                  <label className="text-xs text-zinc-400 ml-2">Operator PIN:</label>
                  <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" placeholder="••••"
                    className="bg-zinc-950 text-xs p-1 rounded border border-zinc-800 w-24" />
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => demoCall('PREVIEW')} disabled={busy}
                      className="px-3 py-1.5 text-sm rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40">🔍 Preview task</button>
                    <button onClick={() => demoCall('REAL')} disabled={busy}
                      className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 disabled:opacity-40">📞 Start demo call</button>
                  </div>
                </div>
                {busy && flight && <p className="text-xs text-yellow-400 animate-pulse">Call in flight — single attempt, no redial. Polling every 4s…</p>}
                {toast && <p className={`text-xs ${toast.startsWith('Call failed') || toast.startsWith('Call submission') ? 'text-red-400' : 'text-green-400'}`}>{toast}</p>}
              </div>

              {previewTask && (
                <div className="p-4 bg-zinc-900 rounded border border-yellow-700">
                  <h3 className="text-sm font-semibold text-yellow-400">PREVIEW — the exact task the demo call sends (no call placed)</h3>
                  <pre className="text-[11px] mt-2 overflow-auto max-h-72 text-zinc-300">{JSON.stringify(previewTask, null, 2)}</pre>
                </div>
              )}

              {selected.summary && (
                <div className="p-4 bg-zinc-900 rounded border border-green-800">
                  <h3 className="text-sm font-semibold text-green-400">Call summary (provider evidence)</h3>
                  <p className="text-xs text-zinc-400 mt-2">{selected.summary}</p>
                </div>
              )}

              <div className="p-4 bg-zinc-900 rounded border border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-400 mb-2">Case timeline — every action documented</h3>
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
