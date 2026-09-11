// CALL-E adapter — one isolated place that talks to the provider.
// Uses the public REST API directly (api.heycall-e.com/v1/calls) because the
// live endpoint's accepted fields (task with embedded E.164 + result_schema
// + metadata) are narrower than the SDK's typed surface, which the server
// rejects as extra_forbidden. Verified against production 2026-09-11.
//
// Flow: createRelayCall() → POST /v1/calls (fast, returns id)
//       fetchRelayCall()  → GET  /v1/calls/{id}  (poll)
//
// Single attempt: we never retry automatically — an ambiguous or failed call
// returns to the human coordinator (see review policy: no auto-redial).
//
// Env (server-side only):
//   CALLE_API_KEY   required for REAL calls. Never exposed to the client.
//   CALLE_BASE_URL  optional override (default https://api.heycall-e.com)
//   CALLE_LOCALE    default conversation language ('hi')

import type { IntakeResult, PracticeCall } from './types.ts';

const BASE = () => process.env.CALLE_BASE_URL ?? 'https://api.heycall-e.com';

export type ProviderPhase = 'IN_FLIGHT' | 'DONE' | 'FAILED';

export interface ProviderPoll {
  phase: ProviderPhase;
  calleStatus: string | null;
  result: IntakeResult | null;
  summary: string | null;
  failure: string | null;
}

export function calleConfigured(): boolean {
  return Boolean(process.env.CALLE_API_KEY);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.CALLE_API_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function normaliseIntake(raw: unknown): IntakeResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const urgency = String(r.urgency ?? 'unknown').toLowerCase();
  const clarity = String(r.caller_clarity ?? 'unknown').toLowerCase();
  return {
    emergencyType: String(r.emergency_type ?? 'none').slice(0, 120) || 'none',
    location: String(r.location ?? 'unknown').slice(0, 160) || 'unknown',
    urgency: (['critical','high','medium','low','unknown'] as const).includes(urgency as never) ? urgency as IntakeResult['urgency'] : 'unknown',
    clarity: (['clear','partial','unclear','unknown'] as const).includes(clarity as never) ? clarity as IntakeResult['clarity'] : 'unknown',
  };
}

/** Submit the call. Returns the provider call id immediately — the call runs
 *  asynchronously; poll with fetchRelayCall. */
export async function createCall(record: PracticeCall): Promise<{ callId: string }> {
  const res = await fetch(`${BASE()}/v1/calls`, {
    method: 'POST',
    headers: authHeaders({ 'Idempotency-Key': `kwik-relay-${record.id}` }),
    body: JSON.stringify({
      task: record.payload.task,
      result_schema: record.payload.resultSchema,
      metadata: record.payload.metadata,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as any)?.error?.message ?? `CALL-E create failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const id = (body as any)?.id;
  if (!id) throw new Error('CALL-E did not return a call id.');
  return { callId: String(id) };
}

const TERMINAL_OK = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'error', 'canceled', 'cancelled', 'expired']);

/** Poll an in-flight call once. Tolerant of top-level and per-recipient fields. */
export async function fetchCall(callId: string): Promise<ProviderPoll> {
  const res = await fetch(`${BASE()}/v1/calls/${encodeURIComponent(callId)}`, {
    headers: authHeaders(),
  });
  const call = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (call as any)?.error?.message ?? `CALL-E get failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const c = call as Record<string, any>;
  const status = typeof c.status === 'string' ? c.status : 'unknown';
  const recipients = Array.isArray(c.recipients) ? c.recipients : [];
  const r0 = recipients[0] ?? {};
  const failureCode = c.failure_code ?? r0.failure_code ?? null;
  const phase: ProviderPhase = TERMINAL_BAD.has(status.toLowerCase()) || failureCode
    ? 'FAILED'
    : TERMINAL_OK.has(status.toLowerCase())
      ? 'DONE'
      : 'IN_FLIGHT';
  const structured = c.structured_result ?? r0.structured_result ?? null;
  const summary = [r0.summary, c.summary].filter((x) => typeof x === 'string' && x.length).join(' ') || null;
  return {
    phase,
    calleStatus: status,
    result: phase === 'DONE' ? normaliseIntake(structured) : null,
    summary: summary ? summary.slice(0, 400) : null,
    failure: failureCode
      ? `${failureCode}${summary ? `: ${summary.slice(0, 160)}` : ''}`
      : phase === 'FAILED' ? 'provider reported failure' : null,
  };
}
