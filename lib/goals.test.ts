import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCallTaskPayload, buildRelayGoal, normaliseE164, resolveLocale, UNIT_RESULT_SCHEMA } from './goals.ts';
import { newCase, grade, PRIORITY } from './triage.ts';
import type { Unit } from './types.ts';

const unit: Unit = { id: 'pcr-11', name: 'PCR Van 11', service: 'POLICE', e164: '+919999112011', baseArea: 'Rohini', ready: true };
const c = newCase('KWR-0001', 'Meri mummy ko saans nahi aa rahi', 'Shalimar Bagh B-block');

test('goal always frames the call as a relay of a human decision', () => {
  const g = buildRelayGoal(c, unit);
  assert.match(g, /human dispatcher has CONFIRMED/i);
  assert.match(g, /ONLY to relay/i);
});

test('goal contains hard safety constraints — never instructs the unit to move', () => {
  const g = buildRelayGoal(c, unit);
  assert.match(g, /Do NOT instruct, order, or pressure/i);
  assert.match(g, /Do NOT create or change the dispatch decision/i);
  assert.match(g, /never guess/i);
});

test('unit_accepted is tri-state; eta_minutes is free-form so numbers can come back', () => {
  assert.deepEqual(UNIT_RESULT_SCHEMA.unit_accepted.enum, ['yes', 'no', 'unknown']);
  assert.equal(UNIT_RESULT_SCHEMA.eta_minutes.enum, undefined, 'eta must not be enum-locked to unknown');
  assert.match(UNIT_RESULT_SCHEMA.eta_minutes.description, /digits/);
  assert.match(UNIT_RESULT_SCHEMA.eta_minutes.description, /unknown/);
});

test('policy block: single attempt, no voicemail, errors surface — never a silent retry', () => {
  const p = buildCallTaskPayload(c, unit, 'REL-0001').policy;
  assert.equal(p.maxAttempts, 1);
  assert.equal(p.voicemail, 'do_not_leave');
  assert.equal(p.onNotReady, 'error');
});

test('payload targets the SDK recipient shape (E.164, region IN, locale hi, unit name)', () => {
  const p = buildCallTaskPayload(c, unit, 'REL-0001');
  assert.equal(p.recipient.phone, '+919999112011');
  assert.equal(p.recipient.region, 'IN');
  assert.equal(p.recipient.locale, 'hi');
  assert.equal(p.recipient.name, 'PCR Van 11');
  assert.deepEqual(p.metadata, { caseId: 'KWR-0001', unitId: 'pcr-11', relayId: 'REL-0001', product: 'kwik-relay' });
  assert.equal(p.resultSchema, UNIT_RESULT_SCHEMA);
});

test('PREVIEW and REAL are byte-identical from one builder', () => {
  const a = buildCallTaskPayload(c, unit, 'REL-0002');
  const b = buildCallTaskPayload(c, unit, 'REL-0002');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('E.164 normalisation rejects junk', () => {
  assert.equal(normaliseE164('+91 99991 12011'), '+919999112011');
  assert.equal(normaliseE164('919999112011'), null);
  assert.equal(normaliseE164('+91-999-'), null);
});

test('locale resolution falls back to en-IN for unsupported languages', () => {
  assert.equal(resolveLocale('hi'), 'hi');
  assert.equal(resolveLocale('ta'), 'ta');
  assert.equal(resolveLocale('xx-unknown'), 'en-IN');
  assert.equal(resolveLocale(undefined), 'hi');
});

test('intake rules grade breathing emergencies CRITICAL', () => {
  const g = grade('saans nahi aa rahi behosh', 'x');
  assert.equal(g.severity, 'CRITICAL');
  assert.equal(PRIORITY[g.severity], 'P1');
  assert.equal(grade('noise complaint', 'x').severity, 'LOW');
});

test('case timeline starts with an INTAKE record', () => {
  assert.equal(c.timeline[0].kind, 'INTAKE');
  assert.match(c.timeline[0].detail, /CRITICAL/);
});
