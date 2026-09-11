// Deterministic intake rules (subset of the Kwik 112 triage engine, kept
// intentionally small: inbound intake is context for the CALL-E relay loop,
// not the point of this product). Rules run before anything else; the relay
// layer can never contradict them.

import type { EmergencyCase, PriorityCode, Severity } from './types.ts';

interface Rule { pattern: RegExp; type: string; severity: Severity }

const RULES: Rule[] = [
  { pattern: /\b(saans|breath|pulse|cardiac|heart attack|dil|unconscious|behosh)\b/i, type: 'Cardiac / breathing emergency', severity: 'CRITICAL' },
  { pattern: /\b(accident|tod|crash|khoon|bleeding|injur|road)\b/i, type: 'Road accident / trauma', severity: 'CRITICAL' },
  { pattern: /\b(fire|aag|smoke|jal)\b/i, type: 'Fire', severity: 'CRITICAL' },
  { pattern: /\b(theft|chor|assault|threat)\b/i, type: 'Police matter', severity: 'HIGH' },
  { pattern: /\b(fever|clinic|hospital visit|medicine)\b/i, type: 'Medical (non-urgent)', severity: 'MEDIUM' },
  { pattern: /\b(noise|complaint|query|information)\b/i, type: 'Routine information', severity: 'LOW' },
];

export const PRIORITY: Record<Severity, PriorityCode> = {
  CRITICAL: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4',
};

export function grade(callerPhrase: string, locationText: string): { incidentType: string; severity: Severity } {
  const hit = RULES.find((r) => r.pattern.test(callerPhrase));
  return { incidentType: hit?.type ?? 'Unclassified call', severity: hit?.severity ?? 'LOW' };
}

export function newCase(id: string, callerPhrase: string, locationText: string): EmergencyCase {
  const { incidentType, severity } = grade(callerPhrase, locationText);
  const now = new Date().toISOString();
  return {
    id, createdAt: now, callerPhrase, incidentType, severity,
    priority: PRIORITY[severity], locationText, status: 'TRIAGED',
    assignedUnitId: null, dispatcherNote: '',
    timeline: [{ kind: 'INTAKE', at: now, detail: `Graded ${severity} (${PRIORITY[severity]}) by local rules: ${incidentType}` }],
  };
}

export function serviceFor(severity: Severity, incidentType: string): 'POLICE' | 'AMBULANCE' | 'FIRE' {
  if (/fire/i.test(incidentType)) return 'FIRE';
  if (/cardiac|accident|medical/i.test(incidentType)) return 'AMBULANCE';
  return severity === 'CRITICAL' ? 'AMBULANCE' : 'POLICE';
}
