import { NextResponse } from 'next/server';
import { buildCallTaskPayload, resolveLocale } from '@/lib/goals.ts';
import { calleConfigured, createRelayCall } from '@/lib/callee.ts';
import { findUnit } from '@/lib/units.ts';
import { getCase, listRelays, saveRelay, updateCase } from '@/lib/store.ts';
import type { RelayRecord } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// --- Live-demo guardrails (awesome-phone-call-agents review policy) ---
// Real calling on a public demo requires basic auth: the operator PIN.
// Plus a global budget: a demo account must not be drained by anyone.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REAL_PER_WINDOW = 6;
const realCallTimes: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (realCallTimes.length && now - realCallTimes[0] > WINDOW_MS) realCallTimes.shift();
  return realCallTimes.length >= MAX_REAL_PER_WINDOW;
}

export async function GET() {
  return NextResponse.json({ relays: listRelays(), calleConfigured: calleConfigured() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  const unitId = typeof body?.unitId === 'string' ? body.unitId : '';
  const note = typeof body?.dispatcherNote === 'string' ? body.dispatcherNote.trim() : '';
  const mode = body?.mode === 'REAL' ? 'REAL' : 'PREVIEW';
  const pin = String(req.headers.get('x-demo-pin') ?? '');
  const locale = resolveLocale(typeof body?.locale === 'string' ? body.locale : undefined);

  const c = getCase(caseId);
  const unit = findUnit(unitId);
  if (!c) return NextResponse.json({ error: 'Unknown caseId.' }, { status: 404 });
  if (!unit) return NextResponse.json({ error: 'Unknown unitId.' }, { status: 404 });
  if (mode === 'REAL' && !note) {
    return NextResponse.json({ error: 'Real calls require a written dispatcher note (human decision record).' }, { status: 400 });
  }

  const relayId = `REL-${String(listRelays().length + 1).padStart(4, '0')}-${Date.now().toString(36)}`;
  let payload;
  try {
    payload = buildCallTaskPayload(c, unit, relayId, locale);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (mode === 'PREVIEW') {
    const rec: RelayRecord = {
      id: relayId, caseId, unitId, mode, status: 'DONE', calleCallId: null, payload,
      result: null, resultValidation: null, transcriptExcerpt: null, failure: null,
      createdAt: now, updatedAt: now,
    };
    saveRelay(rec);
    updateCase(caseId, (cc) => ({
      ...cc,
      timeline: [...cc.timeline, { kind: 'RELAY_PREVIEW', at: now, detail: `Previewed relay payload for ${unit.name} (locale ${locale}). No call placed.`, relayId }],
    }));
    return NextResponse.json({ relay: rec, warning: 'PREVIEW only — no phone call was placed.' });
  }

  // ---- REAL: auth, budget, then submit (create, never block on completion) ----
  const expectedPin = process.env.DEMO_PIN;
  if (!expectedPin) {
    return NextResponse.json({ error: 'Real calls disabled: DEMO_PIN is not configured on the server (fail closed).' }, { status: 503 });
  }
  if (pin !== expectedPin) {
    return NextResponse.json({ error: 'Invalid demo PIN. Real calls require operator authentication.' }, { status: 401 });
  }
  if (!calleConfigured()) {
    return NextResponse.json({ error: 'CALLE_API_KEY is not set on the server.' }, { status: 503 });
  }
  if (rateLimited()) {
    return NextResponse.json({ error: `Demo budget reached (${MAX_REAL_PER_WINDOW} calls / 10 min). Try again shortly.` }, { status: 429 });
  }
  if (listRelays().some((r) => r.caseId === caseId && r.mode === 'REAL' && r.status === 'SUBMITTED')) {
    return NextResponse.json({ error: 'A relay call is already in flight for this case. One call per case at a time.' }, { status: 409 });
  }

  // Record the human decision first — CALL-E relays it, never makes it.
  updateCase(caseId, (cc) => ({
    ...cc,
    status: 'DISPATCHED',
    assignedUnitId: unitId,
    dispatcherNote: note,
    timeline: [...cc.timeline, { kind: 'DISPATCH', at: now, detail: `Human dispatcher assigned ${unit.name}. Note: "${note}"`, relayId }],
  }));

  const rec: RelayRecord = {
    id: relayId, caseId, unitId, mode, status: 'SUBMITTED', calleCallId: null, payload,
    result: null, resultValidation: null, transcriptExcerpt: null, failure: null,
    createdAt: now, updatedAt: now,
  };
  saveRelay(rec);

  try {
    const { callId } = await createRelayCall(rec);
    realCallTimes.push(Date.now());
    const updated: RelayRecord = { ...rec, calleCallId: callId, updatedAt: new Date().toISOString() };
    saveRelay(updated);
    updateCase(caseId, (cc) => ({
      ...cc,
      timeline: [...cc.timeline, { kind: 'RELAY_CALL', at: updated.updatedAt, detail: `CALL-E call submitted to ${unit.name} (locale ${locale}, single attempt, no redial). Provider call ${callId}.`, relayId }],
    }));
    return NextResponse.json({
      relay: updated,
      notice: 'Call submitted — single attempt, cannot be recalled once placed. Polling for the structured result.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failed: RelayRecord = { ...rec, status: 'FAILED', failure: msg, updatedAt: new Date().toISOString() };
    saveRelay(failed);
    updateCase(caseId, (cc) => ({
      ...cc,
      status: cc.status === 'DISPATCHED' ? 'TRIAGED' : cc.status,
      timeline: [...cc.timeline, { kind: 'RELAY_FAILED', at: failed.updatedAt, detail: `CALL-E submission failed (no call placed): ${msg}`, relayId }],
    }));
    return NextResponse.json({ error: `Call submission failed — no call was placed: ${msg}` }, { status: 502 });
  }
}
