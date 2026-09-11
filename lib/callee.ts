/**
 * CALL-E adapter — the outbound demo-call leg of the voice station.
 *
 * The live demo call is placed through CALL-E's public REST API
 * (api.heycall-e.com/v1/calls): the server submits one call to the configured
 * TESTER_NUMBER, the phone agent identifies itself as an AI demo (never the
 * real 112), runs the practice intake in the chosen language, and returns a
 * structured intake. The rest of the pipeline — local triage rules, geocoding,
 * console, refinement — is exactly the same one scripted and Hume calls use.
 *
 * Wire facts verified against the live API (2026-09-11):
 *  - the E.164 recipient and conversation language travel INSIDE the task
 *    text; structured recipient/policy objects are rejected (extra_forbidden)
 *  - create returns an id immediately; poll GET /v1/calls/{id} until terminal
 *  - the request safety layer declines emergency-service coordination tasks;
 *    the self-identifying practice framing below is what it accepts
 *
 * Server-side only: CALLE_API_KEY never reaches the client.
 */

const BASE = () => process.env.CALLE_BASE_URL ?? 'https://api.heycall-e.com';

export const INTAKE_RESULT_SCHEMA: Record<string, { type: string; enum?: string[]; description: string }> = {
  emergency_type: {
    type: 'string',
    description:
      'One short phrase in English for the emergency the person described (for example "breathing emergency" or "road accident"). If nothing was described, return "none".',
  },
  location: {
    type: 'string',
    description:
      'The location exactly as the person stated it, as a short string. If no location was stated, return "unknown".',
  },
  urgency: {
    type: 'string',
    enum: ['critical', 'high', 'medium', 'low', 'unknown'],
    description: 'Your assessment of the urgency of what the person described.',
  },
  caller_clarity: {
    type: 'string',
    enum: ['clear', 'partial', 'unclear', 'unknown'],
    description: 'How clearly the person stated what happened and where.',
  },
};

const LANGUAGE_NAME: Record<string, string> = {
  hi: 'Hindi',
  'en-IN': 'Indian English',
  ta: 'Tamil',
  te: 'Telugu',
  bn: 'Bengali',
  mr: 'Marathi',
  pa: 'Punjabi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
};

export function localeLanguage(locale: string): string {
  return LANGUAGE_NAME[locale] ?? 'Hindi';
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
export function normaliseE164(input: string): string | null {
  const t = input.replace(/[\s\-()]/g, '');
  return E164_RE.test(t) ? t : null;
}

export function maskE164(input: string): string {
  return input.slice(0, 5) + '•••••' + input.slice(-3);
}

/**
 * The task CALL-E executes. The self-identification and the real-emergency
 * escape hatch are load-bearing: this exact framing passed the provider's
 * request safety review in live testing. Do not soften them.
 */
export function buildIntakeTask(testerE164: string, locale: string, practiceId: string): string {
  const language = localeLanguage(locale);
  return [
    `Call ${testerE164} now.`,
    `You are Kwik, a DEMO emergency-call intake simulator built for a hackathon. The person who answers requested this demo call — they will play the role of a citizen reporting an emergency.`,
    `SAFETY FIRST: Begin the call by clearly stating, in ${language}, that you are an AI demonstration and NOT the real 112 emergency service. If at any point the person indicates a real ongoing emergency, immediately tell them to hang up and dial the real emergency number 112.`,
    `Then run the practice intake in ${language}: ask (1) what happened, (2) where they are, (3) how urgent it is. Ask one question at a time, be calm and reassuring, and confirm the location back to them before finishing. Keep the practice call under three minutes.`,
    `Do NOT dispatch anyone, do NOT promise help is coming, do NOT claim to be a government service. This is a simulation of intake only.`,
  ].join(' ');
}

export function calleConfigured(): boolean {
  return Boolean(process.env.CALLE_API_KEY);
}

export type CallePhase = 'IN_FLIGHT' | 'DONE' | 'FAILED';

export interface CallePoll {
  phase: CallePhase;
  status: string | null;
  result: {
    emergencyType: string;
    location: string;
    urgency: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
    clarity: 'clear' | 'partial' | 'unclear' | 'unknown';
  } | null;
  summary: string | null;
  failure: string | null;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.CALLE_API_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function normaliseIntake(raw: unknown): NonNullable<CallePoll['result']> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const urgency = String(r.urgency ?? 'unknown').toLowerCase();
  const clarity = String(r.caller_clarity ?? 'unknown').toLowerCase();
  return {
    emergencyType: String(r.emergency_type ?? 'none').slice(0, 120) || 'none',
    location: String(r.location ?? 'unknown').slice(0, 160) || 'unknown',
    urgency: (['critical', 'high', 'medium', 'low', 'unknown'] as const).includes(urgency as never)
      ? (urgency as NonNullable<CallePoll['result']>['urgency'])
      : 'unknown',
    clarity: (['clear', 'partial', 'unclear', 'unknown'] as const).includes(clarity as never)
      ? (clarity as NonNullable<CallePoll['result']>['clarity'])
      : 'unknown',
  };
}

/** Submit the demo call; returns the provider call id immediately. */
export async function createDemoCall(task: string, practiceId: string): Promise<{ callId: string }> {
  const res = await fetch(`${BASE()}/v1/calls`, {
    method: 'POST',
    headers: authHeaders({ 'Idempotency-Key': `kwik-112-${practiceId}` }),
    body: JSON.stringify({
      task,
      result_schema: INTAKE_RESULT_SCHEMA,
      metadata: { practiceId, product: 'kwik-112' },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `CALL-E create failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const id = (body as { id?: string })?.id;
  if (!id) throw new Error('CALL-E did not return a call id.');
  return { callId: id };
}

const TERMINAL_OK = new Set(['completed', 'complete', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'error', 'canceled', 'cancelled', 'expired']);

/** Poll an in-flight demo call once. */
export async function pollDemoCall(callId: string): Promise<CallePoll> {
  const res = await fetch(`${BASE()}/v1/calls/${encodeURIComponent(callId)}`, {
    headers: authHeaders(),
  });
  const call = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (call as { error?: { message?: string } })?.error?.message ?? `CALL-E get failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  const c = call as Record<string, unknown>;
  const status = typeof c.status === 'string' ? c.status : 'unknown';
  const recipients = Array.isArray(c.recipients) ? (c.recipients as Record<string, unknown>[]) : [];
  const r0 = recipients[0] ?? {};
  // The concrete code often lives inside the first attempt (e.g. carrier "500").
  const attempts = Array.isArray(r0.attempts) ? (r0.attempts as Record<string, unknown>[]) : [];
  const a0 = attempts[0] ?? {};
  const failureCode = (c.failure_code ?? r0.failure_code ?? a0.failure_code ?? null) as string | null;
  const phase: CallePhase =
    TERMINAL_BAD.has(status.toLowerCase()) || failureCode
      ? 'FAILED'
      : TERMINAL_OK.has(status.toLowerCase())
        ? 'DONE'
        : 'IN_FLIGHT';
  const structured = (c.structured_result ?? r0.structured_result ?? null) as unknown;
  const summary = [a0.summary, r0.summary, c.summary]
    .filter((x) => typeof x === 'string' && x.length)
    .join(' ') as string | null;
  return {
    phase,
    status,
    result: phase === 'DONE' ? normaliseIntake(structured) : null,
    summary: summary ? summary.slice(0, 400) : null,
    failure: failureCode
      ? `${failureCode}${summary ? `: ${summary.slice(0, 160)}` : ''}`
      : phase === 'FAILED'
        ? 'provider reported failure'
        : null,
  };
}

/** True when a provider error looks like exhausted credits/balance/quota. */
export function isCreditExhaustedError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /credit|balance|quota|insufficient|exceeded|payment|limit reached/i.test(message);
}
