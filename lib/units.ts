// Unit roster. Numbers are MASKED placeholders by default — set real test
// numbers via env (UNIT_NUMBER_<ID>, E.164) so nothing personal is committed.
// For the hackathon demo, the "unit" is the operator's own phone, exactly as
// CALL-E's own tutorial recommends for first tests.

import type { Unit } from './types.ts';

const BASE_ROSTER: Omit<Unit, 'e164'>[] = [
  { id: 'pcr-11', name: 'PCR Van 11', service: 'POLICE', baseArea: 'Rohini', ready: true },
  { id: 'pcr-24', name: 'PCR Van 24', service: 'POLICE', baseArea: 'Pitampura', ready: true },
  { id: 'cats-302', name: 'Ambulance 302 (CATS)', service: 'AMBULANCE', baseArea: 'Shalimar Bagh', ready: true },
  { id: 'cats-309', name: 'ALS Ambulance 309 (CATS)', service: 'AMBULANCE', baseArea: 'Model Town', ready: true },
  { id: 'dfs-204', name: 'Fire Tender 204 (DFS)', service: 'FIRE', baseArea: 'Ashok Vihar', ready: true },
];

export function unitRoster(): Unit[] {
  return BASE_ROSTER.map((u) => ({
    ...u,
    e164: process.env[`UNIT_NUMBER_${u.id.toUpperCase().replace(/-/g, '_')}`] ?? '+919999000000',
  }));
}

export function findUnit(id: string): Unit | undefined {
  return unitRoster().find((u) => u.id === id);
}
