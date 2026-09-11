/**
 * CALL-E demo-call endpoint — stateless by design (serverless-safe).
 *
 *   POST /api/callee-demo  { mode: 'PREVIEW' | 'REAL', locale? }  + x-demo-pin for REAL
 *     PREVIEW → returns the exact task text; no network, no call.
 *     REAL    → guards (operator PIN, budget) → places ONE CALL-E call to the
 *               configured TESTER_NUMBER → returns { practiceId, callId }.
 *
 *   GET  /api/callee-demo?callId=<id>  → one provider poll.
 *
 * Safety enforced HERE, not just in the UI:
 *  - REAL is fail-closed without DEMO_PIN (basic auth, review policy)
 *  - one call per click, budget-capped, stable Idempotency-Key (no auto-redial)
 *  - the task always self-identifies as an AI demo — never the real 112
 */

import { NextResponse } from 'next/server';
import { buildIntakeTask, calleConfigured, createDemoCall, maskE164, normaliseE164, pollDemoCall, localeLanguage } from '@/lib/callee.ts';
import { logger } from '@/lib/logger';

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

export async function GET(req: Request) {
  const callId = new URL(req.url).searchParams.get('callId');
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
    // Transport errors are transient — keep the client polling.
    return NextResponse.json({ phase: 'IN_FLIGHT', status: null, result: null, summary: null, failure: null });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const mode = body?.mode === 'REAL' ? 'REAL' : 'PREVIEW';
  const locale = typeof body?.locale === 'string' ? body.locale : 'hi';
  const pin = String(req.headers.get('x-demo-pin') ?? '');

  const tester = normaliseE164(process.env.TESTER_NUMBER ?? '');
  if (!tester) {
    return NextResponse.json({ error: 'TESTER_NUMBER (E.164) is not configured on the server.' }, { status: 503 });
  }

  const practiceId = `PRA-${Date.now().toString(36).toUpperCase()}`;
  const task = buildIntakeTask(tester, locale, practiceId);

  if (mode === 'PREVIEW') {
    return NextResponse.json({
      task,
      warning: 'PREVIEW only — no phone call was placed.',
      testerMasked: maskE164(tester),
      language: localeLanguage(locale),
    });
  }

  const expectedPin = process.env.DEMO_PIN;
  if (!expectedPin) {
    return NextResponse.json(
      { error: 'Real demo calls are disabled: DEMO_PIN is not configured on the server (fail closed).' },
      { status: 503 },
    );
  }
  if (pin !== expectedPin) {
    return NextResponse.json({ error: 'Invalid demo PIN.' }, { status: 401 });
  }
  if (!calleConfigured()) {
    return NextResponse.json({ error: 'CALLE_API_KEY is not set on the server.' }, { status: 503 });
  }
  if (rateLimited()) {
    return NextResponse.json(
      { error: `Demo budget reached (${MAX_REAL_PER_WINDOW} calls / 10 min). Try again shortly.` },
      { status: 429 },
    );
  }

  try {
    const { callId } = await createDemoCall(task, practiceId);
    realCallTimes.push(Date.now());
    logger.info('calle demo call placed', { practiceId, callId });
    return NextResponse.json({
      practiceId,
      callId,
      testerMasked: maskE164(tester),
      language: localeLanguage(locale),
      notice: 'Call submitted — single attempt, cannot be recalled once placed. Poll for the structured intake.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('calle demo call failed', { message });
    return NextResponse.json({ error: `Call submission failed — no call was placed: ${message}` }, { status: 502 });
  }
}
