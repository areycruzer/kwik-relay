---
name: emergency-dispatch-relay
description: Relay a human-confirmed emergency dispatch decision to a response unit over a real phone call via CALL-E, and return a structured result (unit_accepted yes/no/unknown, eta_minutes, notes). Use when an operator must notify a field unit of an assignment and collect their response without a manual phone call. Preview-first; never dispatches on its own.
---

# Emergency Dispatch Relay

A portable skill that closes the outbound half of emergency dispatch: after a
**human** dispatcher confirms an assignment, CALL-E phones the unit, relays the
decision, and returns a structured answer the console can store.

## What it does

1. Takes a case (incident, severity, location) + a unit (name, E.164 number).
2. Builds a constrained English goal — the agent **only relays**; it must not
   instruct the unit to move, change the decision, or guess answers.
3. Calls the unit in the configured locale (default `hi`, region `IN`).
4. Returns a tri-state structured result:

```json
{
  "unit_accepted": "yes | no | unknown",
  "eta_minutes": "12",
  "notes": "Unit says bridge road is blocked, taking alternate route."
}
```

## Safety rules baked in

- **Preview first.** The default mode prints the exact payload without placing
  any call (`--real` is required to place a call).
- **Human decision required.** The script refuses to run without
  `--confirmed-by "name"` — a human must already have made the assignment.
- **Relay, never command.** The generated goal forbids instructing or
  pressuring the unit, and forbids creating or changing dispatch decisions.
- **Unknown over guesswork.** The schema is tri-state; uncertain answers come
  back as `unknown`.
- **No personal numbers in code.** Numbers arrive via flags or env, never
  hardcoded.

## Setup

```bash
pip install calle-ai        # or: npm i @call-e/calle for the TS version
export CALLE_API_KEY=...    # server/CLI side only
```

## Usage

```bash
# Preview the exact call (safe — places no call):
node scripts/relay.mjs \
  --case-id KWR-0001 \
  --incident "Cardiac / breathing emergency (CRITICAL P1)" \
  --location "Shalimar Bagh B-block, Delhi" \
  --unit-name "PCR Van 11" \
  --phone "+919999XXXXXX" \
  --confirmed-by "dispatcher-a"

# Place the real call (locale defaults to hi):
node scripts/relay.mjs ... --real
```

## Side effects

- `--real` places one real outbound phone call to the given number.
- PREVIEW mode (default) has zero side effects.

## Cancellation

This skill places single, bounded calls (goal caps at two minutes) via
`createAndWait`. There is no scheduling or recurrence — nothing to cancel
after the fact. For scheduling patterns, keep recurrence in the host
scheduler, not the skill (provider/host separation).

## References

- `references/goal-template.md` — the exact goal text with constraint rationale.
- `references/result-schema.json` — the tri-state result schema.
- Upstream: [call-e-integrations](https://github.com/CALLE-AI/call-e-integrations)
