// Goal + result-schema builder — the safety-critical core of Kwik Relay.
//
// Design contract (tested in goals.test.ts):
//  1. The CALL-E agent only RELAYS a human-confirmed dispatch decision.
//     It never decides, never dispatches on its own, and never instructs
//     the unit to move — it asks for availability and ETA.
//  2. The result schema is tri-state (yes / no / unknown) — real calls are
//     unpredictable; the console must always receive a predictable shape.
//  3. PREVIEW and REAL build the byte-identical payload from one function.

import type { CallTaskPayload, EmergencyCase, Unit } from './types.ts';

export const UNIT_RESULT_SCHEMA: CallTaskPayload['resultSchema'] = {
  unit_accepted: {
    type: 'string',
    enum: ['yes', 'no', 'unknown'],
    description: 'Can this unit respond to the relayed emergency assignment?',
  },
  eta_minutes: {
    type: 'string',
    enum: ['unknown'],
    description:
      'Estimated arrival time in minutes as stated by the unit. Use the number if stated, else "unknown".',
  },
  notes: {
    type: 'string',
    description: 'One short sentence of anything else the unit said, in English.',
  },
};

export function buildRelayGoal(c: EmergencyCase, u: Unit): string {
  return [
    `You are Kwik Relay, the outbound dispatcher assistant for an emergency control room. A human dispatcher has CONFIRMED the following assignment. Your job is ONLY to relay it and collect the unit's answer.`,
    `Incident: ${c.incidentType} (${c.severity}, ${c.priority}).`,
    `Location: ${c.locationText}.`,
    `Assign to: ${u.name} (${u.service}) based near ${u.baseArea}.`,
    `Collect exactly two things: (1) can the unit respond to this assignment, (2) their estimated arrival time in minutes.`,
    `Hard constraints: Do NOT instruct, order, or pressure the unit to move. Do NOT create or change the dispatch decision. Do NOT discuss other cases. If the line is unclear or the answer is uncertain, return "unknown" — never guess. Keep the call under two minutes. Identify yourself as calling on behalf of the emergency control room relay.`,
  ].join(' ');
}

export function buildCallTaskPayload(
  c: EmergencyCase,
  u: Unit,
  relayId: string,
  locale = process.env.CALLE_LOCALE ?? 'hi',
  region = 'IN',
): CallTaskPayload {
  const e164 = normaliseE164(u.e164);
  if (!e164) throw new Error(`Unit ${u.id} has no valid E.164 number`);
  return {
    task: buildRelayGoal(c, u),
    phones: [e164],
    region,
    locale,
    resultSchema: UNIT_RESULT_SCHEMA,
    metadata: { caseId: c.id, unitId: u.id, relayId, product: 'kwik-relay' },
  };
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
export function normaliseE164(input: string): string | null {
  const t = input.replace(/[\s\-()]/g, '');
  return E164_RE.test(t) ? t : null;
}

/** Map a spoken-language preference to a CALL-E locale, falling back safely. */
export const SUPPORTED_LOCALES = ['hi', 'en-IN', 'ta', 'te', 'bn', 'mr', 'pa', 'gu', 'kn', 'ml', 'as', 'or'] as const;
export function resolveLocale(requested?: string): string {
  if (!requested) return 'hi';
  return (SUPPORTED_LOCALES as readonly string[]).includes(requested) ? requested : 'en-IN';
}
