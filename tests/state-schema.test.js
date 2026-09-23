import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createInitialState } from '../src/state/model.js';
import { migrateState } from '../src/state/migrations.js';
import { validateSchema } from '../src/utils/schema.js';
import { extractJson, parseAndValidateJson } from '../src/utils/json.js';

const stateSchema = JSON.parse(fs.readFileSync(new URL('../schemas/state.schema.json', import.meta.url), 'utf8'));

test('initial and migrated state validate against schema', () => {
    assert.equal(validateSchema(stateSchema, createInitialState()).valid, true);
    assert.equal(migrateState({ scene: { location: 'Room 167' } }).schemaVersion, 1);
    assert.throws(() => migrateState({ schemaVersion: 999 }), /newer/);
});

test('extracts JSON from Director prose/fences', () => {
    assert.deepEqual(extractJson('prefix ```json\n{"valid":true}\n``` suffix'), { valid: true });
});

test('invalid output gets exactly one repair attempt', async () => {
    let attempts = 0;
    const schema = { type: 'object', required: ['valid'], properties: { valid: { type: 'boolean' } }, additionalProperties: false };
    const value = await parseAndValidateJson('not json', schema, async () => { attempts += 1; return '{"valid":true}'; });
    assert.deepEqual(value, { valid: true });
    assert.equal(attempts, 1);
});
