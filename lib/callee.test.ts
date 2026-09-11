import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeTask, INTAKE_RESULT_SCHEMA, localeLanguage, maskE164, normaliseE164 } from './callee.ts';

test('task embeds the E.164 recipient and the conversation language', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t, /^Call \+918588077790 now\./);
  assert.match(t, /practice intake in Hindi/);
});

test('task always self-identifies as an AI demo — never the real 112', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t, /AI demonstration and NOT the real 112/i);
  assert.ok(!/you are (a|the) 112 operator/i.test(t), 'must never claim to be a 112 operator');
});

test('task carries the real-emergency escape hatch', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t, /hang up and dial the real emergency number 112/i);
});

test('task forbids dispatch, promises, and government impersonation', () => {
  const t = buildIntakeTask('+918588077790', 'hi', 'PRA-1');
  assert.match(t, /Do NOT dispatch anyone/i);
  assert.match(t, /do NOT claim to be a government service/i);
});

test('identical inputs produce the identical task (preview/real parity)', () => {
  assert.equal(buildIntakeTask('+918588077790', 'hi', 'PRA-2'), buildIntakeTask('+918588077790', 'hi', 'PRA-2'));
});

test('intake schema: categorical fields enum-locked, phrase fields free-form', () => {
  assert.deepEqual(INTAKE_RESULT_SCHEMA.urgency.enum, ['critical', 'high', 'medium', 'low', 'unknown']);
  assert.deepEqual(INTAKE_RESULT_SCHEMA.caller_clarity.enum, ['clear', 'partial', 'unclear', 'unknown']);
  assert.equal(INTAKE_RESULT_SCHEMA.emergency_type.enum, undefined);
  assert.equal(INTAKE_RESULT_SCHEMA.location.enum, undefined);
});

test('E.164 normalisation and masking', () => {
  assert.equal(normaliseE164('+91 98800 77790'), '+919880077790');
  assert.equal(normaliseE164('918588077790'), null);
  assert.equal(maskE164('+918588077790'), '+9185•••••790');
});

test('locale language naming falls back to Hindi', () => {
  assert.equal(localeLanguage('hi'), 'Hindi');
  assert.equal(localeLanguage('en-IN'), 'Indian English');
  assert.equal(localeLanguage('xx'), 'Hindi');
});
