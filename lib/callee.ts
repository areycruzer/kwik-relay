// CALL-E adapter. One isolated place where the SDK is imported — the rest of
// the app talks to this module. Two-phase flow per the SDK surface:
//   createRelayCall()  → client.calls.create(input, { idempotencyKey })  (fast)
//   fetchRelayCall()   → client.calls.get(callId)                        (poll)
//
// Policy: single attempt, no voicemail, errors surface — never a silent retry
// (see lib/goals.ts policy block and the awesome-phone-call-agents review
// policy for live-capable demos).
//
// Env (server-side only):
//   CALLE_API_KEY  — required for REAL calls. Never exposed to the client.
//   CALLE_LOCALE   — default conversation locale for units ('hi').

import type { RelayRecord } from './types.ts';

export type ProviderPhase = 'IN_FLIGHT' | 'DONE' | 'FAILED';

export interface ProviderPoll {
  phase: ProviderPhase;
  calleStatus: string | null;
  result: RelayRecord['result'];
  resultValidation: string | null;
  transcriptExcerpt: string | null;
  failure: string | null;
}

export function calleConfigured(): boolean {
  return Boolean(process.env.CALLE_API_KEY);
}

async function client() {
  if (!process.env.CALLE_API_KEY) throw new Error('CALLE_API_KEY is not set on the server.');
  const mod = (await import('@call-e/calle')) as { CalleClient: new (o: { apiKey: string }) => any };
  return new mod.CalleClient({ apiKey: process.env.CALLE_API_KEY });
}

function normaliseResult(raw: unknown): RelayRecord['result'] {
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

const TERMINAL_OK = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'error', 'canceled', 'cancelled', 'expired']);

function phaseOf(status: string, failureCode: string | null): ProviderPhase {
  const s = status.toLowerCase();
  if (TERMINAL_BAD.has(s) || failureCode) return 'FAILED';
  if (TERMINAL_OK.has(s)) return 'DONE';
  return 'IN_FLIGHT';
}

/** Submit the call. Returns the provider call id immediately — the call runs
 *  asynchronously; poll with fetchRelayCall. */
export async function createRelayCall(record: RelayRecord): Promise<{ callId: string }> {
  const c = await client();
  const call = await c.calls.create(
    {
      task: record.payload.task,
      recipient: record.payload.recipient,
      resultSchema: record.payload.resultSchema,
      policy: record.payload.policy,
      metadata: record.payload.metadata,
    },
    // Stable dedupe key: replaying the same relay cannot double-call.
    { idempotencyKey: `kwik-relay-${record.id}` },
  );
  if (!call?.id) throw new Error('CALL-E did not return a call id.');
  return { callId: call.id };
}

/** Poll an in-flight call once. */
export async function fetchRelayCall(callId: string): Promise<ProviderPoll> {
  const c = await client();
  const call = await c.calls.get(callId);
  const status = typeof call?.status === 'string' ? call.status : 'unknown';
  const failureCode = call?.failureCode ?? null;
  const phase = phaseOf(status, failureCode);
  return {
    phase,
    calleStatus: status,
    result: phase === 'DONE' ? normaliseResult(call?.structuredResult) : null,
    resultValidation:
      call?.resultValidation != null ? String(JSON.stringify(call.resultValidation)).slice(0, 120) : null,
    transcriptExcerpt:
      typeof call?.transcript === 'string' && call.transcript.length
        ? call.transcript.slice(0, 280)
        : null,
    failure: failureCode ? `${failureCode}${call?.failureMessage ? `: ${call.failureMessage}` : ''}` : null,
  };
}
