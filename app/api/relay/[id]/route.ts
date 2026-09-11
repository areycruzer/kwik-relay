// Poll an in-flight relay: fetch provider status once, fold results into the
// store, return the record. The client calls this every few seconds.

import { NextResponse } from 'next/server';
import { fetchRelayCall } from '@/lib/callee.ts';
import { getRelay, saveRelay, updateCase } from '@/lib/store.ts';
import type { RelayRecord } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = getRelay(id);
  if (!rec) return NextResponse.json({ error: 'Unknown relay id.' }, { status: 404 });
  if (rec.mode !== 'REAL' || rec.status !== 'SUBMITTED' || !rec.calleCallId) {
    return NextResponse.json({ relay: rec });
  }

  let poll;
  try {
    poll = await fetchRelayCall(rec.calleCallId);
  } catch (e) {
    // Transport errors are transient — keep polling, never fail the call itself.
    return NextResponse.json({ relay: rec, pollingError: e instanceof Error ? e.message : String(e) });
  }

  if (poll.phase === 'IN_FLIGHT') {
    const touched: RelayRecord = { ...rec, transcriptExcerpt: poll.transcriptExcerpt ?? rec.transcriptExcerpt };
    saveRelay(touched);
    return NextResponse.json({ relay: touched, calleStatus: poll.calleStatus });
  }

  const now = new Date().toISOString();
  if (poll.phase === 'DONE') {
    const finished: RelayRecord = {
      ...rec, status: 'DONE', result: poll.result,
      resultValidation: poll.resultValidation, transcriptExcerpt: poll.transcriptExcerpt, updatedAt: now,
    };
    saveRelay(finished);
    const accepted = poll.result?.unitAccepted ?? 'unknown';
    updateCase(rec.caseId, (cc) => ({
      ...cc,
      status: accepted === 'yes' ? 'CONFIRMED' : accepted === 'no' ? 'DECLINED' : 'DISPATCHED',
      timeline: [...cc.timeline, {
        kind: 'RELAY_RESULT', at: now, relayId: rec.id,
        detail: `Structured result — accepted: ${accepted}; ETA: ${poll.result?.etaMinutes ?? 'unknown'} min${poll.result?.notes ? `; notes: "${poll.result.notes}"` : ''}${poll.resultValidation ? `; schema validation: ${poll.resultValidation}` : ''}`,
      }],
    }));
    return NextResponse.json({ relay: finished });
  }

  // FAILED
  const failed: RelayRecord = { ...rec, status: 'FAILED', failure: poll.failure ?? 'provider reported failure', updatedAt: now };
  saveRelay(failed);
  updateCase(rec.caseId, (cc) => ({
    ...cc,
    status: 'TRIAGED',
    timeline: [...cc.timeline, { kind: 'RELAY_FAILED', at: now, relayId: rec.id, detail: `Call failed (${poll.failure ?? 'unknown provider failure'}). Case returned to the dispatcher. No automatic redial.` }],
  }));
  return NextResponse.json({ relay: failed });
}
