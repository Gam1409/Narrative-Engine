import test from 'node:test';
import assert from 'node:assert/strict';
import {collectClaims, validateAudit} from '../scripts/memory-claim-audit.mjs';
const catalog = [{ref: 'r0'}];
const claims = [{id: 'c0', text: 'sitting'}, {id: 'c1', text: 'walking'}];

test('semantic audit withholds unsupported and uncertain claims without rewriting them', () => {
    for (const verdict of ['unsupported', 'uncertain']) {
        const result = validateAudit({decisions: [['c1', 'supported', ['r0']], ['c0', verdict, ['r0']]]}, claims, catalog);
        assert.deepEqual(result.retained, [claims[1]]);
        assert.deepEqual(result.withheld, [claims[0]]);
    }
});

test('semantic audit fails closed on missing, duplicate, fabricated decisions or refs', () => {
    const valid = ['c0', 'supported', ['r0']];
    for (const decisions of [[valid], [valid, valid], [valid, ['c2', 'supported', ['r0']]],
        [valid, ['c1', 'supported', ['fake']]]]) {
        assert.throws(() => validateAudit({decisions}, claims, catalog));
    }
});

test('claim collection preserves subject and field and excludes evidence from claim text', () => {
    const result = collectClaims({state: {characters: [{id: 'Anna', holding: {value: 'coat', ref: 'r0'}}]},
        psychology: {characters: [{id: 'Anna', inner: 'uncertain', evidenceRefs: ['r0']}]}});
    assert.deepEqual(result.map(row => [row.subject, row.field, row.text]), [['Anna', 'holding', 'coat'], ['Anna', 'inner', 'uncertain']]);
});
