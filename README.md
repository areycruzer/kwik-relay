# Kwik — emergency-call intake, practiced on real calls

**The citizen's 112 call, made testable: a self-identifying AI intake agent
that runs the practice call on a real phone line via CALL-E and returns the
structured intake a control room would need.**

Built for the [CALL-E: Your Code Is Calling hackathon](https://call-e.devpost.com).
Independent demo — not an official 112 service.

## The problem this solves

When a citizen dials 112 in a panic, the quality of what the call-taker
receives — what happened, where, how urgent — decides everything downstream.
Today that skill is untestable: you cannot rehearse an emergency call, and
agencies cannot train citizens or new call-takers against a real line without
tying one up. Kwik turns that call into something you can practice and
measure: an AI agent phones the participant, clearly identifies itself as a
demo (never the real 112), runs the intake conversation in the participant's
language, and returns structured data:

```json
{
  "emergency_type": "breathing emergency",
  "location": "Shalimar Bagh B-block, Delhi",
  "urgency": "critical",
  "caller_clarity": "partial"
}
```

Local deterministic rules then grade every intake into the severity/priority
a control room would see — and the rules can only escalate, never downplay
(life-critical words like "not breathing" grade CRITICAL regardless of a
calmer agent read).

## Why it's built this way (safety, discovered live)

While testing against production (2026-09-11) we found CALL-E's request
safety layer **declines tasks involving emergency dispatch or
emergency-service coordination** (HTTP 422 `call_not_ready`, verbatim:
*"I can't place or plan calls involving emergency dispatch or
emergency-service coordination… please revise the request to a non-emergency
use case."*). We respect that boundary. The agent therefore never answers as,
or speaks for, the 112 service:

- **Self-identification first.** Every call opens with a clear statement, in
  the participant's language, that this is an AI demonstration and NOT the
  real 112.
- **Real-emergency escape hatch.** If a participant indicates a real ongoing
  emergency, the agent tells them to hang up and dial the real emergency
  number immediately.
- **Intake only.** The agent never dispatches anyone, never promises help is
  coming, and never claims to be a government service.
- **The agent's read is an input, never the verdict.** Severity comes from
  local rules that can escalate but never downgrade.

## Quick start

```bash
npm install
cp .env.example .env   # set CALLE_API_KEY, DEMO_PIN, TESTER_NUMBER (E.164)
npm run dev            # http://localhost:3000
```

- **Preview mode** (no key needed): builds and displays the exact task —
  no call placed, fully inspectable.
- **Real mode**: with `CALLE_API_KEY` + `DEMO_PIN` + `TESTER_NUMBER` set, the
  red button places one practice call to the tester phone (single attempt,
  no redial), polls for completion, and grades the returned intake.

## Review-policy compliance (live-capable demo tier)

Per the `awesome-phone-call-agents` community review policy:

| Requirement | How Kwik satisfies it |
|---|---|
| Explicit per-run operator intent | Confirm dialog + explicit Preview/Real buttons |
| Basic authentication for remote real calling | Server-side `DEMO_PIN` (fail-closed without it) |
| Authorized valid E.164 destinations | Single configured `TESTER_NUMBER` (the operator's own phone) |
| Masked real phone numbers | Tester number masked in API and UI; env-only, never code |
| No automatic redial after ambiguous outcomes | One call per click, one in flight, 6-call/10-min budget |
| Stable intent/dedupe key | `Idempotency-Key: kwik-<practiceId>` on every create |
| Honest cancellation limits | UI states a submitted call cannot be recalled |

## Run the tests

```bash
npm test   # self-ID lines, escape hatch, schema shape, grading escalation, preview parity
```

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind 4 · CALL-E REST API
(`api.heycall-e.com/v1/calls`) · node:test · MIT license.
