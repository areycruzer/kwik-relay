# Demo video plan (< 3 minutes, English, YouTube public)

Target track: **Most Practical Use Case** ($4,000). Judging mapped beat-by-beat.

| Time | Beat | On screen | Judging criterion served |
|---|---|---|---|
| 0:00–0:15 | "In a 112-style control room, deciding is half the job. The other half is a human stopping everything to phone the unit. We automated that half." | Console overview, queue | Real World Impact |
| 0:15–0:40 | Select CRITICAL case → show grade, location → Step 1: human picks PCR Van 11, writes note | Case detail + unit picker | Product Experience |
| 0:40–1:10 | **Preview first**: click Preview — show the exact payload, the hard constraints in the goal, tri-state schema. "No call placed. Anyone can inspect this." | Preview panel with JSON | Quality of Idea (safety design) |
| 1:10–2:00 | **The real call**: click Place CALL-E relay → phone rings on camera → answer in Hindi: "Haan, bhej do, 12 minute mein pahunchenge" → watch console flip to CONFIRMED with accepted=yes, ETA=12 | Split: console + ringing phone | Technical Implementation (CALL-E actually called) |
| 2:00–2:25 | Timeline: INTAKE → DISPATCH → RELAY_CALL → RELAY_RESULT, "every action auto-documented" + declined-unit flow (call 2nd unit) | Timeline + DECLINED→reassign | Completeness |
| 2:25–2:50 | "The same pattern works anywhere someone must stop and make a phone call — clinics, repairs, escalations. Kwik Relay: the AI phones; the human decides." | End card: repo + live URL | Close |

## Recording notes
- Reuse the kwik filming engine pattern: CDP-driven, ffmpeg region capture.
- Two phones on camera for the real-call beat (or one, filming the ring).
- Show the CALL-E console/balance page for 2s during setup beat (credibility).
- English VO, ~115 wpm; the Hindi call audio stays as the star moment.
- Before recording: real call tested twice on own number (uses 2 of 20 free calls).
