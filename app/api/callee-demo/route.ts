/**
 * CALL-E demo-call endpoint — stateless by design (serverless-safe).
 *
 *   POST /api/callee-demo  { mode, locale?, phone?, consent? }  + x-demo-pin for REAL
 *     PREVIEW → returns the exact task text; no network, no call.
 *     REAL    → guards (operator PIN, consent, per-number cooldown, budget)
 *               → places ONE CALL-E call → returns { practiceId, callId }.
 *               phone is optional: defaults to the server's TESTER_NUMBER.
 *
 *   GET  /api/callee-demo?callId=<id>  → one provider poll.
 *   GET  /api/callee-demo?meta=1       → live budget window + tester info.
 *
 * Error codes on failure (machine-readable for the auto-fallback):
 *   401 PIN · 400 CONSENT/PHONE · 429 BUDGET | NUMBER_COOLDOWN · 502 CREDITS | PROVIDER
 */

import { NextResponse } from 'next/server';
import { buildIntakeTask, calleConfigured, createDemoCall, isCreditExhaustedError, maskE164, normaliseE164, pollDemoCall, localeLanguage } from '@/lib/callee.ts';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REAL_PER_WINDOW = 6;
const realCallTimes: number[] = [];
function budgetRemaining(): number {
  const now = Date.now();
  while (realCallTimes.length && now - realCallTimes[0] > WINDOW_MS) realCallTimes.shift();
  return Math.max(0, MAX_REAL_PER_WINDOW - realCallTimes.length);
}

// Per-number cooldown (best-effort, in-memory): one demo call per number per 15 min.
const NUMBER_COOLDOWN_MS = 15 * 60 * 1000;
const numberLastCall = new Map<string, number>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('meta') === '1') {
    const tester = normaliseE164(process.env.TESTER_NUMBER ?? '');
    return NextResponse.json({
      calleConfigured: calleConfigured(),
      testerConfigured: Boolean(tester),
      testerMasked: tester ? maskE164(tester) : null,
      budgetRemaining: budgetRemaining(),
      budgetMax: MAX_REAL_PER_WINDOW,
      budgetWindowMs: WINDOW_MS,
    });
  }
  const callId = url.searchParams.get('callId');
  if (!callId || !/^[A-Za-z0-9_-]{1,64}$/.test(callId)) {
    return NextResponse.json({ error: 'A valid callId query parameter is required.' }, { status: 400 });
  }
  if (!calleConfigured()) {
    return NextResponse.json({ error: 'CALLE_API_KEY is not set on the server.' }, { status: 503 });
  }
  try {
    const poll = await pollDemoCall(callId);
    return NextResponse.json(poll);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('calle-demo poll error (transient)', { message });
    return NextResponse.json({ phase: 'IN_FLIGHT', status: null, result: null, summary: null, failure: null });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode === 'REAL' ? 'REAL' : 'PREVIEW';
  const locale = typeof body?.locale === 'string' ? body.locale : 'hi';
  const pin = String(req.headers.get('x-demo-pin') ?? '');
  const customPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const consent = body?.consent === true;

  const tester = normaliseE164(process.env.TESTER_NUMBER ?? '');
  let phone = tester;
  let phoneIsCustom = false;
  if (customPhone) {
    const normalised = normaliseE164(customPhone);
    if (!normalised) {
      return NextResponse.json({ error: 'Enter a valid E.164 phone number (for example +919876543210).', code: 'PHONE' }, { status: 400 });
    }
    phone = normalised;
    phoneIsCustom = true;
  }
  if (!phone) {
    return NextResponse.json({ error: 'TESTER_NUMBER (E.164) is not configured on the server.', code: 'PROVIDER' }, { status: 503 });
  }

  const practiceId = `PRA-${Date.now().toString(36).toUpperCase()}`;
  const task = buildIntakeTask(phone, locale, practiceId);

  if (mode === 'PREVIEW') {
    return NextResponse.json({
      task,
      warning: 'PREVIEW only — no phone call was placed.',
      phoneMasked: maskE164(phone),
      language: localeLanguage(locale),
    });
  }

  const expectedPin = process.env.DEMO_PIN;
  if (!expectedPin) {
    return NextResponse.json({ error: 'Real demo calls are disabled: DEMO_PIN is not configured on the server (fail closed).', code: 'PIN' }, { status: 503 });
  }
  if (pin !== expectedPin) {
    return NextResponse.json({ error: 'Invalid demo PIN.', code: 'PIN' }, { status: 401 });
  }
  if (phoneIsCustom && !consent) {
    return NextResponse.json({ error: 'Tick the consent box: the number must be yours or its owner must have agreed to receive this demo call.', code: 'CONSENT' }, { status: 400 });
  }
  if (!calleConfigured()) {
    return NextResponse.json({ error: 'CALLE_API_KEY is not set on the server.', code: 'PROVIDER' }, { status: 503 });
  }
  if (budgetRemaining() <= 0) {
    return NextResponse.json({ error: 'Live demo budget reached for this window. The scripted demo runs the same pipeline.', code: 'BUDGET' }, { status: 429 });
  }
  const lastForNumber = numberLastCall.get(phone);
  if (lastForNumber && Date.now() - lastForNumber < NUMBER_COOLDOWN_MS) {
    const mins = Math.ceil((NUMBER_COOLDOWN_MS - (Date.now() - lastForNumber)) / 60000);
    return NextResponse.json({ error: `This number received a demo call recently — try again in ~${mins} min, or run the scripted demo.`, code: 'NUMBER_COOLDOWN' }, { status: 429 });
  }

  try {
    const { callId } = await createDemoCall(task, practiceId);
    realCallTimes.push(Date.now());
    numberLastCall.set(phone, Date.now());
    logger.info('calle demo call placed', { practiceId, callId, custom: phoneIsCustom });
    return NextResponse.json({
      practiceId,
      callId,
      phoneMasked: maskE164(phone),
      language: localeLanguage(locale),
      budgetRemaining: budgetRemaining(),
      notice: 'Call submitted — single attempt, cannot be recalled once placed. Poll for the structured intake.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('calle demo call failed', { message });
    if (isCreditExhaustedError(message)) {
      return NextResponse.json({ error: 'Live demo credits are exhausted on the CALL-E account. The scripted demo runs the same pipeline.', code: 'CREDITS' }, { status: 502 });
    }
    return NextResponse.json({ error: `Call submission failed — no call was placed: ${message}`, code: 'PROVIDER' }, { status: 502 });
  }
}
