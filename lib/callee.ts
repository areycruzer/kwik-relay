// CALL-E adapter. One isolated place where the SDK is imported — the rest of
// the app talks to this module. PREVIEW mode never touches the network and
// returns the byte-identical payload REAL mode would send.
//
// Env:
//   CALLE_API_KEY  — required for REAL calls only. Server-side only; never
//                    exposed to the client or committed.
//   CALLE_LOCALE   — conversation locale for units (default 'hi').

import type { RelayRecord, RelayResult } from './types.ts';

export type CallOutcome =
  | { ok: true; result: RelayResult; completionConfidence: number | null; transcriptTurns: number | null; callId: string | null }
  | { ok: false; error: string };

export function calleConfigured(): boolean {
  return Boolean(process.env.CALLE_API_KEY);
}

function normaliseResult(raw: unknown): RelayResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const accepted = String(r.unit_accepted ?? 'unknown').toLowerCase();
  const etaRaw = r.eta_minutes ?? 'unknown';
  const eta = etaRaw === null || etaRaw === undefined || String(etaRaw).trim() === ''
    ? 'unknown'
    : String(etaRaw).trim();
  return {
    unitAccepted: accepted === 'yes' || accepted === 'no' ? accepted : 'unknown',
    etaMinutes: eta,
    notes: String(r.notes ?? '').slice(0, 300),
  };
}

/** Place a real call via the CALL-E SDK. Throws only on config errors —
 *  call failures come back as { ok: false } so the UI can show them. */
export async function placeRelayCall(record: RelayRecord): Promise<CallOutcome> {
  if (!calleConfigured()) {
    return { ok: false, error: 'CALLE_API_KEY is not set on the server. Add it to .env to enable real calls.' };
  }
  try {
    const mod = await import('@call-e/calle');
    const CalleClient = (mod as { CalleClient?: new (o: { apiKey: string }) => any }).CalleClient;
    if (!CalleClient) return { ok: false, error: 'CalleClient not found in @call-e/calle exports.' };
    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY! });
    const call = await client.calls.createAndWait({
      task: record.payload.task,
      phones: record.payload.phones,
      region: record.payload.region,
      locale: record.payload.locale,
      resultSchema: record.payload.resultSchema,
      metadata: record.payload.metadata,
    });
    const structured = (call as any)?.structured_result ?? (call as any)?.structuredResult ?? null;
    return {
      ok: true,
      callId: (call as any)?.id ?? (call as any)?.call_id ?? null,
      result: normaliseResult(structured),
      completionConfidence: typeof (call as any)?.completion_confidence === 'number'
        ? (call as any).completion_confidence
        : null,
      transcriptTurns: Array.isArray((call as any)?.transcript_turns)
        ? (call as any).transcript_turns.length
        : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
