import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyDeadline} from '../scripts/study-deadline.mjs';

test('all stages share one deadline; later stages never receive a fresh full timeout', () => {
    let now = 100;
    const deadline = createStudyDeadline(40000, () => now);
    assert.equal(deadline.remaining(), 40000);
    now += 27000;
    assert.equal(deadline.remaining(), 13000);
    now += 12999;
    assert.equal(deadline.remaining(), 1);
    now += 1;
    assert.throws(() => deadline.remaining(), /budget exhausted/);
    now += 5000;
    assert.throws(() => deadline.remaining(), /budget exhausted/);
    assert.throws(() => createStudyDeadline(0), /Invalid/);
});
