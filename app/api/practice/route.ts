// Practice-call endpoint — stateless core (serverless-safe).
//
//  POST /api/practice  { mode: 'PREVIEW' | 'REAL', locale? }  + x-demo-pin for REAL
//    PREVIEW → returns the exact task payload; no network, no call.
//    REAL    → guards (PIN, budget) → places the CALL-E call to the
//              configured TESTER_NUMBER → returns the record.
//
// Safety contract enforced HERE:
//  1. REAL requires the operator PIN (fail-closed without DEMO_PIN).
//  2. The task always self-identifies as an AI demo — never the real 112.
//  3. Single attempt, no auto-redial; budget-capped.
import { NextResponse } from 'next/server';
import { buildIntakeTask, localeLanguage, maskE164, normaliseE164, resolveLocale } from '@/lib/goals.ts';
import { calleConfigured, createCall } from '@/lib/callee.ts';
import type { PracticeCall } from '@/lib/types.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REAL_PER_WINDOW = 6;
const realCallTimes: number[] = [];
function rateLimited(): boolean {
  const now = Date.now();
  while (realCallTimes.length && now - realCallTimes[0] > WINDOW_MS) realCallTimes.shift();
  return realCallTimes.length >= MAX_REAL_PER_WINDOW;
}

export async function GET() {
  const tester = normaliseE164(process.env.TESTER_NUMBER ?? '');
  return NextResponse.json({
    calleConfigured: calleConfigured(),
    testerConfigured: Boolean(tester),
    testerMasked: tester ? maskE164(tester) : null,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode === 'REAL' ? 'REAL' : 'PREVIEW';
  const pin = String(req.headers.get('x-demo-pin') ?? '');
  const locale = resolveLocale(typeof body?.locale === 'string' ? body.locale : undefined);

  const tester = normaliseE164(process.env.TESTER_NUMBER ?? '');
  if (!tester) {
    return NextResponse.json({ error: 'TESTER_NUMBER (E.164) is not configured on the server.' }, { status: 503 });
  }

  const id = `PRA-${Date.now().toString(36).toUpperCase()}`;
  const payload = buildIntakeTask(tester, locale, id);
  const now = new Date().toISOString();

  const base: PracticeCall = {
    id, createdAt: now, updatedAt: now,
    language: localeLanguage(locale), locale,
    testerE164Masked: maskE164(tester),
    mode, status: 'SUBMITTED', calleCallId: null, payload,
    result: null, summary: null, failure: null, severity: null, priority: null,
  };

  if (mode === 'PREVIEW') {
    return NextResponse.json({
      practice: { ...base, status: 'DONE' },
      warning: 'PREVIEW only — no phone call was placed.',
    });
  }

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

  try {
    const { callId } = await createCall(base);
    realCallTimes.push(Date.now());
    const submitted: PracticeCall = { ...base, calleCallId: callId, updatedAt: new Date().toISOString() };
    return NextResponse.json({
      practice: submitted,
      notice: 'Practice call submitted — single attempt, cannot be recalled once placed. Polling for the structured intake.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Call submission failed — no call was placed: ${msg}` }, { status: 502 });
  }
}
