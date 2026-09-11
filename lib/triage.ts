// Deterministic local rules: turn a structured intake result into the
// severity/priority a human control room would see. Rules run locally;
// the phone agent's assessment is input, never the final word.

import type { IntakeResult, PriorityCode, Severity } from './types.ts';

const URGENCY_SEVERITY: Record<string, Severity> = {
  critical: 'CRITICAL', high: 'HIGH', medium: 'MEDIUM', low: 'LOW', unknown: 'UNKNOWN',
};

/** Content can only escalate, never de-escalate: a caller whose words match
 *  life-critical patterns is CRITICAL regardless of a calmer urgency read. */
const ESCALATION: Array<[RegExp, Severity]> = [
  [/\b(saans|breath|not breathing|pulse|cardiac|heart|dil|behosh|unconscious|bleed|khoon|drown)\b/i, 'CRITICAL'],
  [/\b(fire|aag|smoke|collapse|gira|stuck|trap)\b/i, 'CRITICAL'],
  [/\b(accident|crash|injur|fracture)\b/i, 'HIGH'],
];

export function gradeIntake(r: IntakeResult): { severity: Severity; priority: PriorityCode } {
  let severity = URGENCY_SEVERITY[r.urgency] ?? 'UNKNOWN';
  for (const [re, sev] of ESCALATION) {
    if (re.test(`${r.emergencyType} ${r.location}`)) {
      const order: Severity[] = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
      if (order.indexOf(sev) > order.indexOf(severity)) severity = sev;
    }
  }
  const priority: Record<Severity, PriorityCode> = {
    CRITICAL: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4', UNKNOWN: 'P4',
  };
  return { severity, priority: priority[severity] };
}
