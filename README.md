# Kwik Relay — the outbound half of emergency dispatch

**A dispatcher console where CALL-E phone agents relay human-confirmed dispatch
decisions to emergency response units — and bring back structured answers.**

Built for the [CALL-E: Your Code Is Calling hackathon](https://call-e.devpost.com).
Independent synthetic demo — not an official 112 service.

## The problem this solves

In a 112-style emergency control room, the inbound half is only half the job.
After a case is graded and a dispatcher decides *"PCR Van 11 takes this"*, a
human still has to **stop everything and phone the unit** — read out the
location, ask if they can respond, note the ETA, and log it. That outbound leg
is manual phone work: slow, untracked, and it scales badly on a busy night.

Kwik Relay closes that loop with CALL-E:

```
case graded → human dispatcher confirms unit (+ written note)
           → CALL-E agent calls the unit (Hindi or English)
           → structured result returns: unit_accepted (yes|no|unknown),
             eta_minutes, notes, completion confidence
           → result lands on the case timeline — auto-documented
```

The same pattern generalises to any workflow where *"someone has to stop what
they're doing and make a phone call"*: clinic availability checks, repair
services, school closures, field-staff escalations.

## Safety design (the point of this project)

1. **The AI never decides.** A real relay call is impossible until a human
   dispatcher records a dispatch decision with a written note. The constraint
   is enforced server-side in the API route, not just the UI.
2. **Relay, not command.** Every generated goal contains hard constraints:
   *do not instruct, order, or pressure the unit to move; do not create or
   change the dispatch decision; return "unknown" rather than guess.*
3. **Tri-state results, always.** Real calls are unpredictable — the schema
   is `yes | no | unknown`, so the console always receives a predictable
   shape even when the line is bad or the answer is unclear.
4. **Preview before every call.** PREVIEW mode builds the byte-identical
   payload and shows it — no network, no call, fully inspectable. Safe to
   try by anyone, including judges.
5. **Full auditability.** The exact payload sent to CALL-E is stored on the
   relay record and rendered on the case timeline, alongside the structured
   result and confidence.
6. **No secrets, no personal numbers.** API key lives server-side only;
   unit numbers are masked placeholders configured via env; the units API
   masks E.164 numbers in responses.

## Quick start

```bash
npm install
cp .env.example .env      # add CALLE_API_KEY for real calls; preview works without it
npm run dev               # http://localhost:3000
```

- Without `CALLE_API_KEY`: the console runs in **PREVIEW mode** — grade cases,
  dispatch, inspect exact call payloads. No phone calls are possible.
- With `CALLE_API_KEY` + your own phone number set for a unit (E.164, see
  `.env.example`): the red **Place CALL-E relay** button makes a real call,
  in Hindi (`hi`) or Indian English (`en-IN`) — first test on your own number,
  exactly as CALL-E recommends.

## Run the tests

```bash
npm test    # goal safety constraints, schema shape, E.164 validation, dry-run parity
```

## Repo layout

- `lib/goals.ts` — goal + result-schema builder (the safety-critical core)
- `lib/callee.ts` — the single place the CALL-E SDK is imported
- `app/api/relay/route.ts` — relay lifecycle; enforces human-dispatch-before-call
- `app/page.tsx` — dispatcher console (queue, decision, preview, results, timeline)
- `skills/emergency-dispatch-relay/` — portable standalone skill (also submitted
  as a PR to `awesome-phone-call-agents`)

## Stack

Next.js 15 · React 19 · TypeScript · Tailwind 4 · `@call-e/calle` SDK ·
node:test · MIT license.
