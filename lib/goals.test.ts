import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeTask, INTAKE_RESULT_SCHEMA, localeLanguage, maskE164, normaliseE164, resolveLocale } from './goals.ts';
import { gradeIntake } from './triage.ts';

test('task embeds the E.164 recipient and the conversation language', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t.task, /^Call \+918588077790 now\./);
  assert.match(t.task, /practice intake in Hindi/);
});

test('task always self-identifies as an AI demo — never the real 112', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t.task, /AI demonstration and NOT the real 112/i);
  assert.ok(!/you are (a|the) 112 operator/i.test(t.task), 'must never claim to be a 112 operator');
});

test('task carries the real-emergency escape hatch', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t.task, /hang up and dial the real emergency number 112/i);
});

test('task forbids dispatch, promises, and government impersonation', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t.task, /Do NOT dispatch anyone/i);
  assert.match(t.task, /do NOT claim to be a government service/i);
});

test('intake schema: categorical fields enum-locked, phrase fields free-form', () => {
  assert.deepEqual(INTAKE_RESULT_SCHEMA.urgency.enum, ['critical', 'high', 'medium', 'low', 'unknown']);
  assert.deepEqual(INTAKE_RESULT_SCHEMA.caller_clarity.enum, ['clear', 'partial', 'unclear', 'unknown']);
  assert.equal(INTAKE_RESULT_SCHEMA.emergency_type.enum, undefined);
  assert.equal(INTAKE_RESULT_SCHEMA.location.enum, undefined);
});

test('PREVIEW and REAL are byte-identical from one builder', () => {
  const a = buildIntakeTask('+918588077790', 'hi', 'PRA-2');
  const b = buildIntakeTask('+918588077790', 'hi', 'PRA-2');
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('E.164 normalisation and masking', () => {
  assert.equal(normaliseE164('+91 98800 77790'), '+919880077790');
  assert.equal(normaliseE164('918588077790'), null);
  assert.equal(maskE164('+918588077790'), '+9185•••••790');
});

test('locale resolution and language naming', () => {
  assert.equal(resolveLocale('hi'), 'hi');
  assert.equal(resolveLocale('xx'), 'en-IN');
  assert.equal(localeLanguage('hi'), 'Hindi');
  assert.equal(localeLanguage('unknown-code'), 'Hindi');
});

test('grading maps urgency to severity and priority', () => {
  assert.deepEqual(gradeIntake({ emergencyType: 'fire', location: 'x', urgency: 'medium', clarity: 'clear' }).severity, 'CRITICAL'); // content escalates
  assert.equal(gradeIntake({ emergencyType: 'noise', location: 'x', urgency: 'low', clarity: 'clear' }).priority, 'P4');
  assert.equal(gradeIntake({ emergencyType: 'none', location: 'unknown', urgency: 'unknown', clarity: 'unknown' }).severity, 'UNKNOWN');
});

test('grading can only escalate from the agent urgency, never downplay life-critical words', () => {
  const g = gradeIntake({ emergencyType: 'person not breathing', location: 'home', urgency: 'low', clarity: 'partial' });
  assert.equal(g.severity, 'CRITICAL');
  assert.equal(g.priority, 'P1');
});
