// Intake task builder — the safety-critical core.
//
// Contract (tested in goals.test.ts):
//  1. The agent ALWAYS opens by identifying itself as an AI demonstration,
//     NOT the real 112 — this line is what keeps the call honest.
//  2. Real-emergency escape hatch: if the person reports a real ongoing
//     emergency, the agent must tell them to hang up and dial the real
//     emergency number.
//  3. Intake only: never dispatch, never promise help, never claim to be a
//     government service.
//  4. Structured result: categorical fields tri-state-or-better; free-form
//     strings for phrases.
//  5. PREVIEW and REAL build the byte-identical payload from one function.

import type { CallTaskPayload } from './types.ts';

export const INTAKE_RESULT_SCHEMA: CallTaskPayload['resultSchema'] = {
  emergency_type: {
    type: 'string',
    description: 'One short phrase in English for the emergency the person described (for example "breathing emergency" or "road accident"). If nothing was described, return "none".',
  },
  location: {
    type: 'string',
    description: 'The location exactly as the person stated it, as a short string. If no location was stated, return "unknown".',
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
  hi: 'Hindi', 'en-IN': 'Indian English', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam',
  as: 'Assamese', or: 'Odia',
};

/** The task that CALL-E executes. The self-identification and escape lines
 *  are load-bearing: this exact framing passed the provider's request safety
 *  review in live testing (2026-09-11). Do not soften them. */
export function buildIntakeTask(testerE164: string, locale: string, practiceId: string): CallTaskPayload {
  return {
    task: [
      `Call ${testerE164} now.`,
      `You are Kwik, a DEMO emergency-call intake simulator built for a hackathon. The person who answers is the developer who built you, testing the system — they will play the role of a citizen reporting an emergency.`,
      `SAFETY FIRST: Begin the call by clearly stating, in ${LANGUAGE_NAME[locale] ?? 'Hindi'}, that you are an AI demonstration and NOT the real 112 emergency service. If at any point the person indicates a real ongoing emergency, immediately tell them to hang up and dial the real emergency number 112.`,
      `Then run the practice intake in ${LANGUAGE_NAME[locale] ?? 'Hindi'}: ask (1) what happened, (2) where they are, (3) how urgent it is. Ask one question at a time, be calm and reassuring, and confirm the location back to them before finishing. Keep the practice call under three minutes.`,
      `Do NOT dispatch anyone, do NOT promise help is coming, do NOT claim to be a government service. This is a simulation of intake only.`,
    ].join(' '),
    resultSchema: INTAKE_RESULT_SCHEMA,
    metadata: { practiceId, product: 'kwik' },
  };
}

const E164_RE = /^\+[1-9]\d{6,14}$/;
export function normaliseE164(input: string): string | null {
  const t = input.replace(/[\s\-()]/g, '');
  return E164_RE.test(t) ? t : null;
}

export function maskE164(input: string): string {
  return input.slice(0, 5) + '•••••' + input.slice(-3);
}

export const SUPPORTED_LOCALES = ['hi', 'en-IN', 'ta', 'te', 'bn', 'mr', 'pa', 'gu', 'kn', 'ml', 'as', 'or'] as const;
export function resolveLocale(requested?: string): string {
  if (!requested) return 'hi';
  return (SUPPORTED_LOCALES as readonly string[]).includes(requested) ? requested : 'en-IN';
}
export function localeLanguage(locale: string): string {
  return LANGUAGE_NAME[locale] ?? 'Hindi';
}
