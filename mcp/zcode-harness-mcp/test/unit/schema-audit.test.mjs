import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArguments } from '../../dist/mcp/validate.js';

test('validator rejects null, unsupported schema types and unexpected properties', () => {
  assert.throws(() => validateArguments({ type: 'object' }, null), /object/);
  assert.throws(() => validateArguments({}, 'anything'), /unsupported/);
  assert.throws(() => validateArguments({ type: ['string', 'null'] }, 'x'), /unsupported/);
  assert.throws(() => validateArguments({ type: 'object', additionalProperties: false }, { extra: true }), /unknown/);
  assert.throws(() => validateArguments({ type: 'object', properties: {}, additionalProperties: false }, JSON.parse('{"__proto__": {}, "constructor": 1}')), /unknown/);
});

test('validator checks nested types, enums and integer boundaries', () => {
  const schema = { type: 'object', properties: { nested: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 } }, mode: { type: 'string', enum: ['plan', 'build'] } }, required: ['mode'], additionalProperties: false };
  validateArguments(schema, { mode: 'plan', nested: [1, 3] });
  assert.throws(() => validateArguments(schema, { mode: 'yolo' }), /one of/);
  assert.throws(() => validateArguments(schema, { mode: 'plan', nested: [1.5] }), /integer/);
  assert.throws(() => validateArguments(schema, { mode: 'plan', nested: [4] }), /<=/);
  assert.throws(() => validateArguments(schema, Object.create({ mode: 'plan' })), /required/);
});
