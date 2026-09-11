// In-memory store for the demo console. Single source of truth; API routes
// mutate it. Seeded with one case per severity band so the queue is never
// empty, plus a reset endpoint for repeatable demos/judging.

import type { EmergencyCase, RelayRecord } from './types.ts';
import { newCase } from './triage.ts';

const cases = new Map<string, EmergencyCase>();
const relays = new Map<string, RelayRecord>();
let seq = 0;

export function seed() {
  if (cases.size > 0) return;
  addCase('Meri mummy ko saans nahi aa rahi, behosh hai', 'Shalimar Bagh B-block, Delhi');
  addCase('Road accident near metro pillar, one person bleeding', 'Rohini Sector 7, Delhi');
  addCase('Purse chori ho gaya, chor bhaag gaya', 'Pitampura market, Delhi');
  addCase('Noise complaint, DJ band hai raat ko', 'Model Town, Delhi');
}

export function addCase(callerPhrase: string, locationText: string): EmergencyCase {
  const id = `KWR-${String(++seq).padStart(4, '0')}`;
  const c = newCase(id, callerPhrase, locationText);
  cases.set(id, c);
  return c;
}

export function listCases(): EmergencyCase[] {
  return [...cases.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
export function getCase(id: string) { return cases.get(id) ?? null; }
export function updateCase(id: string, patch: (c: EmergencyCase) => EmergencyCase) {
  const c = cases.get(id); if (!c) return null;
  const next = patch(structuredClone(c));
  cases.set(id, next);
  return next;
}

export function saveRelay(r: RelayRecord) { relays.set(r.id, r); }
export function getRelay(id: string) { return relays.get(id) ?? null; }
export function listRelays(): RelayRecord[] {
  return [...relays.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function reset() { cases.clear(); relays.clear(); seq = 0; seed(); }
seed();
