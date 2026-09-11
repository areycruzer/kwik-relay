// Relay lifecycle endpoint.
//
//  POST /api/relay            { caseId, unitId, dispatcherNote, mode: 'PREVIEW' | 'REAL', locale? }
//  GET  /api/relay            → all relay records (status board)
//
// Safety contract enforced HERE (not just in the UI):
//  1. mode=REAL requires a prior recorded human dispatch decision — the CALL-E
//     agent relays decisions, it never makes them.
//  2. PREVIEW builds the identical payload and returns it without any network
//     call — safe to try, fully inspectable.

import { NextResponse } from 'next/server';
import { buildCallTaskPayload, resolveLocale } from '@/lib/goals.ts';
import { calleConfigured, placeRelayCall } from '@/lib/callee.ts';
import { findUnit } from '@/lib/units.ts';
import { getCase, listRelays, saveRelay, updateCase } from '@/lib/store.ts';
import type { EmergencyCase, RelayRecord } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';

let relaySeq = 0;

export async function GET() {
  return NextResponse.json({ relays: listRelays(), calleConfigured: calleConfigured() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  const unitId = typeof body?.unitId === 'string' ? body.unitId : '';
  const note = typeof body?.dispatcherNote === 'string' ? body.dispatcherNote.trim() : '';
  const mode = body?.mode === 'REAL' ? 'REAL' : 'PREVIEW';
  const locale = resolveLocale(typeof body?.locale === 'string' ? body.locale : undefined);

  const c = getCase(caseId);
  const unit = findUnit(unitId);
  if (!c) return NextResponse.json({ error: 'Unknown caseId.' }, { status: 404 });
  if (!unit) return NextResponse.json({ error: 'Unknown unitId.' }, { status: 404 });
  if (mode === 'REAL' && !note) {
    return NextResponse.json(
      { error: 'Real calls require a written dispatcher note (human decision record).' },
      { status: 400 },
    );
  }

  const relayId = `REL-${String(++relaySeq).padStart(4, '0')}`;
  let payload;
  try {
    payload = buildCallTaskPayload(c, unit, relayId, locale);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const now = new Date().toISOString();

  if (mode === 'PREVIEW') {
    const rec: RelayRecord = {
      id: relayId, caseId, unitId, mode, status: 'DONE', payload,
      result: null, completionConfidence: null, transcriptTurns: null,
      error: null, createdAt: now,
    };
    saveRelay(rec);
    updateCase(caseId, (cc) => ({
      ...cc,
      timeline: [...cc.timeline, { kind: 'RELAY_PREVIEW', at: now, detail: `Previewed relay payload for ${unit.name} (locale ${locale}). No call placed.`, relayId }],
    }));
    return NextResponse.json({ relay: rec, warning: 'PREVIEW only — no phone call was placed.' });
  }

  // REAL — record the human dispatch decision first, then let CALL-E relay it.
  updateCase(caseId, (cc): EmergencyCase => ({
    ...cc,
    status: 'DISPATCHED',
    assignedUnitId: unitId,
    dispatcherNote: note,
    timeline: [...cc.timeline, { kind: 'DISPATCH', at: now, detail: `Human dispatcher assigned ${unit.name}. Note: "${note}"`, relayId }],
  }));

  const rec: RelayRecord = {
    id: relayId, caseId, unitId, mode, status: 'PLACING', payload,
    result: null, completionConfidence: null, transcriptTurns: null,
    error: null, createdAt: now,
  };
  saveRelay(rec);

  const outcome = await placeRelayCall(rec);
  const doneAt = new Date().toISOString();

  if (!outcome.ok) {
    const failed: RelayRecord = { ...rec, status: 'FAILED', error: outcome.error };
    saveRelay(failed);
    updateCase(caseId, (cc) => ({ ...cc, timeline: [...cc.timeline, { kind: 'RELAY_CALL', at: doneAt, detail: `CALL-E call FAILED: ${outcome.error}`, relayId }] }));
    return NextResponse.json({ relay: failed }, { status: 502 });
  }

  const finished: RelayRecord = {
    ...rec,
    status: 'DONE',
    result: outcome.result,
    completionConfidence: outcome.completionConfidence,
    transcriptTurns: outcome.transcriptTurns,
  };
  saveRelay(finished);

  const accepted = outcome.result.unitAccepted;
  updateCase(caseId, (cc) => ({
    ...cc,
    status: accepted === 'yes' ? 'CONFIRMED' : accepted === 'no' ? 'DECLINED' : 'RELAYED',
    timeline: [
      ...cc.timeline,
      { kind: 'RELAY_CALL', at: doneAt, detail: `CALL-E call placed to ${unit.name} (locale ${locale}).`, relayId },
      {
        kind: 'RELAY_RESULT', at: doneAt, relayId,
        detail: `Structured result — accepted: ${outcome.result.unitAccepted}; ETA: ${outcome.result.etaMinutes} min${outcome.result.notes ? `; notes: "${outcome.result.notes}"` : ''}${outcome.completionConfidence !== null ? `; confidence: ${outcome.completionConfidence}` : ''}`,
      },
    ],
  }));

  return NextResponse.json({ relay: finished });
}
