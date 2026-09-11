// Kwik Relay — shared domain types

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type PriorityCode = 'P1' | 'P2' | 'P3' | 'P4';

export type CaseStatus =
  | 'TRIAGED'        // graded, awaiting human dispatch decision
  | 'DISPATCHED'     // human confirmed a unit; relay call in flight
  | 'CONFIRMED'      // unit accepted (structured result: yes)
  | 'DECLINED'       // unit declined — dispatcher must pick another unit
  | 'CLOSED';

export interface EmergencyCase {
  id: string;
  createdAt: string;
  callerPhrase: string;      // one-line caller summary (source of the grade)
  incidentType: string;      // e.g. Cardiac, Road accident
  severity: Severity;
  priority: PriorityCode;
  locationText: string;      // free-text spoken location
  status: CaseStatus;
  assignedUnitId: string | null;
  dispatcherNote: string;    // written reason, required at dispatch (human-in-loop)
  timeline: TimelineEntry[];
}

export type TimelineKind =
  | 'INTAKE'          // case graded by rules
  | 'DISPATCH'        // human decision recorded
  | 'RELAY_PREVIEW'   // dry-run payload inspected
  | 'RELAY_CALL'      // real CALL-E call submitted (single attempt)
  | 'RELAY_RESULT'    // structured result received
  | 'RELAY_FAILED';

export interface TimelineEntry {
  kind: TimelineKind;
  at: string;
  detail: string;
  relayId?: string;
}

export interface Unit {
  id: string;
  name: string;              // e.g. "PCR Van 11"
  service: 'POLICE' | 'AMBULANCE' | 'FIRE';
  e164: string;              // masked-safe placeholder by default; set via env/config
  baseArea: string;
  ready: boolean;
}

export type RelayMode = 'PREVIEW' | 'REAL';
export type RelayStatus = 'SUBMITTED' | 'DONE' | 'FAILED';

export interface RelayResult {
  unitAccepted: 'yes' | 'no' | 'unknown';
  etaMinutes: string;        // numeric string or 'unknown'
  notes: string;
}

export interface RelayRecord {
  id: string;
  caseId: string;
  unitId: string;
  mode: RelayMode;
  status: RelayStatus;
  calleCallId: string | null; // provider call id, set the moment a real call is accepted
  payload: CallTaskPayload;   // exact task submitted (or previewed) — full auditability
  result: RelayResult | null;
  resultValidation: string | null;   // provider-side schema validation outcome
  transcriptExcerpt: string | null;  // first lines of the provider transcript
  failure: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The exact CALL-E task payload we build. Kept as a plain serialisable object
 *  so PREVIEW mode can show precisely what REAL mode would send. Mirrors the
 *  SDK's CreateCallInput (task + recipient + resultSchema + policy). */
export interface CallTaskPayload {
  task: string;              // English goal with safety constraints
  recipient: {
    phone: string;           // E.164
    region: string;          // ISO 3166-1 alpha-2, e.g. 'IN'
    locale: string;          // conversation language for the recipient, e.g. 'hi'
    name?: string;           // unit name, spoken naturally
  };
  resultSchema: Record<string, { type: string; enum?: string[]; description: string }>;
  policy: {
    maxAttempts: 1;          // single attempt — no automatic redial (review policy)
    voicemail: 'do_not_leave';
    onNotReady: 'error';     // surface failures; never silently retry
  };
  metadata: { caseId: string; unitId: string; relayId: string; product: 'kwik-relay' };
}
