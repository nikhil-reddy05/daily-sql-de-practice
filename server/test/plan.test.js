import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foldSseEvent,
  assembleSse,
  mapPlanHttpError,
  PlanError,
} from '../planClient.js';

const sseSample = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"r1"}}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"Hello, "}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"world!"}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"r1"}}',
  '',
].join('\n');

test('assembleSse concatenates output_text deltas', () => {
  const acc = assembleSse(sseSample);
  assert.equal(acc.text, 'Hello, world!');
  assert.equal(acc.failedCode, null);
});

test('foldSseEvent captures response.failed code', () => {
  const acc = foldSseEvent(
    { text: 'partial', failedCode: null },
    '{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}'
  );
  assert.equal(acc.failedCode, 'subscription_sharing_usage_limit_exceeded');
  assert.equal(acc.text, 'partial');
});

test('assembleSse detects mid-stream failure', () => {
  const body = [
    'data: {"type":"response.output_text.delta","delta":"oops"}',
    '',
    'data: {"type":"response.failed","error":{"code":"subscription_sharing_usage_limit_exceeded"}}',
    '',
  ].join('\n');
  const acc = assembleSse(body);
  assert.equal(acc.failedCode, 'subscription_sharing_usage_limit_exceeded');
});

test('mapPlanHttpError: 429 usage cap', () => {
  const e = mapPlanHttpError(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } });
  assert.ok(e instanceof PlanError);
  assert.equal(e.code, 'cap_reached');
  assert.match(e.message, /cap reached/i);
});

test('mapPlanHttpError: 403 not eligible', () => {
  const e = mapPlanHttpError(403, { error: { code: 'subscription_sharing_user_not_eligible' } });
  assert.ok(e instanceof PlanError);
  assert.equal(e.code, 'not_eligible');
  assert.match(e.message, /Plus\/Pro/);
});

test('mapPlanHttpError: 401 invalid user', () => {
  const e = mapPlanHttpError(401, { error: { code: 'subscription_sharing_invalid_user' } });
  assert.ok(e instanceof PlanError);
  assert.equal(e.code, 'invalid_user');
});

test('mapPlanHttpError: generic failure', () => {
  const e = mapPlanHttpError(500, { error: { message: 'boom' } });
  assert.ok(e instanceof PlanError);
  assert.equal(e.code, 'request_failed');
});
