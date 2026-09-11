// Kwik — shared domain types. One product, one loop:
// a self-identifying AI practice call that runs the citizen-side emergency
// intake and returns structured data a human control room could use.

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type PriorityCode = 'P1' | 'P2' | 'P3' | 'P4';

export type Urgency = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type Clarity = 'clear' | 'partial' | 'unclear' | 'unknown';

export interface IntakeResult {
  emergencyType: string;   // short English phrase, e.g. "breathing emergency"
  location: string;        // location as the caller stated it
  urgency: Urgency;
  clarity: Clarity;        // how clearly the caller stated things
}

export interface PracticeCall {
  id: string;
  createdAt: string;
  updatedAt: string;
  language: string;        // conversation language name, e.g. 'Hindi'
  locale: string;          // locale code, e.g. 'hi'
  testerE164Masked: string;
  mode: 'PREVIEW' | 'REAL';
  status: 'SUBMITTED' | 'DONE' | 'FAILED';
  calleCallId: string | null;
  payload: CallTaskPayload;          // exact task sent (or previewed) — auditable
  result: IntakeResult | null;
  summary: string | null;            // provider-side call summary (evidence)
  failure: string | null;
  severity: Severity | null;         // derived locally from the intake (rules)
  priority: PriorityCode | null;
}

/** The exact CALL-E task payload. Matches the live /v1/calls contract
 *  (verified 2026-09-11): E.164 recipient + language embedded in the task
 *  text; result_schema + metadata as structured companions. */
export interface CallTaskPayload {
  task: string;
  resultSchema: Record<string, { type: string; enum?: string[]; description: string }>;
  metadata: { practiceId: string; product: 'kwik' };
}
